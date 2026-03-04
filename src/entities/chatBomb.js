import * as THREE from 'three';

const BOMB_RADIUS = 0.4;
const LIFETIME_S = 3.0; // 3 seconds before explosion
const EXPLOSION_RADIUS = 15.0; // Explosion area of effect
const EXPLOSION_FORCE = 10.0; // Restored to a sensible impulse magnitude

export class ChatBomb {
    /**
     * @param {THREE.Scene} scene 
     * @param {object} RAPIER
     * @param {object} rapierWorld 
     * @param {THREE.Vector3} position - where the bomb drops from 
     * @param {Player} player - ref to the player for knockback
     */
    constructor(scene, RAPIER, rapierWorld, position, player) {
        this._scene = scene;
        this._RAPIER = RAPIER;
        this._world = rapierWorld;
        this._player = player;
        this._alive = true;
        this._elapsed = 0;

        // Visual
        const geo = new THREE.SphereGeometry(BOMB_RADIUS, 16, 16);
        const mat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9, metalness: 0.1 });
        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.castShadow = true;
        this.mesh.position.copy(position);
        scene.add(this.mesh);

        // Fuse visual (optional little red spark)
        const fuseGeo = new THREE.SphereGeometry(0.1);
        const fuseMat = new THREE.MeshBasicMaterial({ color: 0xff3300 });
        this.fuseMesh = new THREE.Mesh(fuseGeo, fuseMat);
        this.mesh.add(this.fuseMesh);
        this.fuseMesh.position.set(0, BOMB_RADIUS, 0);

        // Physics
        const rbDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(position.x, position.y, position.z)
            .setLinearDamping(0.5)
            .setAngularDamping(0.5);
        this.rigidBody = rapierWorld.createRigidBody(rbDesc);

        const colDesc = RAPIER.ColliderDesc.ball(BOMB_RADIUS)
            .setDensity(5.0) // heavier than normal objects
            .setRestitution(0.2); // slight bounce
        this.collider = rapierWorld.createCollider(colDesc, this.rigidBody);
    }

    /**
     * @param {number} dt 
     * @returns {boolean} true if alive, false if it exploded
     */
    update(dt) {
        if (!this._alive || !this.rigidBody) return false;

        this._elapsed += dt;

        // Apply spherical gravity
        const t = this.rigidBody.translation();
        const planetCenter = new THREE.Vector3(0, -50, 0);
        const pos3 = new THREE.Vector3(t.x, t.y, t.z);
        const upNormal = new THREE.Vector3().subVectors(pos3, planetCenter).normalize();

        // Bomb gravity (-20 units/s^2)
        const gravityForce = upNormal.clone().multiplyScalar(-20 * dt);
        this.rigidBody.applyImpulse({ x: gravityForce.x, y: gravityForce.y, z: gravityForce.z }, true);

        // Sync visual to physics
        const q = this.rigidBody.rotation();
        this.mesh.position.set(t.x, t.y, t.z);
        this.mesh.quaternion.set(q.x, q.y, q.z, q.w);

        // Flicker the fuse
        this.fuseMesh.material.color.setHex(Math.random() > 0.5 ? 0xff5500 : 0xffff00);
        this.fuseMesh.scale.setScalar(1 + Math.sin(this._elapsed * 30) * 0.3);

        // Pulse the bomb as it gets closer to explosion
        const pulse = 1 + (this._elapsed / LIFETIME_S) * 0.2 * Math.sin(this._elapsed * 20);
        this.mesh.scale.setScalar(pulse);

        if (this._elapsed >= LIFETIME_S) {
            this.explode();
            return false;
        }

        return true;
    }

    explode() {
        this._alive = false;
        const center = this.rigidBody.translation();
        const centerVec = new THREE.Vector3(center.x, center.y, center.z);

        // Simple explosion flash
        const flashGeo = new THREE.SphereGeometry(EXPLOSION_RADIUS, 16, 16);
        const flashMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.8 });
        const flash = new THREE.Mesh(flashGeo, flashMat);
        flash.position.copy(centerVec);
        this._scene.add(flash);

        // Remove flash quickly
        setTimeout(() => {
            this._scene.remove(flash);
            flashGeo.dispose();
            flashMat.dispose();
        }, 150);


        // --- Apply Rapier forces ---
        this._world.forEachCollider((collider) => {
            const rb = collider.parent();
            if (!rb) return;
            if (rb === this.rigidBody) return; // don't push self

            // Only affect dynamic or kinematic bodies
            if (rb.bodyType() !== this._RAPIER.RigidBodyType.Dynamic && rb.bodyType() !== this._RAPIER.RigidBodyType.KinematicPositionBased) return;

            const t = rb.translation();
            const pos = new THREE.Vector3(t.x, t.y, t.z);
            const dist = centerVec.distanceTo(pos);

            if (dist < EXPLOSION_RADIUS) {
                const dir = new THREE.Vector3().subVectors(pos, centerVec).normalize();

                // Force drops off with distance
                const forceMag = EXPLOSION_FORCE * (1 - (dist / EXPLOSION_RADIUS));

                const impulse = {
                    x: dir.x * forceMag,
                    y: dir.y * forceMag,
                    z: dir.z * forceMag
                };

                // Apply to standard dynamic bodies
                if (rb.bodyType() === this._RAPIER.RigidBodyType.Dynamic) {
                    rb.applyImpulse(impulse, true);
                }
            }
        });

        // Add specific knockback to the player
        if (this._player && this._player.rigidBody) {
            const t = this._player.rigidBody.translation();
            const pos = new THREE.Vector3(t.x, t.y, t.z);
            const dist = centerVec.distanceTo(pos);

            if (dist < EXPLOSION_RADIUS) {
                const dir = new THREE.Vector3().subVectors(pos, centerVec).normalize();
                const forceMag = EXPLOSION_FORCE * (1 - (dist / EXPLOSION_RADIUS));

                // Player needs a specific vector since they use setLinvel and have strong damping
                const planetCenter = new THREE.Vector3(0, -50, 0);
                const up = new THREE.Vector3().subVectors(pos, planetCenter).normalize();

                // Add a guaranteed upward pop of at least 0.5 to lift off the ground
                dir.addScaledVector(up, 0.5).normalize();

                const impulse = {
                    x: dir.x * forceMag * 0.8,
                    y: dir.y * forceMag * 0.8,
                    z: dir.z * forceMag * 0.8
                };

                this._player.applyExplosionImpulse(impulse);
            }
        }

        this.dispose();
    }

    dispose() {
        this._alive = false;

        // Defer actual cleanup to avoid crashing Rapier if we are inside a physics step
        setTimeout(() => {
            this._scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
            this.fuseMesh.geometry.dispose();
            this.fuseMesh.material.dispose();
            if (this.rigidBody) {
                this._world.removeRigidBody(this.rigidBody);
                this.rigidBody = null;
                this.collider = null;
            }
        }, 0);
    }
}
