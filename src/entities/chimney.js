import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import { color, float, uniform, normalLocal, positionLocal } from 'three/tsl';

export class Chimney {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Vector3} [position]
     * @param {number} [scale]
     */
    constructor(scene, position = new THREE.Vector3(0, 0, 0), scale = 1, RAPIER = null, rapierWorld = null) {
        this._scene = scene;
        this._root = null;
        this._rigidBody = null;
        this._rapierWorld = rapierWorld;
        this._time = 0;

        // Outline (inverted hull, TSL)
        this._outlineMeshes = [];
        this._outlineColorUniform = uniform(new THREE.Color(0x000000));
        this._outlineThicknessUniform = uniform(0.077);
        this._outlineEnabled = true;
        this._outlineMat = null;

        // Smoke setup
        this._particles = null;
        this._pMat = null;
        this._glowDisc = null;
        this._glowLight = null;
        this._setupSmoke(scene, position);

        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

        const loader = new GLTFLoader();
        loader.setDRACOLoader(dracoLoader);

        loader.load(
            '/models/chemine_blend.glb',
            (gltf) => {
                console.log('[Model loaded] chemine_blend.glb', gltf.scene);
                this._root = gltf.scene;
                this._root.scale.setScalar(scale);

                // Align chimney to the spherical planet surface
                const PLANET_CENTER = new THREE.Vector3(0, -50, 0); // Assuming standard HubWorld planet
                const surfaceNormal = new THREE.Vector3()
                    .subVectors(position, PLANET_CENTER)
                    .normalize();

                // Align Y-up of the chimney to match the surface normal
                const alignQuat = new THREE.Quaternion()
                    .setFromUnitVectors(new THREE.Vector3(0, 1, 0), surfaceNormal);

                this._root.quaternion.copy(alignQuat);
                this._root.position.copy(position);

                scene.add(this._root);

                // Update matrix to bake position and rotation into the mesh
                this._root.updateMatrixWorld(true);

                if (RAPIER && rapierWorld) {
                    this._rigidBody = rapierWorld.createRigidBody(
                        RAPIER.RigidBodyDesc.fixed()
                    );
                }

                // Apply Toon Material to all meshes and generate colliders
                this._root.traverse(node => {
                    if (node.isMesh) {
                        node.castShadow = true;
                        node.receiveShadow = true;

                        const oldMat = node.material;
                        node.material = new THREE.MeshToonMaterial({
                            color: new THREE.Color('#6D6D52'),
                            transparent: oldMat?.transparent || false,
                            opacity: oldMat?.opacity !== undefined ? oldMat.opacity : 1.0,
                            alphaTest: oldMat?.alphaTest || 0,
                            depthWrite: oldMat?.depthWrite !== undefined ? oldMat.depthWrite : true,
                            side: THREE.DoubleSide // Force DoubleSide because the mesh seems to have open or inverted faces
                        });

                        if (RAPIER && rapierWorld && this._rigidBody) {
                            node.updateMatrixWorld(true);
                            const geom = node.geometry;
                            if (geom && geom.attributes.position) {
                                const vArray = geom.attributes.position.array;
                                const vertices = new Float32Array(vArray.length);

                                const vec = new THREE.Vector3();
                                for (let i = 0; i < vArray.length; i += 3) {
                                    vec.set(vArray[i], vArray[i + 1], vArray[i + 2]);
                                    vec.applyMatrix4(node.matrixWorld);
                                    vertices[i] = vec.x;
                                    vertices[i + 1] = vec.y;
                                    vertices[i + 2] = vec.z;
                                }

                                let indices;
                                if (geom.index) {
                                    indices = new Uint32Array(geom.index.array);
                                } else {
                                    indices = new Uint32Array(vertices.length / 3);
                                    for (let i = 0; i < indices.length; i++) indices[i] = i;
                                }

                                const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices);
                                rapierWorld.createCollider(colliderDesc, this._rigidBody);
                            }
                        }
                    }
                });
                // ── Inverted hull outline (TSL, WebGPU-compatible) ────────
                this._outlineMat = new MeshBasicNodeMaterial({ side: THREE.BackSide });
                this._outlineMat.colorNode = this._outlineColorUniform;
                this._outlineMat.positionNode = positionLocal.add(
                    normalLocal.normalize().mul(this._outlineThicknessUniform)
                );

                // Collect meshes first, then add outline children — avoids
                // traverse visiting the newly added outline meshes and causing
                // infinite recursion (stack overflow).
                const meshNodes = [];
                this._root.traverse(node => { if (node.isMesh) meshNodes.push(node); });
                for (const node of meshNodes) {
                    const om = new THREE.Mesh(node.geometry, this._outlineMat);
                    om.visible = this._outlineEnabled;
                    node.add(om);
                    this._outlineMeshes.push(om);
                }
            },
            undefined,
            (err) => console.error('[Model ERROR] chemine_blend.glb', err)
        );
    }

    _setupSmoke(scene, basePosition) {
        // Each "puff" is an Object3D group with several small low-poly sphere sub-meshes
        this._PUFF_COUNT = 8;
        this._puffs = [];
        this._puffLifetime = new Float32Array(this._PUFF_COUNT);
        this._puffSpeed = new Float32Array(this._PUFF_COUNT);
        this._puffOffset = new Float32Array(this._PUFF_COUNT);

        const PLANET_CENTER = new THREE.Vector3(0, -50, 0);
        this._surfaceNormal = new THREE.Vector3().subVectors(basePosition, PLANET_CENTER).normalize();

        // Tangent vectors for lateral drift
        const upRef = Math.abs(this._surfaceNormal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        this._tangentA = new THREE.Vector3().crossVectors(this._surfaceNormal, upRef).normalize();
        this._tangentB = new THREE.Vector3().crossVectors(this._surfaceNormal, this._tangentA).normalize();

        // The chimney hole is at a certain height above the base — needs to match model scale
        // The model at scale=2 has its top opening roughly 4 units above position
        const chimneyTopOffset = 2.5;
        this._spawnPos = basePosition.clone().addScaledVector(this._surfaceNormal, chimneyTopOffset);
        // Manual lateral correction to align with the physical hole in the model
        this._spawnPos.x += 3;
        this._spawnPos.y += 0.5;

        // Shared toon-like grey material
        const pColor = color(0xcccccc);
        this._pMat = new MeshStandardNodeMaterial({
            colorNode: pColor,
            transparent: true,
            depthWrite: false,
            roughness: 1.0,
            metalness: 0.0,
        });

        // Create puffs: each is a group of 5-7 low-poly spheres at random local offsets
        const SPHERES_PER_PUFF = 6;
        for (let i = 0; i < this._PUFF_COUNT; i++) {
            const group = new THREE.Group();
            const puffRadius = 0.25 + Math.random() * 0.20;
            for (let j = 0; j < SPHERES_PER_PUFF; j++) {
                // IcosahedronGeometry (detail=1) gives the low-poly faceted look
                const sz = puffRadius * (0.7 + Math.random() * 0.6);
                const geo = new THREE.IcosahedronGeometry(sz, 1);
                const mesh = new THREE.Mesh(geo, this._pMat);
                // Random jitter in a sphere of radius ~puffRadius
                const angle = Math.random() * Math.PI * 2;
                const r = puffRadius * (0.4 + Math.random() * 0.6);
                const h = (Math.random() - 0.3) * puffRadius;
                mesh.position.set(
                    Math.cos(angle) * r,
                    h,
                    Math.sin(angle) * r
                );
                group.add(mesh);
            }

            this._puffLifetime[i] = Math.random(); // Stagger
            this._puffSpeed[i] = 0.3 + Math.random() * 0.3;
            this._puffOffset[i] = Math.random() * Math.PI * 2;
            this._puffs.push(group);
            scene.add(group);
        }

        this._puffBasePositions = [];
        for (let i = 0; i < this._PUFF_COUNT; i++) {
            // Spawn with tiny random horizontal spread (within chimney mouth)
            const jitter = 0.3;
            this._puffBasePositions.push(this._spawnPos.clone()
                .addScaledVector(this._tangentA, (Math.random() - 0.5) * jitter)
                .addScaledVector(this._tangentB, (Math.random() - 0.5) * jitter)
            );
        }

        // ── Glow disc — emissive yellow circle at smoke exit ──────────────
        const discGeo = new THREE.CircleGeometry(0.45, 16);
        const discMat = new THREE.MeshStandardMaterial({
            color: 0xffaa00,
            emissive: new THREE.Color(0xffaa00),
            emissiveIntensity: 2.5,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        this._glowDisc = new THREE.Mesh(discGeo, discMat);

        // Align disc to face along the surface normal (it spawns XY-plane by default)
        const alignQuat = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            this._surfaceNormal
        );
        this._glowDisc.quaternion.copy(alignQuat);
        // Place it just below the smoke spawn (slightly below the chimney top)
        this._glowDisc.position.copy(this._spawnPos)
            .addScaledVector(this._surfaceNormal, -0.5);
        this._glowDisc.renderOrder = 1;
        scene.add(this._glowDisc);

        // ── Point light above the disc for ambient warm glow ──────────────
        this._glowLight = new THREE.PointLight(0xffaa00, 3.0, 8.0);
        this._glowLight.position.copy(this._spawnPos)
            .addScaledVector(this._surfaceNormal, 0.3);
        scene.add(this._glowLight);
    }

    setOutlineEnabled(v) {
        this._outlineEnabled = v;
        for (const m of this._outlineMeshes) m.visible = v;
    }

    setOutlineColor(hexString) {
        this._outlineColorUniform.value.set(hexString);
    }

    setOutlineThickness(v) {
        this._outlineThicknessUniform.value = v;
    }

    _respawnPuff(i) {
        const jitter = 0.3;
        this._puffBasePositions[i] = this._spawnPos.clone()
            .addScaledVector(this._tangentA, (Math.random() - 0.5) * jitter)
            .addScaledVector(this._tangentB, (Math.random() - 0.5) * jitter);
        this._puffLifetime[i] = 0;
        this._puffOffset[i] = Math.random() * Math.PI * 2;
        this._puffs[i].scale.setScalar(0.01);
    }

    update(dt) {
        if (!this._puffs) return;
        this._time += dt;

        const MAX_HEIGHT = 7.0;
        const WIND_STRENGTH = 1.2; // How much it drifts sideways

        for (let i = 0; i < this._PUFF_COUNT; i++) {
            this._puffLifetime[i] += dt * this._puffSpeed[i];

            if (this._puffLifetime[i] > 1.0) {
                this._respawnPuff(i);
            }

            const t = this._puffLifetime[i];

            // Scale: pop in fast, grow big, then vanish
            const scaleBase = t < 0.15
                ? (t / 0.15)
                : t < 0.6
                    ? 1.0
                    : (1.0 - (t - 0.6) / 0.4);
            const s = Math.max(0.01, scaleBase * (0.65 + (i % 3) * 0.25));

            // Rise along surface normal
            const rise = t * MAX_HEIGHT;
            // Drift along tangentA (like wind)
            const drift = (Math.sin(this._puffOffset[i] + t * Math.PI) * 0.5 + t * 0.8) * WIND_STRENGTH;

            const base = this._puffBasePositions[i];
            const px = base.x + this._surfaceNormal.x * rise + this._tangentA.x * drift;
            const py = base.y + this._surfaceNormal.y * rise + this._tangentA.y * drift;
            const pz = base.z + this._surfaceNormal.z * rise + this._tangentA.z * drift;

            this._puffs[i].position.set(px, py, pz);
            this._puffs[i].scale.setScalar(s);
            // Slow spin of the group for variety
            this._puffs[i].rotation.y += dt * 0.3;
        }

        // Pulse the glow disc and light
        if (this._glowDisc && this._glowLight) {
            const pulse = 1.0 + 0.35 * Math.sin(this._time * 3.5);
            this._glowDisc.material.emissiveIntensity = 2.5 * pulse;
            this._glowDisc.material.opacity = 0.7 + 0.15 * Math.sin(this._time * 2.8);
            this._glowLight.intensity = 3.0 * pulse;
        }
    }

    dispose() {
        if (this._rigidBody && this._rapierWorld) {
            this._rapierWorld.removeRigidBody(this._rigidBody);
            this._rigidBody = null;
        }

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

        if (this._puffs) {
            for (const group of this._puffs) {
                this._scene.remove(group);
                group.traverse(c => { c.geometry?.dispose(); });
            }
            this._pMat?.dispose();
            this._puffs = null;
        }

        if (this._glowDisc) {
            this._scene.remove(this._glowDisc);
            this._glowDisc.geometry?.dispose();
            this._glowDisc.material?.dispose();
            this._glowDisc = null;
        }
        if (this._glowLight) {
            this._scene.remove(this._glowLight);
            this._glowLight = null;
        }
    }
}
