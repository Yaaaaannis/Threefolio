import * as THREE from 'three';

const EMOTE_SIZE = 0.8;
const EMOTE_THICKNESS = 0.1;
const LIFETIME_S = 15.0; // Despawn after 15 seconds

export class ChatEmoteDrop {
    constructor(scene, RAPIER, rapierWorld, position, imageUrl) {
        this._scene = scene;
        this._RAPIER = RAPIER;
        this._world = rapierWorld;
        this._alive = true;
        this._elapsed = 0;

        // Visual
        const geo = new THREE.BoxGeometry(EMOTE_SIZE, EMOTE_SIZE, EMOTE_THICKNESS);

        // Load the emote texture
        const loader = new THREE.TextureLoader();
        loader.setCrossOrigin('anonymous');

        // Make the material. We only want the image on the front and back
        // For simplicity, let's just use a white material for sides, and texture for front/back
        const sideMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });

        const mainMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.8,
            transparent: true,
            alphaTest: 0.1 // allows non-square emotes to cut out (Twitch emotes usually have transparent backgrounds)
        });

        loader.load(imageUrl, (texture) => {
            mainMat.map = texture;
            mainMat.needsUpdate = true;
        });

        // Box faces: Right, Left, Top, Bottom, Front, Back
        this.mesh = new THREE.Mesh(geo, [
            sideMat, sideMat, sideMat, sideMat, mainMat, mainMat
        ]);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.mesh.position.copy(position);

        // Random initial rotation
        this.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);

        scene.add(this.mesh);

        // Physics
        const rbDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(position.x, position.y, position.z)
            .setRotation({ x: this.mesh.quaternion.x, y: this.mesh.quaternion.y, z: this.mesh.quaternion.z, w: this.mesh.quaternion.w })
            .setLinearDamping(0.8) // High air resistance so they float down gracefully
            .setAngularDamping(0.8); // High angular damping so they don't spin wildly
        this.rigidBody = rapierWorld.createRigidBody(rbDesc);

        // It's a box collider
        const colDesc = RAPIER.ColliderDesc.cuboid(EMOTE_SIZE / 2, EMOTE_SIZE / 2, EMOTE_THICKNESS / 2)
            .setDensity(0.2) // Very light cardboard
            .setRestitution(0.4) // Less bouncy
            .setFriction(0.8);

        this.collider = rapierWorld.createCollider(colDesc, this.rigidBody);
    }

    update(dt) {
        if (!this._alive || !this.rigidBody) return false;

        this._elapsed += dt;

        // Apply spherical gravity
        const t = this.rigidBody.translation();
        const planetCenter = new THREE.Vector3(0, -50, 0);
        const pos3 = new THREE.Vector3(t.x, t.y, t.z);

        let upNormal;
        // Need to add safety check in case pos3 is exactly at center, which is unlikely but possible
        if (pos3.distanceTo(planetCenter) < 0.001) {
            upNormal = new THREE.Vector3(0, 1, 0);
        } else {
            upNormal = new THREE.Vector3().subVectors(pos3, planetCenter).normalize();
        }

        // Emote gravity (feels a bit floaty like cardboard)
        // INCREASE gravity so it falls faster and add a directional push towards the center
        // Needs a strong force to overcome the high linear damping
        const gravityForce = upNormal.clone().multiplyScalar(-80 * dt);
        this.rigidBody.applyImpulse({ x: gravityForce.x, y: gravityForce.y, z: gravityForce.z }, true);

        // Sync visual to physics
        const q = this.rigidBody.rotation();
        this.mesh.position.set(t.x, t.y, t.z);
        this.mesh.quaternion.set(q.x, q.y, q.z, q.w);

        // Fade out at end of life
        const remaining = LIFETIME_S - this._elapsed;
        if (remaining < 2.0) {
            const alpha = Math.max(0, remaining / 2.0);
            for (const mat of this.mesh.material) {
                mat.transparent = true;
                mat.opacity = alpha;
            }
        }

        if (this._elapsed >= LIFETIME_S) {
            this.dispose();
            return false;
        }

        return true;
    }

    dispose() {
        this._alive = false;

        setTimeout(() => {
            if (this.mesh && this.mesh.parent) {
                this._scene.remove(this.mesh);
                this.mesh.geometry.dispose();
                for (const mat of this.mesh.material) {
                    if (mat.map) mat.map.dispose();
                    mat.dispose();
                }
            }
            if (this.rigidBody) {
                this._world.removeRigidBody(this.rigidBody);
                this.rigidBody = null;
                this.collider = null;
            }
        }, 0);
    }
}
