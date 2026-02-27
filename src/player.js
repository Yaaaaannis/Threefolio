// player.js — Player mesh, top-down controller, Rapier physics

import * as THREE from 'three';

const SPEED = 5;          // units/s
const JUMP_FORCE = 4;     // impulse
const KEYS = {
    ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false,
    Space: false, KeyE: false, Enter: false, KeyF: false
};

window.addEventListener('keydown', e => { if (e.code in KEYS) { KEYS[e.code] = true; } });
window.addEventListener('keyup', e => { if (e.code in KEYS) { KEYS[e.code] = false; } });

export class Player {
    /**
     * @param {THREE.Scene} scene
     * @param {import('@dimforge/rapier3d-compat')} RAPIER
     * @param {import('@dimforge/rapier3d-compat').World} world
     */
    constructor(scene, RAPIER, world) {
        this.RAPIER = RAPIER;
        this.world = world;

        // --- Mesh (capsule-ish: cylinder + 2 spheres) ---
        const bodyGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.0, 12);
        const capGeo = new THREE.SphereGeometry(0.3, 12, 6);
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });

        this.body = new THREE.Mesh(bodyGeo, mat);
        this.capsTop = new THREE.Mesh(capGeo, mat);
        this.capsBot = new THREE.Mesh(capGeo, mat);
        this.capsTop.position.y = 0.5;
        this.capsBot.position.y = -0.5;

        // --- Fist ---
        const fistGeo = new THREE.SphereGeometry(0.12, 8, 8);
        const fistMat = new THREE.MeshStandardMaterial({ color: 0xdddddd });
        this.fist = new THREE.Mesh(fistGeo, fistMat);
        // Position fist in front of the body
        this.fist.position.set(0, 0, 0.4);

        this.mesh = new THREE.Group();
        this.mesh.add(this.body, this.capsTop, this.capsBot, this.fist);
        this.mesh.castShadow = true;
        scene.add(this.mesh);

        // Drop shadow blob on floor
        const shadowGeo = new THREE.CircleGeometry(0.32, 16);
        const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false });
        this.shadowBlob = new THREE.Mesh(shadowGeo, shadowMat);
        this.shadowBlob.rotation.x = -Math.PI / 2;
        this.shadowBlob.position.y = 0.01;
        scene.add(this.shadowBlob);

        // --- Rapier rigid body ---
        const rbDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(0, 1.5, 0)
            .setLinearDamping(1.5)
            .lockRotations(); // no tumbling
        this.rigidBody = world.createRigidBody(rbDesc);

        // Capsule collider (half-height of cylinder = 0.5, radius = 0.3)
        const colDesc = RAPIER.ColliderDesc.capsule(0.5, 0.3).setRestitution(0);
        world.createCollider(colDesc, this.rigidBody);

        this.prevPosition = new THREE.Vector3();
        this.speed = 0;
        this._onGround = false;
        this._jumpCooldown = 0;

        // Wall jump state
        this._touchingWall = false;
        this._wallNormal = new THREE.Vector3();
        this._wallJumpCooldown = 0;
        const WALL_JUMP_FORCE = 5;
        this._WALL_JUMP_FORCE = WALL_JUMP_FORCE;

        // Prevent jump while Space is held continuously
        this._spaceReady = true;  // true means Space has been released since last jump
        this._punchCooldown = 0;
        this._punchAnimation = 0;
    }

    /**
     * @param {number} dt
     */
    update(dt) {
        this._jumpCooldown = Math.max(0, this._jumpCooldown - dt);

        const pos = this.rigidBody.translation();
        const vel = this.rigidBody.linvel();

        // Robust grounded check using multiple short raycasts
        // The capsule's half-height is 0.5 and radius is 0.3 (bottom is at pos.y - 0.8)
        // We start rays slightly below the capsule to avoid self-collision
        const originY = pos.y - 0.81;
        const offset = 0.25; // How far out to check; slightly less than radius 0.3

        const rayOrigins = [
            { x: pos.x, y: originY, z: pos.z },                   // Center
            { x: pos.x + offset, y: originY, z: pos.z },          // Right
            { x: pos.x - offset, y: originY, z: pos.z },          // Left
            { x: pos.x, y: originY, z: pos.z + offset },          // Back
            { x: pos.x, y: originY, z: pos.z - offset }           // Front
        ];

        const rayDir = { x: 0, y: -1, z: 0 };
        this._onGround = false;

        for (const origin of rayOrigins) {
            const ray = new this.RAPIER.Ray(origin, rayDir);
            const hit = this.world.castRay(ray, 0.2, true);
            if (hit !== null && Math.abs(vel.y) < 1.0) {
                this._onGround = true;
                break; // If any ray hits the ground, we are grounded
            }
        }

        // Build move direction in world XZ
        let dx = 0, dz = 0;
        if (KEYS.ArrowUp) dz -= 1;
        if (KEYS.ArrowDown) dz += 1;
        if (KEYS.ArrowLeft) dx -= 1;
        if (KEYS.ArrowRight) dx += 1;

        // Normalize direction
        let len = Math.sqrt(dx * dx + dz * dz);
        if (len > 0) { dx /= len; dz /= len; }

        // Rotate movement vector by -45 degrees to align with isometric camera
        // The camera is offset by sin(PI/4) and cos(PI/4).
        // Standard 2D rotation matrix:
        // x' = x * cos(theta) - y * sin(theta)
        // y' = x * sin(theta) + y * cos(theta)
        if (len > 0) {
            const angle = -Math.PI / 4; // -45 degrees
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);

            const rotatedX = dx * cosA - dz * sinA;
            const rotatedZ = dx * sinA + dz * cosA;

            dx = rotatedX;
            dz = rotatedZ;
        }

        // Apply horizontal impulse toward target velocity
        const targetVx = dx * SPEED;
        const targetVz = dz * SPEED;
        const impX = (targetVx - vel.x) * 0.35;
        const impZ = (targetVz - vel.z) * 0.35;

        this.rigidBody.applyImpulse({ x: impX, y: 0, z: impZ }, true);

        // Lateral wall detection (4 directions using short raycasts)
        this._wallJumpCooldown = Math.max(0, this._wallJumpCooldown - dt);

        // Lateral wall detection — rays start just OUTSIDE the player capsule radius (0.3)
        // to avoid detecting the player's own capsule collider as a "wall"
        const wallRayLength = 0.35;   // detect walls from 0.35 to 0.70 units away from center
        const capsuleRadius = 0.32;   // slightly past the 0.3 collider radius
        const wallDirs = [
            { x: 1, y: 0, z: 0 },
            { x: -1, y: 0, z: 0 },
            { x: 0, y: 0, z: 1 },
            { x: 0, y: 0, z: -1 },
        ];
        this._touchingWall = false;
        for (const dir of wallDirs) {
            // Start ray from just outside the capsule surface
            const rayOrigin = {
                x: pos.x + dir.x * capsuleRadius,
                y: pos.y,
                z: pos.z + dir.z * capsuleRadius
            };
            const ray = new this.RAPIER.Ray(rayOrigin, dir);
            // Exclude the player's own rigid body from the ray
            const hit = this.world.castRay(ray, wallRayLength, true,
                undefined, undefined, undefined, this.rigidBody);
            if (hit !== null) {
                this._touchingWall = true;
                this._wallNormal.set(-dir.x, 0, -dir.z);
                break;
            }
        }

        // Track if Space was released since last jump (prevents holding-Space infinite jump)
        if (!KEYS.Space) this._spaceReady = true;

        // ═══ WALL GRAB: when airborne and hugging a wall, counteract gravity for slow slide ═══
        const isWallGrabbing = this._touchingWall && !this._onGround && this._wallJumpCooldown === 0;
        if (isWallGrabbing) {
            const curVel = this.rigidBody.linvel();
            // Only slow the fall - does not fully negate gravity, gives a slow slide
            // Rapier gravity is y=-12, mass=1, so gravity impulse per frame ~ 12*dt
            // We counteract ~80% to get a gentle downward slide
            const antiGravity = 12 * 0.8 * dt;
            // Cap downward velocity to a slow slide speed (-1.5 units/s)
            if (curVel.y < -1.5) {
                this.rigidBody.applyImpulse({ x: 0, y: antiGravity, z: 0 }, true);
            }
            // Lock horizontal drift toward the wall surface so the player stays snug
            const snugImpulse = {
                x: -this._wallNormal.x * Math.abs(curVel.x) * 0.3,
                y: 0,
                z: -this._wallNormal.z * Math.abs(curVel.z) * 0.3
            };
            this.rigidBody.applyImpulse(snugImpulse, true);
        }

        // Regular jump — only if Space freshly pressed AND on ground
        if (KEYS.Space && this._spaceReady && this._onGround && this._jumpCooldown === 0) {
            this.rigidBody.applyImpulse({ x: 0, y: JUMP_FORCE, z: 0 }, true);
            this._jumpCooldown = 0.35;
            this._spaceReady = false;
        }

        // ═══ WALL JUMP: launch player toward the OPPOSITE wall ═══
        if (KEYS.Space && this._spaceReady && isWallGrabbing) {
            // Wipe current velocity for a clean controlled launch
            this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
            const wj = this._WALL_JUMP_FORCE;
            // Strong horizontal push away from current wall + upward
            this.rigidBody.applyImpulse({
                x: this._wallNormal.x * wj * 3,
                y: wj * 0.9,
                z: this._wallNormal.z * wj * 1.2
            }, true);
            this._wallJumpCooldown = 0.5;
            this._spaceReady = false;
        }

        // Handle Punch (KeyF)
        if (KEYS.KeyF && this._punchCooldown <= 0) {
            this._punchCooldown = 0.5; // Half second cooldown
            this._punchAnimation = 0.15; // Animation duration

            // Calculate a point just in front of the player (where the fist is)
            const facingAngle = this.mesh.rotation.y;
            const forwardDir = new THREE.Vector3(Math.sin(facingAngle), 0, Math.cos(facingAngle));

            const punchOrigin = new THREE.Vector3().copy(pos).add(forwardDir.clone().multiplyScalar(0.6));
            punchOrigin.y += 0.5; // Roughly chest height

            // Check for hits using a short shape cast (sphere)
            const shapeRot = { x: 0, y: 0, z: 0, w: 1 };
            const shapeVel = { x: forwardDir.x, y: 0, z: forwardDir.z };
            const shape = new this.RAPIER.Ball(0.4); // 0.4 radius hit area

            // Filter: only hit dynamic bodies (the cubes)
            // Interaction groups: we could set up specific bits, but for now we'll just check if it's dynamic after hit
            // IMPORTANT: Never hit the player itself!
            const hit = this.world.castShape(
                punchOrigin, shapeRot, shapeVel, shape,
                0.5, // Target distance
                0.1, // Max Toi (very short cast)
                true, // Stop at penetration
                undefined, undefined, undefined,
                this.rigidBody // Exclude the player's own rigid body!
            );

            if (hit !== null) {
                const hitCollider = this.world.getCollider(hit.colliderHandle);
                const hitBody = hitCollider.parent();

                if (hitBody && hitBody.isDynamic()) {
                    // Calculate hit point for particle emission
                    const hitPos = hitBody.translation();

                    // Apply extremely heavy impulse away from player, significantly upwards
                    const impulseAmount = 20.0;
                    const impulse = {
                        x: forwardDir.x * impulseAmount,
                        y: 0, // High Pop up
                        z: forwardDir.z * impulseAmount
                    };

                    hitBody.applyImpulse(impulse, true); // Use center impulse to avoid weird torque/point-reaction bugs

                    // Trigger particles exactly at the center of the hit object
                    if (this.particleSystem && this.timeGetter) {
                        // Pass null for normal to trigger the new spherical explosion
                        this.particleSystem.emit(
                            new THREE.Vector3(hitPos.x, hitPos.y, hitPos.z),
                            null,
                            150, // Massive amount of particles 
                            this.timeGetter()
                        );
                    }
                }
            }
        }

        // Update punch cooldowns and animate fist
        if (this._punchCooldown > 0) {
            this._punchCooldown -= dt;
        }

        if (this._punchAnimation > 0) {
            this._punchAnimation -= dt;
            // Snappy animation: move forward fast, then back
            const t = 1.0 - (this._punchAnimation / 0.15); // 0 to 1
            const extension = Math.sin(t * Math.PI) * 0.4; // Arc from 0 -> 0.4 -> 0
            this.fist.position.z = 0.4 + extension;
        } else {
            this.fist.position.z = 0.4;
        }

        // Manual ghost spawn triggering
        this.wantsToSpawnGhost = false;
        if (KEYS.KeyE) {
            this.wantsToSpawnGhost = true;
            KEYS.KeyE = false; // "Consume" the keypress so it only triggers once per press
        }

        // Sync mesh
        const newPos = this.rigidBody.translation();
        this.mesh.position.set(newPos.x, newPos.y, newPos.z);
        this.shadowBlob.position.set(newPos.x, 0.01, newPos.z);

        // Rotate mesh toward movement direction
        if (len > 0) {
            const targetAngle = Math.atan2(dx, dz);
            this.mesh.rotation.y += (targetAngle - this.mesh.rotation.y) * 0.15;
        }

        // Compute speed for state manager
        const prev = this.prevPosition;
        const dist = Math.sqrt(
            (newPos.x - prev.x) ** 2 + (newPos.z - prev.z) ** 2
        );
        this.speed = dist / Math.max(dt, 0.001);
        this.prevPosition.set(newPos.x, newPos.y, newPos.z);
    }

    getPosition() {
        const t = this.rigidBody.translation();
        return new THREE.Vector3(t.x, t.y, t.z);
    }
}
