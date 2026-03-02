// antenna.js — Decorative antenna GLB placed in the Hub World.
// The mesh named "animated-part" spins continuously on its local Y axis.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

export class Antenna {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Vector3} [position] - where to place the antenna
     * @param {number} [scale] - uniform scale (default 1)
     * @param {number} [rotationSpeed] - radians/second for the spinning part (default Math.PI)
     * @param {THREE.Quaternion|null} [quaternion] - orientation to align root with surface normal
     */
    constructor(scene, position = new THREE.Vector3(3, 0, 3), scale = 1, rotationSpeed = Math.PI, quaternion = null) {
        this._scene = scene;
        this._root = null;
        this._animatedPart = null;
        this._rotationSpeed = rotationSpeed;

        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

        const loader = new GLTFLoader();
        loader.setDRACOLoader(dracoLoader);
        loader.load('/models/antenna.glb', (gltf) => {
            this._root = gltf.scene;
            this._root.scale.setScalar(scale);
            this._root.position.copy(position);
            if (quaternion) this._root.quaternion.copy(quaternion);

            this._root.traverse(node => {
                if (node.isMesh) {
                    node.castShadow = true;
                    node.receiveShadow = true;
                }
                // Find the animated part regardless of capitalisation (Blender exports "Animated-part")
                if (node.name.toLowerCase() === 'animated-part') {
                    this._animatedPart = node;
                }
            });

            if (!this._animatedPart) {
                console.warn('[Antenna] No child named "animated-part" found in antenna.glb');
            }

            scene.add(this._root);
        });
    }

    /**
     * Call every frame.
     * @param {number} dt - delta time in seconds
     */
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
            this._animatedPart = null;
        }
    }
}
