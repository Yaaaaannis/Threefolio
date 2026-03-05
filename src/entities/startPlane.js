// startPlane.js — Decorative plane GLB placed near the Hub World spawn.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import { color, time, sin, mix, float, texture, uniform, vec3, normalView } from 'three/tsl';

export class StartPlane {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Vector3} [position]
     * @param {number} [scale]
     * @param {function} [onEnter]
     */
    constructor(scene, position = new THREE.Vector3(0, 0, 0), scale = 1, RAPIER = null, rapierWorld = null, onEnter = null) {
        console.log('[StartPlane] constructor called, pos=', position);
        this._scene = scene;
        this._root = null;
        this._rapierWorld = rapierWorld;
        this._rigidBody = null;
        this._onEnter = onEnter;
        this._glowLight = null;
        this._proximityUniform = uniform(0); // Tracks proximity in the shader

        // Surface normal for the planet surface at this position
        const PLANET_CENTER = new THREE.Vector3(0, -50, 0);
        this._surfaceNormal = new THREE.Vector3().subVectors(position, PLANET_CENTER).normalize();
        this._position = position.clone();

        // Track enter key for portal
        this._enterPressed = false;
        this._keydownHandler = (e) => {
            if (e.code === 'Enter') this._enterPressed = true;
        };
        this._keyupHandler = (e) => {
            if (e.code === 'Enter') this._enterPressed = false;
        };
        window.addEventListener('keydown', this._keydownHandler);
        window.addEventListener('keyup', this._keyupHandler);

        // UI Label shown when standing on pad
        this._labelMesh = this._createLabel(scene, position);
        this._labelOpacity = 0;

        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

        const loader = new GLTFLoader();
        loader.setDRACOLoader(dracoLoader);
        loader.load(
            '/models/plane.glb',
            (gltf) => {
                console.log('[Model loaded] plane.glb', gltf.scene);
                this._root = gltf.scene;
                this._root.scale.setScalar(scale);
                // Align plane to the spherical planet surface
                const PLANET_CENTER = new THREE.Vector3(0, -50, 0); // Assuming standard HubWorld planet
                const surfaceNormal = new THREE.Vector3()
                    .subVectors(position, PLANET_CENTER)
                    .normalize();

                // Align Y-up of the plane to match the surface normal
                const alignQuat = new THREE.Quaternion()
                    .setFromUnitVectors(new THREE.Vector3(0, 1, 0), surfaceNormal);

                this._root.quaternion.copy(alignQuat);
                this._root.position.copy(position);

                scene.add(this._root);
                // Need to update matrices to properly bake their positions into the colliders
                this._root.updateMatrixWorld(true);

                if (RAPIER && rapierWorld) {
                    // Do NOT set position/rotation here.
                    // The Trimesh collider vertices will be extracted using matrixWorld,
                    // which already includes the position and rotation of this._root.
                    // If we set translation on the rigid body too, it double-transforms the collider.
                    this._rigidBody = rapierWorld.createRigidBody(
                        RAPIER.RigidBodyDesc.fixed()
                    );
                }

                this._startMesh = null;

                this._root.traverse(node => {
                    if (node.isMesh) {
                        node.castShadow = true;
                        node.receiveShadow = true;

                        const name = node.name.toLowerCase();
                        if (name.includes('socle')) {
                            const oldMat = node.material;
                            node.material = new THREE.MeshToonMaterial({
                                color: oldMat.color || new THREE.Color(0xffffff),
                                map: oldMat.map || null,
                                transparent: oldMat.transparent,
                                opacity: oldMat.opacity
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
                        } else if (name.includes('start')) {
                            this._startMesh = node;
                            this._startMesh.position.y += 0.03;

                            const oldMat = node.material;
                            let baseColorNode;

                            if (oldMat && oldMat.map) {
                                baseColorNode = texture(oldMat.map);
                                const pulse = mix(
                                    float(0.9),
                                    float(1.5),
                                    sin(time.mul(3.0)).remap(-1, 1, 0, 1)
                                );

                                const yellowColor = color(0xffd700);
                                // Proximity boost: make it super bright (Bloom) when active
                                const boost = this._proximityUniform.mul(2.0);

                                node.material = new MeshBasicNodeMaterial({
                                    colorNode: baseColorNode.mul(yellowColor).mul(pulse).add(boost),
                                    transparent: true,
                                    opacity: 0.95
                                });
                            } else {
                                const baseYellow = color(0xffd700);
                                const pulse = mix(
                                    float(0.8),
                                    float(1.2),
                                    sin(time.mul(3.0)).remap(-1, 1, 0, 1)
                                );

                                const boost = this._proximityUniform.mul(3.0);

                                node.material = new MeshBasicNodeMaterial({
                                    colorNode: baseYellow.mul(pulse).add(boost),
                                    transparent: true,
                                    opacity: 0.95
                                });
                            }

                            // PointLight: émet de la vraie lumière jaune dans la scène
                            // Wide distance to light the whole area, not just a point
                            this._glowLight = new THREE.PointLight(0xffd700, 20.0, 30);
                            const lightPos = this._position.clone().addScaledVector(this._surfaceNormal, 3.0);
                            this._glowLight.position.copy(lightPos);
                            scene.add(this._glowLight);

                            // NO physics collider for the 'start' part (intangible)
                        }
                    }
                });
            },
            undefined,
            (err) => console.error('[Model ERROR] plane.glb', err)
        );
    }

    _createLabel(scene, basePos) {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#111';
        ctx.roundRect(128, 24, 256, 80, 20);
        ctx.fill();

        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 4;
        ctx.stroke();

        ctx.font = 'bold 40px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#00ffff';
        ctx.fillText('PRESS ENTER', 256, 64);

        const tex = new THREE.CanvasTexture(canvas);
        const geo = new THREE.PlaneGeometry(3, 0.75);
        const mat = new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(geo, mat);
        // Positioned 4 units above the pad
        mesh.position.copy(basePos).add(new THREE.Vector3(0, 4, 0));
        scene.add(mesh);

        return mesh;
    }

    update(dt, playerPos) {
        if (!this._startMesh || !playerPos || !this._root) return;

        // Calculate horizontal distance to the plane to detect if the player is on it
        const dx = playerPos.x - this._root.position.x;
        const dz = playerPos.z - this._root.position.z;
        const distSq = dx * dx + dz * dz;

        // Within ~6 units radius (36 squared) to account for scale 7 pad
        const isNear = distSq < 36.0;

        // Smoothly update the proximity uniform for the shader
        const targetProx = isNear ? 1.0 : 0.0;
        this._proximityUniform.value += (targetProx - this._proximityUniform.value) * dt * 4.0;

        // Always make it float gently (Mario Galaxy style)
        // Flotte entre sa hauteur de base (décalée de 0.03 au chargement) et -0.002 en dessous.
        if (!this._floatAccumulator) this._floatAccumulator = 0;
        this._floatAccumulator += dt;

        if (this._baseStartY === undefined) {
            this._baseStartY = this._startMesh.position.y;
        }

        // Float between 0 and a larger noticeable offset (-0.06 overall)
        // (Math.sin(...) - 1.0) goes from -2.0 to 0.0
        // -2.0 * 0.03 = -0.06
        const floatOffset = (Math.sin(this._floatAccumulator * 3.0) - 1.0) * 0.01;
        this._startMesh.position.y = this._baseStartY + floatOffset;

        // Pulse la lumière en sync avec le TSL emissive (même courbe sin, côté CPU)
        if (this._glowLight) {
            const t = Math.sin(this._floatAccumulator * 3.0) * 0.5 + 0.5; // 0..1
            const baseIntensity = 8.0 + t * 15.0; // Base pulse
            // Boost intensity further when player is on the pad
            this._glowLight.intensity = baseIntensity + this._proximityUniform.value * 20.0;
        }

        if (isNear) {
            this._startMesh.rotation.y -= dt * 2.0;

            // Trigger logic: if player is on pad and presses Enter
            if (this._enterPressed && this._onEnter) {
                this._onEnter();
                this._enterPressed = false; // Prevent multiple triggers immediately
            }
        }

        // Handle label visibility
        const targetOpacity = isNear ? 1 : 0;
        this._labelOpacity += (targetOpacity - this._labelOpacity) * dt * 5.0;
        if (this._labelMesh) {
            this._labelMesh.material.opacity = this._labelOpacity;
            // Make label face camera/player essentially by billboarding it to face Z
            // Or since we are an isometric game, just face it forward slightly tilted
            const dirToPlayer = new THREE.Vector3().subVectors(playerPos, this._labelMesh.position);
            dirToPlayer.y = 0; // Keep it upright
            if (dirToPlayer.lengthSq() > 0.001) {
                this._labelMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dirToPlayer.normalize());
            }
        }
    }

    dispose() {
        window.removeEventListener('keydown', this._keydownHandler);
        window.removeEventListener('keyup', this._keyupHandler);

        if (this._labelMesh) {
            this._scene.remove(this._labelMesh);
            this._labelMesh.geometry.dispose();
            this._labelMesh.material.map.dispose();
            this._labelMesh.material.dispose();
            this._labelMesh = null;
        }

        if (this._rigidBody && this._rapierWorld) {
            this._rapierWorld.removeRigidBody(this._rigidBody);
            this._rigidBody = null;
        }

        if (this._glowLight) {
            this._scene.remove(this._glowLight);
            this._glowLight = null;
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
    }
}
