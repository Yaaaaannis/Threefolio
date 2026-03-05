// football.js — Soccer ball (dynamic physics) + goal post (fixed, on sphere surface)
// Includes goal detection, confetti celebration, and GOAL!! banner trigger

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const PLANET_RADIUS = 50;
const PLANET_CENTER = new THREE.Vector3(0, -PLANET_RADIUS, 0);
const GRAVITY = 20;

// Goal is near the brick wall spawn (wallStartPos ≈ (-6, 0, 8))
// Direction from planet center (0,-50,0) to (- 6,0,8) = (-6, 50, 8)
const GOAL_WORLD_DIR = new THREE.Vector3(-6, 100, 8).normalize();
const GOAL_SURFACE_POS = PLANET_CENTER.clone().addScaledVector(GOAL_WORLD_DIR, PLANET_RADIUS);
const GOAL_TRIGGER_RADIUS = 3.5;

export class Football {
    /**
     * @param {THREE.Scene} scene
     * @param {import('@dimforge/rapier3d-compat')} RAPIER
     * @param {import('@dimforge/rapier3d-compat').World} world
     */
    constructor(scene, RAPIER, world) {
        this.scene = scene;
        this.RAPIER = RAPIER;
        this.world = world;
        this.ballMesh = null;
        this.ballBody = null;
        this.goalMesh = null;  // stored for dispose
        this.goalBody = null;  // stored for dispose
        this.goalScored = false;
        this._goalCooldown = 0;

        // ── Confetti particle system ──────────────────────────────────────
        this._confetti = null;
        this._confettiActive = false;
        this._confettiTime = 0;
        this._confettiVelocities = [];
        this._setupConfetti(scene);

        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
        const loader = new GLTFLoader();
        loader.setDRACOLoader(dracoLoader);

        // ── Goal post: fixed, placed on sphere surface near brick wall ────
        const goalNormal = GOAL_WORLD_DIR.clone();
        // Align Y axis to surface normal, then rotate 180° around it to flip direction
        const uprightQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), goalNormal);
        const flipQuat = new THREE.Quaternion().setFromAxisAngle(goalNormal, Math.PI);
        const goalQuat = flipQuat.multiply(uprightQuat);

        loader.load('/models/3d_model_of_soccer__football_goal_post.glb', (gltf) => {
            console.log('[Model loaded] football_goal_post.glb');
            const goal = gltf.scene;

            // Scale to reasonable world size
            const box = new THREE.Box3().setFromObject(goal);
            const size = box.getSize(new THREE.Vector3());
            const targetSize = 9; // 6 × 1.3
            const scale = targetSize / Math.max(size.x, size.y, size.z);
            goal.scale.setScalar(scale);

            goal.position.copy(GOAL_SURFACE_POS);
            goal.quaternion.copy(goalQuat);

            goal.traverse(node => {
                if (node.isMesh) {
                    node.castShadow = true;
                    node.receiveShadow = true;
                }
            });

            this.goalMesh = goal; // store for dispose
            scene.add(goal);

            // Fixed physics collider so the ball can bounce off the goal correctly
            goal.updateMatrixWorld(true);

            // We use a fixed body at the center to parent our colliders
            const worldBox = new THREE.Box3().setFromObject(goal);
            const worldCenter = worldBox.getCenter(new THREE.Vector3());

            const rbDesc = this.RAPIER.RigidBodyDesc.fixed()
                .setTranslation(worldCenter.x, worldCenter.y, worldCenter.z);
            this.goalBody = this.world.createRigidBody(rbDesc);

            // Create precise trimesh colliders for every mesh in the goal
            goal.traverse(node => {
                if (node.isMesh && node.geometry) {
                    node.updateMatrixWorld(true);

                    const geom = node.geometry;
                    if (geom.attributes.position) {
                        const vArray = geom.attributes.position.array;
                        const vertices = new Float32Array(vArray.length);

                        // Convert local vertices to world coordinates manually
                        const vec = new THREE.Vector3();
                        for (let i = 0; i < vArray.length; i += 3) {
                            vec.set(vArray[i], vArray[i + 1], vArray[i + 2]);
                            vec.applyMatrix4(node.matrixWorld);
                            // Important: Shift vertices so they are relative to the RigidBody's translation
                            vertices[i] = vec.x - worldCenter.x;
                            vertices[i + 1] = vec.y - worldCenter.y;
                            vertices[i + 2] = vec.z - worldCenter.z;
                        }

                        let indices;
                        if (geom.index) {
                            indices = new Uint32Array(geom.index.array);
                        } else {
                            indices = new Uint32Array(vertices.length / 3);
                            for (let i = 0; i < indices.length; i++) indices[i] = i;
                        }

                        const colliderDesc = this.RAPIER.ColliderDesc.trimesh(vertices, indices)
                            .setFriction(0.3)
                            .setRestitution(0.4);

                        this.world.createCollider(colliderDesc, this.goalBody);
                    }
                }
            });
        }, undefined, (err) => console.error('Failed to load goal:', err));

        // ── Soccer ball: dynamic, with spherical gravity ──────────────────
        const ballSpawnPos = PLANET_CENTER.clone().addScaledVector(
            new THREE.Vector3(0, 1, 0), PLANET_RADIUS + 1.5
        );

        loader.load('/models/soccer_ball__football.glb', (gltf) => {
            console.log('[Model loaded] soccer_ball.glb');
            this.ballMesh = gltf.scene;

            const box = new THREE.Box3().setFromObject(this.ballMesh);
            const size = box.getSize(new THREE.Vector3());
            const targetSize = 1.2;
            const scale = targetSize / Math.max(size.x, size.y, size.z);
            this.ballMesh.scale.setScalar(scale);

            this.ballMesh.traverse(node => {
                if (node.isMesh) {
                    node.castShadow = true;
                    node.receiveShadow = true;
                }
            });

            scene.add(this.ballMesh);
        }, undefined, (err) => console.error('Failed to load soccer ball:', err));

        // Rapier ball physics
        const BALL_RADIUS = 0.6;
        const rbDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(ballSpawnPos.x, ballSpawnPos.y, ballSpawnPos.z)
            .setLinearDamping(0.4)
            .setAngularDamping(0.7);
        this.ballBody = world.createRigidBody(rbDesc);
        world.createCollider(
            RAPIER.ColliderDesc.ball(BALL_RADIUS).setRestitution(0.65).setFriction(0.9),
            this.ballBody
        );

        // UI banner ref
        this._banner = document.getElementById('goal-banner');
        this._bannerTimeout = null;
    }

    _setupConfetti(scene) {
        this.CONFETTI_COUNT = 150;
        const geo = new THREE.BoxGeometry(0.25, 0.5, 0.05); // Flat confetti shape
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.1 });

        this._confettiMesh = new THREE.InstancedMesh(geo, mat, this.CONFETTI_COUNT);
        this._confettiMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this._confettiMesh.frustumCulled = false;

        // Per-instance colors
        const palette = [
            new THREE.Color(0xff3366), new THREE.Color(0xffcc00),
            new THREE.Color(0x33ccff), new THREE.Color(0x66ff66),
            new THREE.Color(0xff9900), new THREE.Color(0xcc44ff),
        ];
        this._confettiMesh.instanceColor = new THREE.InstancedBufferAttribute(
            new Float32Array(this.CONFETTI_COUNT * 3), 3
        );
        for (let i = 0; i < this.CONFETTI_COUNT; i++) {
            const c = palette[i % palette.length];
            this._confettiMesh.setColorAt(i, c);
        }
        this._confettiMesh.instanceColor.needsUpdate = true;

        // CPU physics state
        this._cPos = new Float32Array(this.CONFETTI_COUNT * 3); // positions
        this._cVel = new Float32Array(this.CONFETTI_COUNT * 3); // velocities
        this._confettiDummy = new THREE.Object3D();

        // Hide all initially (scale to 0)
        this._confettiDummy.scale.set(0, 0, 0);
        this._confettiDummy.updateMatrix();
        for (let i = 0; i < this.CONFETTI_COUNT; i++) {
            this._confettiMesh.setMatrixAt(i, this._confettiDummy.matrix);
        }
        this._confettiMesh.instanceMatrix.needsUpdate = true;

        scene.add(this._confettiMesh);
    }

    _triggerGoal() {
        if (this._goalCooldown > 0) return;
        this._goalCooldown = 5.0; // 5s cooldown before next goal

        // Show GOAL!! banner
        if (this._banner) {
            this._banner.classList.remove('hide', 'show');
            // Force reflow so animation restarts
            void this._banner.offsetWidth;
            this._banner.classList.add('show');
            clearTimeout(this._bannerTimeout);
            this._bannerTimeout = setTimeout(() => {
                this._banner.classList.remove('show');
                this._banner.classList.add('hide');
            }, 2500);
        }

        // Burst confetti from goal position
        const COUNT = this.CONFETTI_COUNT;
        const surfaceNormal = new THREE.Vector3().subVectors(GOAL_SURFACE_POS, PLANET_CENTER).normalize();
        for (let i = 0; i < COUNT; i++) {
            // Random start position near goal
            this._cPos[i * 3] = GOAL_SURFACE_POS.x + (Math.random() - 0.5) * 2;
            this._cPos[i * 3 + 1] = GOAL_SURFACE_POS.y + (Math.random() - 0.5) * 2;
            this._cPos[i * 3 + 2] = GOAL_SURFACE_POS.z + (Math.random() - 0.5) * 2;

            // Random burst velocity (mostly outward along normal + random XYZ)
            const speed = 4 + Math.random() * 8;
            const theta = Math.random() * Math.PI * 2;
            const phi = (Math.random() - 0.3) * Math.PI; // bias upward
            this._cVel[i * 3] = speed * (Math.sin(phi) * Math.cos(theta) + surfaceNormal.x * 0.5);
            this._cVel[i * 3 + 1] = speed * (Math.sin(phi) * Math.sin(theta) + surfaceNormal.y * 0.5);
            this._cVel[i * 3 + 2] = speed * (Math.cos(phi) + surfaceNormal.z * 0.5);
        }
        this._confettiActive = true;
        this._confettiTime = 0;
    }

    update(dt) {
        if (!this.ballBody) return;

        // Spherical gravity for ball
        const t = this.ballBody.translation();
        const pos3 = new THREE.Vector3(t.x, t.y, t.z);
        const upNormal = new THREE.Vector3().subVectors(pos3, PLANET_CENTER).normalize();
        const gImp = upNormal.clone().multiplyScalar(-GRAVITY * dt);
        this.ballBody.applyImpulse({ x: gImp.x, y: gImp.y, z: gImp.z }, true);

        // Sync ball mesh
        if (this.ballMesh) {
            const rot = this.ballBody.rotation();
            this.ballMesh.position.set(t.x, t.y, t.z);
            this.ballMesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
        }

        // Goal detection: is ball near the goal trigger zone?
        this._goalCooldown = Math.max(0, this._goalCooldown - dt);
        const distToGoal = pos3.distanceTo(GOAL_SURFACE_POS);
        if (distToGoal < GOAL_TRIGGER_RADIUS && this._goalCooldown === 0) {
            this._triggerGoal();
        }

        // Confetti update (InstancedMesh)
        if (this._confettiActive) {
            this._confettiTime += dt;
            const DURATION = 4.0;
            const COUNT = this.CONFETTI_COUNT;

            // Spherical gravity dir
            const gx = -upNormal.x * 9.8 * dt;
            const gy = -upNormal.y * 9.8 * dt;
            const gz = -upNormal.z * 9.8 * dt;

            const lifePct = Math.min(1, this._confettiTime / DURATION);

            for (let i = 0; i < COUNT; i++) {
                // Gravity
                this._cVel[i * 3] += gx;
                this._cVel[i * 3 + 1] += gy;
                this._cVel[i * 3 + 2] += gz;

                // Move
                this._cPos[i * 3] += this._cVel[i * 3] * dt;
                this._cPos[i * 3 + 1] += this._cVel[i * 3 + 1] * dt;
                this._cPos[i * 3 + 2] += this._cVel[i * 3 + 2] * dt;

                const alive = 1 - lifePct;
                this._confettiDummy.position.set(
                    this._cPos[i * 3], this._cPos[i * 3 + 1], this._cPos[i * 3 + 2]
                );
                this._confettiDummy.scale.setScalar(alive);
                this._confettiDummy.rotation.set(
                    this._confettiTime * 8 + i * 1.3,
                    this._confettiTime * 6 + i * 0.9,
                    this._confettiTime * 10 + i * 1.7
                );
                this._confettiDummy.updateMatrix();
                this._confettiMesh.setMatrixAt(i, this._confettiDummy.matrix);
            }
            this._confettiMesh.instanceMatrix.needsUpdate = true;

            if (this._confettiTime > DURATION) {
                // Hide
                this._confettiDummy.scale.set(0, 0, 0);
                this._confettiDummy.updateMatrix();
                for (let i = 0; i < COUNT; i++) {
                    this._confettiMesh.setMatrixAt(i, this._confettiDummy.matrix);
                }
                this._confettiMesh.instanceMatrix.needsUpdate = true;
                this._confettiActive = false;
            }
        }
    }

    /** Remove all scene objects and Rapier bodies created by this Football instance. */
    dispose() {
        const removeFromScene = (obj) => {
            if (!obj) return;
            this.scene.remove(obj);
            obj.traverse(c => {
                c.geometry?.dispose();
                if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
                else c.material?.dispose();
            });
        };
        removeFromScene(this.goalMesh);
        removeFromScene(this.ballMesh);
        removeFromScene(this._confettiMesh);
        if (this.goalBody) { try { this.world.removeRigidBody(this.goalBody); } catch (_) { } }
        if (this.ballBody) { try { this.world.removeRigidBody(this.ballBody); } catch (_) { } }
        this.goalMesh = this.ballMesh = this._confettiMesh = null;
        this.goalBody = this.ballBody = null;
    }
}
