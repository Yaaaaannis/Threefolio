import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { uniform, normalLocal, positionLocal } from 'three/tsl';

export class Lamp {
    /**
     * @param {THREE.Scene} scene
     * @param {number} maxInstances
     * @param {any} RAPIER
     * @param {any} world
     */
    constructor(scene, maxInstances = 200, RAPIER = null, world = null) {
        this._scene = scene;
        this._maxInstances = maxInstances;
        this._RAPIER = RAPIER;
        this._world = world;
        this._instances = []; // Array of { matrix, pos, rigidBody }

        this._modelLoaded = false;
        this._instancedMeshes = []; // Array of { instancedMesh, originalMesh }
        this._outlineInstancedMeshes = []; // Inverted hull outline InstancedMeshes

        // Outline uniforms
        this._outlineColorUniform = uniform(new THREE.Color(0x000000));
        this._outlineThicknessUniform = uniform(0.092);
        this._outlineEnabled = true;
        this._nightEmissiveIntensity = 50.0; // max emissive in full night

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
                        im.frustumCulled = false;
                        im.castShadow = false;
                        im.receiveShadow = false;
                        im.count = 0;
                        im.name = node.name;

                        // Ensure material supports radiation if it's the yellow bulb ("Plane_2")
                        if (node.name === 'Plane_2') {
                            im.material = node.material.clone();
                            im.material.emissive = new THREE.Color(0xd1d100);
                            im.material.emissiveIntensity = 0; // driven by setTimeOfDay()
                            im.material.transparent = true;
                            im.material.opacity = 0;           // hidden in day by default
                        }

                        this._instancedMeshes.push({ instancedMesh: im, originalMesh: node });
                        this._scene.add(im);
                    }
                });

                // ── Inverted hull outline ──────────────────────────────────
                const outlineMat = new MeshBasicNodeMaterial({ side: THREE.BackSide });
                outlineMat.colorNode = this._outlineColorUniform;
                outlineMat.positionNode = positionLocal.add(
                    normalLocal.normalize().mul(this._outlineThicknessUniform)
                );

                for (const { instancedMesh } of this._instancedMeshes) {
                    const oim = new THREE.InstancedMesh(instancedMesh.geometry, outlineMat, maxInstances);
                    oim.frustumCulled = false;
                    oim.count = 0;
                    oim.visible = this._outlineEnabled;
                    this._outlineInstancedMeshes.push(oim);
                    this._scene.add(oim);
                }

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

        // Physics
        let rigidBody = null;
        if (this._RAPIER && this._world) {
            const rbDesc = this._RAPIER.RigidBodyDesc.fixed()
                .setTranslation(position.x, position.y, position.z)
                .setRotation({ x: alignQuat.x, y: alignQuat.y, z: alignQuat.z, w: alignQuat.w });
            rigidBody = this._world.createRigidBody(rbDesc);

            // Simple cylinder/cuboid collider for the lamp pole
            // height is roughly 4 * scale, radius 0.2 * scale
            const colDesc = this._RAPIER.ColliderDesc.cylinder(2 * scale, 0.2 * scale);
            this._world.createCollider(colDesc, rigidBody);
        }

        // Track instance
        const index = this._instances.length;
        this._instances.push({ matrix: dummy.matrix.clone(), pos: position.clone(), scale, rigidBody });

        // Update InstancedMeshes
        for (const { instancedMesh } of this._instancedMeshes) {
            instancedMesh.setMatrixAt(index, dummy.matrix);
            instancedMesh.count = this._instances.length;
            instancedMesh.instanceMatrix.needsUpdate = true;
        }
        // Sync outline InstancedMeshes
        for (const oim of this._outlineInstancedMeshes) {
            oim.setMatrixAt(index, dummy.matrix);
            oim.count = this._instances.length;
            oim.instanceMatrix.needsUpdate = true;
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
        for (const inst of this._instances) {
            if (inst.rigidBody && this._world) {
                this._world.removeRigidBody(inst.rigidBody);
            }
        }
        this._instances = [];
        for (const { instancedMesh } of this._instancedMeshes) {
            instancedMesh.count = 0;
            instancedMesh.instanceMatrix.needsUpdate = true;
        }
        for (const oim of this._outlineInstancedMeshes) {
            oim.count = 0;
            oim.instanceMatrix.needsUpdate = true;
        }
    }

    setOutlineEnabled(v) {
        this._outlineEnabled = v;
        for (const oim of this._outlineInstancedMeshes) oim.visible = v;
    }

    setOutlineColor(hexString) {
        this._outlineColorUniform.value.set(hexString);
    }

    setOutlineThickness(v) {
        this._outlineThicknessUniform.value = v;
    }

    /**
     * Drive lamp emission from the scene day/night cycle.
     * t = 1.0 → full day  (no emission)
     * t = 0.0 → full night (full emission)
     */
    setTimeOfDay(t) {
        const night = 1 - t; // 0 = day, 1 = night
        for (const { instancedMesh } of this._instancedMeshes) {
            if (instancedMesh.name === 'Plane_2' && instancedMesh.material) {
                instancedMesh.material.emissiveIntensity = night * this._nightEmissiveIntensity;
                instancedMesh.material.opacity = night;
            }
        }
    }

    updateLights(intensity, distance, color, emissiveIntensity) {
        if (emissiveIntensity !== undefined) this._nightEmissiveIntensity = emissiveIntensity;
        if (emissiveIntensity !== undefined || color !== undefined) {
            for (const { instancedMesh } of this._instancedMeshes) {
                if (instancedMesh.name === 'Plane_2') {
                    if (instancedMesh.material) {
                        if (color !== undefined) instancedMesh.material.emissive.set(color);
                        // emissiveIntensity is driven by setTimeOfDay — don't set directly here
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
        for (const oim of this._outlineInstancedMeshes) {
            this._scene.remove(oim);
            oim.material?.dispose();
        }
        this._outlineInstancedMeshes = [];
    }
}
