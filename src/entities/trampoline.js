// trampoline.js — Bouncy trampoline with animated spring mesh deformation
import * as THREE from 'three';

const BOUNCE_FORCE      = 5;    // base upward impulse
const SPRING_K          = 10;   // mesh spring stiffness (lower = softer, more travel)
const SPRING_DAMP       = 3;    // mesh spring damping (low = visible oscillation)
const DETECT_THRESHOLD  = 1.2;  // min downward velocity (units/s) to trigger bounce

export class Trampoline {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Vector3} position  — world position (on or near planet surface)
     * @param {number} radius           — trampoline surface radius
     * @param {any} RAPIER
     * @param {any} world
     */
    constructor(scene, position, radius = 2.0, RAPIER = null, world = null) {
        this._scene  = scene;
        this._pos    = position.clone();
        this._radius = radius;
        this._RAPIER = RAPIER;
        this._world  = world;

        // Planet centre (must match player.js)
        const PC = new THREE.Vector3(0, -50, 0);
        this._normal = new THREE.Vector3().subVectors(this._pos, PC).normalize();

        // _qZ: aligns local +Z with planet normal (PlaneGeometry, TorusGeometry)
        this._qZ = new THREE.Quaternion()
            .setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._normal);
        // _qY: aligns local +Y with planet normal (CylinderGeometry, Rapier cylinder)
        this._qY = new THREE.Quaternion()
            .setFromUnitVectors(new THREE.Vector3(0, 1, 0), this._normal);

        // Spring state
        this._dipAmp = 0;
        this._dipVel = 0;

        // Bounce detection
        this._wasOn          = false;
        this._prevVelDown    = 0;
        this._bounceCooldown = 0;

        this._buildMesh();
        this._buildPhysics();
    }

    _buildMesh() {
        // ── Bounce surface (subdivided PlaneGeometry, deformed each frame) ──
        const SEGS   = 22;
        const surfGeo = new THREE.PlaneGeometry(
            this._radius * 2, this._radius * 2, SEGS, SEGS
        );

        const posAttr = surfGeo.attributes.position;
        this._origZ = new Float32Array(posAttr.count);
        this._vDist = new Float32Array(posAttr.count);
        for (let i = 0; i < posAttr.count; i++) {
            this._origZ[i] = posAttr.getZ(i);
            const x = posAttr.getX(i), y = posAttr.getY(i);
            this._vDist[i] = Math.sqrt(x * x + y * y);
        }

        this._surfMesh = new THREE.Mesh(
            surfGeo,
            new THREE.MeshToonMaterial({ color: 0x33bb55, side: THREE.DoubleSide })
        );
        this._surfMesh.position.copy(this._pos);
        this._surfMesh.quaternion.copy(this._qZ);   // PlaneGeometry normal = +Z → align with planet normal
        this._scene.add(this._surfMesh);

        // ── Frame ring ────────────────────────────────────────────────────
        this._frameMesh = new THREE.Mesh(
            new THREE.TorusGeometry(this._radius, 0.1, 8, 48),
            new THREE.MeshToonMaterial({ color: 0x222222 })
        );
        this._frameMesh.position.copy(this._pos);
        this._frameMesh.quaternion.copy(this._qZ);  // Torus hole axis = +Z → align with planet normal
        this._scene.add(this._frameMesh);

        // ── Legs (3 cylinders at 120° intervals) ─────────────────────────
        const legMat = new THREE.MeshToonMaterial({ color: 0x333333 });
        const LEG_H  = 1.4;
        const legGeo = new THREE.CylinderGeometry(0.07, 0.09, LEG_H, 6);
        this._legMeshes = [];

        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2;
            // Rim offset in the surface's local XY plane, rotated to world space
            const localRim = new THREE.Vector3(
                Math.cos(angle) * this._radius,
                Math.sin(angle) * this._radius,
                0
            ).applyQuaternion(this._qZ);

            // Leg center = on rim, half a leg's height below the surface
            const legCenter = this._pos.clone()
                .add(localRim)
                .addScaledVector(this._normal, -LEG_H * 0.5);

            const leg = new THREE.Mesh(legGeo, legMat);
            leg.position.copy(legCenter);
            leg.quaternion.copy(this._qY);  // CylinderGeometry axis = +Y → planet normal
            this._scene.add(leg);
            this._legMeshes.push(leg);
        }
    }

    _buildPhysics() {
        if (!this._RAPIER || !this._world) return;

        const rbDesc = this._RAPIER.RigidBodyDesc.fixed()
            .setTranslation(this._pos.x, this._pos.y, this._pos.z)
            .setRotation({ x: this._qY.x, y: this._qY.y, z: this._qY.z, w: this._qY.w });
        this._rigidBody = this._world.createRigidBody(rbDesc);

        // Thin cylinder disc (Y axis = planet normal) — no auto-restitution, we handle bounce
        this._world.createCollider(
            this._RAPIER.ColliderDesc
                .cylinder(0.05, this._radius - 0.12)
                .setRestitution(0.0)
                .setFriction(0.1),
            this._rigidBody
        );
    }

    /**
     * Call every visual frame.
     * @param {number} dt
     * @param {import('./player.js').Player|null} player
     */
    update(dt, player) {
        this._bounceCooldown = Math.max(0, this._bounceCooldown - dt);

        // ── Bounce detection ──────────────────────────────────────────────
        if (player && this._bounceCooldown === 0) {
            const t    = player.rigidBody.translation();
            const pPos = new THREE.Vector3(t.x, t.y, t.z);

            const toTramp    = new THREE.Vector3().subVectors(pPos, this._pos);
            const heightAbove = toTramp.dot(this._normal);
            const lateral    = toTramp
                .clone()
                .sub(this._normal.clone().multiplyScalar(heightAbove))
                .length();

            // Player is considered "on" when within radius and just above the surface collider
            const isOn = heightAbove > 0.25 && heightAbove < 1.4
                && lateral < (this._radius - 0.1);

            // Trigger: player just landed (was off last frame) with significant downward velocity
            if (isOn && !this._wasOn && this._prevVelDown > DETECT_THRESHOLD) {
                const strength = BOUNCE_FORCE + this._prevVelDown * 0.6;
                const imp = this._normal.clone().multiplyScalar(strength);
                player.rigidBody.applyImpulse({ x: imp.x, y: imp.y, z: imp.z }, true);
                player._jumpCooldown = 0.4;

                // Trigger dip proportional to impact velocity
                this._dipVel = -Math.min(this._prevVelDown * 0.4, 1.5);
                this._bounceCooldown = 0.3;
            }

            // Track state for next frame
            const vel  = player.rigidBody.linvel();
            const vel3 = new THREE.Vector3(vel.x, vel.y, vel.z);
            this._prevVelDown = -vel3.dot(this._normal);  // positive = falling down
            this._wasOn = isOn;
        }

        // ── Spring simulation ──────────────────────────────────────────────
        const springF = -SPRING_K * this._dipAmp - SPRING_DAMP * this._dipVel;
        this._dipVel += springF * dt;
        this._dipAmp += this._dipVel * dt;
        this._dipAmp = Math.max(-1.2, Math.min(0.08, this._dipAmp));

        // ── Mesh deformation — Gaussian dip along local +Z (= planet normal) ──
        const posAttr = this._surfMesh.geometry.attributes.position;
        const r2 = (this._radius * 0.7) ** 2;
        for (let i = 0; i < posAttr.count; i++) {
            const d = this._vDist[i];
            posAttr.setZ(i, this._origZ[i] + this._dipAmp * Math.exp(-(d * d) / r2));
        }
        posAttr.needsUpdate = true;
        this._surfMesh.geometry.computeVertexNormals();
    }

    dispose() {
        this._scene.remove(this._surfMesh);
        this._scene.remove(this._frameMesh);
        this._surfMesh.geometry.dispose();
        this._frameMesh.geometry.dispose();
        for (const leg of this._legMeshes) {
            this._scene.remove(leg);
            leg.geometry.dispose();
        }
        if (this._rigidBody && this._world) {
            this._world.removeRigidBody(this._rigidBody);
        }
    }
}
