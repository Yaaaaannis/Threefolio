// socialZone.js — A social-media themed zone placed in front of the Antenna.
// • TSL MeshStandardNodeMaterial ring that pulses blue when player is near
// • Wi-Fi / broadcast icon shape as center decoration
// • Rising particles (CPU InstancedMesh) that drift upward along the surface normal
// • All powered by Three.js TSL (tsl / webgpu node materials)

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, uniform, sin, cos, time, mix, float, vec3,
    positionWorld, positionLocal, normalWorld, abs, pow, smoothstep
} from 'three/tsl';

const PLANET_CENTER = new THREE.Vector3(0, -50, 0);
const PLANET_RADIUS = 50;

// ── Small helper: build a ring with label geometry ─────────────────────────
function makeRingMesh(inner, outer, segments, mat) {
    const geo = new THREE.RingGeometry(inner, outer, segments);
    return new THREE.Mesh(geo, mat);
}

export class SocialZone {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Vector3} position  - world position on sphere surface
     * @param {function} [onEnter]      - optional callback when player steps in
     * @param {any} [RAPIER]            - Rapier physics library
     * @param {any} [world]             - Rapier world instance
     */
    constructor(scene, position, onEnter = null, RAPIER = null, world = null) {
        this._scene = scene;
        this._onEnter = onEnter;
        this._center = position.clone();
        this._radius = 2.0;

        this._RAPIER = RAPIER;
        this._world = world;
        this._rigidBody = null; // Static parts
        this._dynamicParts = []; // { mesh, body }

        this._isPlayerInside = false;
        this._entered = false;
        this._time = 0;

        // Surface normal at this position
        const surfaceNormal = new THREE.Vector3()
            .subVectors(position, PLANET_CENTER)
            .normalize();
        this._surfaceNormal = surfaceNormal.clone();

        // Quaternion aligning Z+ to surface normal (RingGeometry faces +Z)
        const ringQuat = new THREE.Quaternion()
            .setFromUnitVectors(new THREE.Vector3(0, 0, 1), surfaceNormal);

        // ── TSL ring material ──────────────────────────────────────────────
        this._activeUniform = uniform(0.0);  // 0 = idle, 1 = active

        const idleColor = color(0x1a4aff);
        const activeColor = color(0x00aaff);
        const finalColor = mix(idleColor, activeColor, this._activeUniform);

        // Emissive pulses with time when active
        const pulse = mix(
            float(0.4),
            float(0.5).add(sin(time.mul(6.0)).mul(0.4)),
            this._activeUniform
        );

        this._ringMat = new MeshStandardNodeMaterial({
            colorNode: finalColor,
            emissiveNode: finalColor.mul(pulse),
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            roughness: 0.2,
            metalness: 0.5,
        });

        // ── Outer decorative ring ──────────────────────────────────────────
        const outerRing = makeRingMesh(this._radius - 0.18, this._radius, 64, this._ringMat);
        outerRing.quaternion.copy(ringQuat);
        outerRing.position.copy(position).addScaledVector(surfaceNormal, 0.06);
        scene.add(outerRing);
        this._outerRing = outerRing;

        // ── Inner thin ring ────────────────────────────────────────────────
        const innerRing = makeRingMesh(0.08, 0.18, 32, this._ringMat);
        innerRing.quaternion.copy(ringQuat);
        innerRing.position.copy(position).addScaledVector(surfaceNormal, 0.07);
        scene.add(innerRing);
        this._innerRing = innerRing;

        // ── LinkedIn Model & Beam ──────────────────────────────────────────
        this._model = null;
        this._beam = null;
        this._beamAnchor = new THREE.Group();
        this._scene.add(this._beamAnchor);

        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
        const loader = new GLTFLoader();
        loader.setDRACOLoader(dracoLoader);

        loader.load('/models/linkedin.glb', (gltf) => {
            this._model = gltf.scene;
            this._model.scale.setScalar(3.0); // Scaled up to 3.0

            // Align model to surface
            const alignQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), this._surfaceNormal);
            this._model.quaternion.copy(alignQuat);
            this._model.position.copy(position).addScaledVector(this._surfaceNormal, 0.4); // Lowered to 0.4
            this._scene.add(this._model);

            this._model.updateMatrixWorld(true);

            if (this._RAPIER && this._world) {
                this._rigidBody = this._world.createRigidBody(this._RAPIER.RigidBodyDesc.fixed());
            }

            // Find the dot of the "i" and parts for physics
            let iDot = null;
            this._model.traverse(node => {
                if (node.isMesh) {
                    if (node.name.toLowerCase().includes('sphere') || node.name.toLowerCase().includes('dot')) {
                        iDot = node;
                    }

                    // Physics: Apply only to node "n"
                    if (node.name.toLowerCase() === 'n' && this._RAPIER && this._world) {
                        const geom = node.geometry;
                        if (geom && geom.attributes.position) {
                            // Detach mesh so it can move independently
                            const worldPos = new THREE.Vector3();
                            const worldQuat = new THREE.Quaternion();
                            const worldScale = new THREE.Vector3();
                            node.getWorldPosition(worldPos);
                            node.getWorldQuaternion(worldQuat);
                            node.getWorldScale(worldScale);

                            this._scene.add(node);
                            node.position.copy(worldPos);
                            node.quaternion.copy(worldQuat);
                            node.scale.copy(worldScale);

                            // Rigid Body
                            const rbDesc = this._RAPIER.RigidBodyDesc.dynamic()
                                .setTranslation(worldPos.x, worldPos.y, worldPos.z)
                                .setRotation(worldQuat);
                            const body = this._world.createRigidBody(rbDesc);

                            // Collider (Simplified or Trimesh)
                            const vArray = geom.attributes.position.array;
                            const vertices = new Float32Array(vArray.length);
                            for (let i = 0; i < vArray.length; i += 3) {
                                const v = new THREE.Vector3(vArray[i], vArray[i + 1], vArray[i + 2]);
                                v.multiply(worldScale); // Apply local scale
                                vertices[i] = v.x;
                                vertices[i + 1] = v.y;
                                vertices[i + 2] = v.z;
                            }

                            let indices;
                            if (geom.index) {
                                indices = new Uint32Array(geom.index.array);
                            } else {
                                indices = new Uint32Array(vertices.length / 3);
                                for (let i = 0; i < indices.length; i++) indices[i] = i;
                            }

                            const colliderDesc = this._RAPIER.ColliderDesc.trimesh(vertices, indices)
                                .setRestitution(0.5)
                                .setFriction(0.5);
                            this._world.createCollider(colliderDesc, body);

                            this._dynamicParts.push({ mesh: node, body: body });
                        }
                    } else if (node.name.toLowerCase() !== 'n' && this._RAPIER && this._world && this._rigidBody) {
                        // Static logic for other nodes if we had complex static ones, 
                        // but currently we just want 'n' to be special.
                    }

                    // Apply nice material
                    node.material = new THREE.MeshToonMaterial({
                        color: new THREE.Color(0x00a0dc), // LinkedIn Blue
                        side: THREE.DoubleSide
                    });
                }
            });

            // If not found by name, try fallback or just use a default offset
            const beamPos = new THREE.Vector3();
            if (iDot) {
                iDot.material.emissive = new THREE.Color(0x00a0dc);
                iDot.material.emissiveIntensity = 2.0;
                iDot.getWorldPosition(beamPos);
            } else {
                // Fallback position if dot not found
                beamPos.copy(this._model.position).addScaledVector(this._surfaceNormal, 1.2);
            }

            this._setupBeam(beamPos);
        });

        // ── Label (canvas texture) ─────────────────────────────────────────
        this._label = this._makeLabel('LINKEDIN', 0x00a0dc, position, surfaceNormal, 8.0); // Raised to 8.0

        // ── Particles (InstancedMesh, CPU driven) ─────────────────────────
        this._setupParticles(scene, position, surfaceNormal);
    }

    _setupBeam(pos) {
        // Beacon beam - using the user's "God Rays" approach
        const beamGeom = new THREE.ConeGeometry(0.5, 8, 32);
        // Tip at +4, Base at -4.
        // Translate to have tip at 0: translate(0, -4, 0)
        beamGeom.translate(0, -4, 0);
        // Rotate PI/2: Tip at 0, Base at Z=-8
        beamGeom.rotateX(Math.PI / 2);

        // ── TSL Gradient Material ──────────────────────────────────────────
        // Fade from Z=0 (opaque) to Z=-8 (transparent)
        const beamOpacity = smoothstep(float(-8.0), float(-0.5), positionLocal.z).mul(float(0.8));
        const beamColor = color(0xd1d100);

        const beamMat = new MeshStandardNodeMaterial({
            colorNode: beamColor,
            emissiveNode: beamColor.mul(float(2.0)),
            opacityNode: beamOpacity,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            roughness: 0,
            metalness: 0
        });

        this._beam = new THREE.Mesh(beamGeom, beamMat);

        // The anchor will rotate around the surface normal (UP)
        // Offset the beam higher than the model as requested
        this._beamAnchor.position.copy(pos).addScaledVector(this._surfaceNormal, 3.0);
        // Initial orientation: point along surface normal (UP)
        const alignQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._surfaceNormal);
        this._beamAnchor.quaternion.copy(alignQuat);

        this._beamAnchor.add(this._beam);

        // Tilt the beam away from vertical towards horizontal (out into space)
        this._beam.rotation.x = -1.0;
    }

    // ── Label ────────────────────────────────────────────────────────────────
    _makeLabel(text, hexColor, surfacePoint, normal, heightAbove) {
        const canvas = document.createElement('canvas');
        canvas.width = 512; canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 512, 128);

        // Glow
        ctx.shadowColor = `#${hexColor.toString(16).padStart(6, '0')}`;
        ctx.shadowBlur = 24;
        ctx.font = 'bold 64px Arial';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, 256, 80);

        const tex = new THREE.CanvasTexture(canvas);
        const geo = new THREE.PlaneGeometry(4, 1);
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(surfacePoint).addScaledVector(normal, heightAbove);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        this._scene.add(mesh);
        return mesh;
    }

    // ── Particles ────────────────────────────────────────────────────────────
    _setupParticles(scene, position, surfaceNormal) {
        this._PARTICLE_COUNT = 80;
        const geo = new THREE.BoxGeometry(0.06, 0.06, 0.55);

        const pColor = color(0x00a0dc);
        const pMat = new MeshStandardNodeMaterial({
            colorNode: pColor,
            emissiveNode: pColor.mul(float(1.5)),
            transparent: true,
            depthWrite: false,
            roughness: 0,
            metalness: 0,
        });
        this._pMat = pMat;

        this._particles = new THREE.InstancedMesh(geo, pMat, this._PARTICLE_COUNT);
        this._particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this._particles.frustumCulled = false;

        this._pPos = new Float32Array(this._PARTICLE_COUNT * 3);
        this._pLifetime = new Float32Array(this._PARTICLE_COUNT);
        this._pSpeed = new Float32Array(this._PARTICLE_COUNT);
        this._pOffset = new Float32Array(this._PARTICLE_COUNT);
        this._pDummy = new THREE.Object3D();

        const arbUp = Math.abs(surfaceNormal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        this._tangentA = new THREE.Vector3().crossVectors(surfaceNormal, arbUp).normalize();
        this._tangentB = new THREE.Vector3().crossVectors(surfaceNormal, this._tangentA).normalize();
        this._spawnPos = position.clone();

        for (let i = 0; i < this._PARTICLE_COUNT; i++) {
            this._pLifetime[i] = Math.random();
            this._pSpeed[i] = 0.3 + Math.random() * 0.5;
            this._pOffset[i] = Math.random() * Math.PI * 2;
            this._spawnParticle(i);
        }
        scene.add(this._particles);
    }

    _spawnParticle(i) {
        const angle = this._pOffset[i];
        const r = this._radius;
        const px = this._spawnPos.x + this._tangentA.x * Math.cos(angle) * r + this._tangentB.x * Math.sin(angle) * r;
        const py = this._spawnPos.y + this._tangentA.y * Math.cos(angle) * r + this._tangentB.y * Math.sin(angle) * r;
        const pz = this._spawnPos.z + this._tangentA.z * Math.cos(angle) * r + this._tangentB.z * Math.sin(angle) * r;
        this._pPos[i * 3] = px;
        this._pPos[i * 3 + 1] = py;
        this._pPos[i * 3 + 2] = pz;
        this._pLifetime[i] = 0;
    }

    /** @param {number} dt @param {THREE.Vector3} playerPos @param {number} absTime */
    update(dt, playerPos, absTime) {
        this._time += dt;

        // ── Physics Sync ──────────────────────────────────────────────────
        if (this._dynamicParts.length > 0) {
            for (const part of this._dynamicParts) {
                const { mesh, body } = part;

                // 1. Planet Gravity
                const pos = body.translation();
                const gravityDir = new THREE.Vector3(pos.x, pos.y, pos.z)
                    .sub(PLANET_CENTER)
                    .normalize()
                    .multiplyScalar(-9.8 * body.mass());
                body.applyImpulse(gravityDir.multiplyScalar(dt), true);

                // 2. Sync Transform
                mesh.position.copy(body.translation());
                mesh.quaternion.copy(body.rotation());
            }
        }

        const dist = playerPos.distanceTo(this._center);
        const inside = dist < this._radius;

        if (inside !== this._isPlayerInside) {
            this._isPlayerInside = inside;
            if (!inside) this._entered = false;
        }

        if (inside && !this._entered) {
            this._entered = true;
            this._onEnter?.();
        }

        const targetActive = inside ? 1.0 : 0.0;
        this._activeUniform.value += (targetActive - this._activeUniform.value) * Math.min(1, dt * 6);

        // ── Beam Rotation ──────────────────────────────────────────────────
        if (this._beamAnchor) {
            this._beamAnchor.rotateOnAxis(new THREE.Vector3(0, 0, 1), dt * 1.5);
        }

        // ── Particles ─────────────────────────────────────────────────────
        const TRAVEL_HEIGHT = 4.0;
        const streakQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._surfaceNormal);

        for (let i = 0; i < this._PARTICLE_COUNT; i++) {
            if (!this._isPlayerInside) {
                this._pDummy.scale.setScalar(0);
                this._pDummy.updateMatrix();
                this._particles.setMatrixAt(i, this._pDummy.matrix);
                continue;
            }

            this._pLifetime[i] += dt * this._pSpeed[i];
            if (this._pLifetime[i] > 1.0) this._spawnParticle(i);

            const t = this._pLifetime[i];
            const scale = t < 0.1 ? t / 0.1 : t > 0.8 ? (1 - t) / 0.2 : 1.0;
            const rise = t * TRAVEL_HEIGHT;
            const drift = Math.sin(t * Math.PI * 2 + this._pOffset[i]) * 0.3;

            const bx = this._pPos[i * 3] + this._surfaceNormal.x * rise + this._tangentA.x * drift;
            const by = this._pPos[i * 3 + 1] + this._surfaceNormal.y * rise + this._tangentA.y * drift;
            const bz = this._pPos[i * 3 + 2] + this._surfaceNormal.z * rise + this._tangentA.z * drift;

            this._pDummy.position.set(bx, by, bz);
            this._pDummy.quaternion.copy(streakQuat);
            this._pDummy.scale.setScalar(scale * (0.6 + 0.4 * Math.sin(t * Math.PI)));
            this._pDummy.updateMatrix();
            this._particles.setMatrixAt(i, this._pDummy.matrix);
        }
        this._particles.instanceMatrix.needsUpdate = true;
    }

    dispose() {
        const toRemove = [this._outerRing, this._innerRing, this._model, this._label, this._particles, this._beamAnchor];
        for (const obj of toRemove) {
            if (!obj) continue;
            this._scene.remove(obj);
            obj.traverse?.(c => { c.geometry?.dispose(); c.material?.dispose(); });
        }
        this._ringMat?.dispose();
        this._pMat?.dispose();
    }
}
