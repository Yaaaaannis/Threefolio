// antenna.js — Decorative antenna GLB placed in the Hub World.
// Manually rotates the node named "animation" (child of Cylinder.003) on its Z axis.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

export class Antenna {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Vector3} [position]
     * @param {number} [scale]
     * @param {number} [animationSpeed] - timeScale for the animation clip (default 1)
     * @param {THREE.Quaternion|null} [quaternion]
     * @param {*} [RAPIER]
     * @param {*} [rapierWorld]
     */
    constructor(scene, position = new THREE.Vector3(0, 0, 0), scale = 1, rotationSpeed = Math.PI * 0.7, quaternion = null, RAPIER = null, rapierWorld = null) {
        this._scene = scene;
        this._root = null;
        this._animatedPart = null; // the node named "animation" under Cylinder.003
        this._rotationSpeed = rotationSpeed;
        this._body = null;
        this._RAPIER = RAPIER;
        this._rapierWorld = rapierWorld;

        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

        const loader = new GLTFLoader();
        loader.setDRACOLoader(dracoLoader);
        loader.load('/models/Antenna2.glb', (gltf) => {
            console.log('[Model loaded] Antenna2.glb');
            this._root = gltf.scene;
            this._root.scale.setScalar(scale);
            this._root.position.copy(position);
            if (quaternion) this._root.quaternion.copy(quaternion);

            this._root.traverse(node => {
                if (node.isMesh) {
                    node.castShadow = true;
                    node.receiveShadow = true;
                }
            });

            // Find the node named "animation" (mesh child of Cylinder.003)
            this._root.traverse(node => {
                if (node.name.toLowerCase() === 'animation') {
                    this._animatedPart = node;
                }
            });
            if (!this._animatedPart) {
                console.warn('[Antenna] No node named "animation" found in Antenna2.glb');
            }

            scene.add(this._root);

            // ── Physics collider ──────────────────────────────────────────
            if (RAPIER && rapierWorld) {
                this._root.updateMatrixWorld(true);
                const box = new THREE.Box3().setFromObject(this._root);
                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());

                const rbDesc = RAPIER.RigidBodyDesc.fixed()
                    .setTranslation(center.x, center.y, center.z);
                this._body = rapierWorld.createRigidBody(rbDesc);
                rapierWorld.createCollider(
                    RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
                        .setFriction(0.5)
                        .setRestitution(0.1),
                    this._body
                );
            }
        });
    }

    /** @param {number} dt */
    update(dt) {
        if (this._animatedPart) {
            this._animatedPart.rotation.z += this._rotationSpeed * dt;
        }
    }

    dispose() {
        if (this._root) {
            this._scene.remove(this._root);
            this._root.traverse(node => {
                if (node.isMesh) {
                    node.geometry?.dispose();
                    if (Array.isArray(node.material)) {
                        node.material.forEach(m => m.dispose());
                    } else {
                        node.material?.dispose();
                    }
                }
            });
            this._root = null;
        }
        if (this._body && this._rapierWorld) {
            try { this._rapierWorld.removeRigidBody(this._body); } catch (_) { }
            this._body = null;
        }
    }
}
