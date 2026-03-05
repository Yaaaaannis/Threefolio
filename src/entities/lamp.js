import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

export class Lamp {
    /**
     * @param {THREE.Scene} scene
     * @param {number} maxInstances
     */
    constructor(scene, maxInstances = 200) {
        this._scene = scene;
        this._maxInstances = maxInstances;
        this._instances = []; // Array of { matrix, pos }

        this._modelLoaded = false;
        this._instancedMeshes = []; // Array of { instancedMesh, originalMesh }

        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

        const loader = new GLTFLoader();
        loader.setDRACOLoader(dracoLoader);

        loader.load(
            '/models/lampadaire.glb',
            (gltf) => {
                console.log('[Lamp] Model loaded for emissive-only instancing');

                // Extract meshes
                gltf.scene.traverse(node => {
                    if (node.isMesh) {
                        const im = new THREE.InstancedMesh(node.geometry, node.material, maxInstances);
                        im.castShadow = false;
                        im.receiveShadow = false;
                        im.count = 0;
                        im.name = node.name;

                        // Ensure material supports radiation if it's the yellow bulb ("Plane_2")
                        if (node.name === 'Plane_2') {
                            im.material = node.material.clone();
                            im.material.emissive = new THREE.Color(0xd1d100);
                            im.material.emissiveIntensity = 5.0;
                        }

                        this._instancedMeshes.push({ instancedMesh: im, originalMesh: node });
                        this._scene.add(im);
                    }
                });

                this._modelLoaded = true;
                this.addInstance(new THREE.Vector3(-15, -3, 5), 2);
            }
        );
    }

    /**
     * Add a single lamp instance.
     * @param {THREE.Vector3} position 
     * @param {number} scale 
     */
    addInstance(position, scale = 1.0) {
        if (!this._modelLoaded) return;
        if (this._instances.length >= this._maxInstances) return;

        const PLANET_CENTER = new THREE.Vector3(0, -50, 0);
        const surfaceNormal = new THREE.Vector3().subVectors(position, PLANET_CENTER).normalize();

        // Matrix setup
        const dummy = new THREE.Object3D();
        dummy.position.copy(position);
        dummy.scale.setScalar(scale);

        const alignQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), surfaceNormal);
        dummy.quaternion.copy(alignQuat);
        dummy.updateMatrix();

        // Track instance
        const index = this._instances.length;
        this._instances.push({ matrix: dummy.matrix.clone(), pos: position.clone(), scale });

        // Update InstancedMeshes
        for (const { instancedMesh } of this._instancedMeshes) {
            instancedMesh.setMatrixAt(index, dummy.matrix);
            instancedMesh.count = this._instances.length;
            instancedMesh.instanceMatrix.needsUpdate = true;
        }
    }

    /**
     * Spawns random lamps around the spawn point.
     * @param {number} count 
     * @param {number} range 
     */
    spawnRandom(count = 10, range = 30) {
        if (!this._modelLoaded) return;

        for (let i = 0; i < count; i++) {
            const rx = (Math.random() - 0.5) * 2 * range;
            const rz = (Math.random() - 0.5) * 2 * range;

            const p = new THREE.Vector3(rx, 2, rz);
            const PLANET_CENTER = new THREE.Vector3(0, -50, 0);
            const PLANET_RADIUS = 50;
            const dir = new THREE.Vector3().subVectors(p, PLANET_CENTER).normalize();
            const surfacePos = PLANET_CENTER.clone().add(dir.multiplyScalar(PLANET_RADIUS + 0.1));

            this.addInstance(surfacePos, 1.2 + Math.random() * 0.6);
        }
    }

    clearAll() {
        this._instances = [];
        for (const { instancedMesh } of this._instancedMeshes) {
            instancedMesh.count = 0;
            instancedMesh.instanceMatrix.needsUpdate = true;
        }
    }

    updateLights(intensity, distance, color, emissiveIntensity) {
        if (emissiveIntensity !== undefined || color !== undefined) {
            for (const { instancedMesh } of this._instancedMeshes) {
                if (instancedMesh.name === 'Plane_2') {
                    if (instancedMesh.material) {
                        if (emissiveIntensity !== undefined) instancedMesh.material.emissiveIntensity = emissiveIntensity;
                        if (color !== undefined) instancedMesh.material.emissive.set(color);
                    }
                }
            }
        }
    }

    dispose() {
        this.clearAll();
        for (const { instancedMesh } of this._instancedMeshes) {
            this._scene.remove(instancedMesh);
            instancedMesh.geometry.dispose();
            if (instancedMesh.material.dispose) instancedMesh.material.dispose();
        }
        this._instancedMeshes = [];
    }
}
