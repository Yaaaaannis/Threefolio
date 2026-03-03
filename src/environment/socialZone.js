// socialZone.js — A social-media themed zone placed in front of the Antenna.
// • TSL MeshStandardNodeMaterial ring that pulses blue when player is near
// • Wi-Fi / broadcast icon shape as center decoration
// • Rising particles (CPU InstancedMesh) that drift upward along the surface normal
// • All powered by Three.js TSL (tsl / webgpu node materials)

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, uniform, sin, cos, time, mix, float, vec3,
    positionWorld, normalWorld, abs, pow, smoothstep
} from 'three/tsl';

const PLANET_CENTER = new THREE.Vector3(0, -50, 0);
const PLANET_RADIUS = 50;

// ── Small helper: build a ring with label geometry ─────────────────────────
function makeRingMesh(inner, outer, segments, mat) {
    const geo = new THREE.RingGeometry(inner, outer, segments);
    return new THREE.Mesh(geo, mat);
}

// ── Social icon: concentric arcs (Wi-Fi / broadcast) ──────────────────────
function makeSocialIconGroup(surfaceNormal, mat) {
    const group = new THREE.Group();
    // Three concentric arc rings of increasing radius — classic signal/WiFi icon
    const radii = [0.35, 0.65, 0.95];
    const ARC = Math.PI * 0.75; // 135° arcs
    radii.forEach(r => {
        const geo = new THREE.RingGeometry(r - 0.06, r, 32, 1, -ARC / 2, ARC);
        group.add(new THREE.Mesh(geo, mat));
    });
    // Center dot
    const dotGeo = new THREE.CircleGeometry(0.12, 16);
    group.add(new THREE.Mesh(dotGeo, mat));
    return group;
}

export class SocialZone {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Vector3} position  - world position on sphere surface
     * @param {function} [onEnter]      - optional callback when player steps in
     */
    constructor(scene, position, onEnter = null) {
        this._scene = scene;
        this._onEnter = onEnter;
        this._center = position.clone();
        this._radius = 2.0;
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

        // ── Social icon (Wi-Fi arcs) centered in ring ─────────────────────

        // Icon mat: slightly brighter, separate uniform not needed (shares ringMat)
        this._iconGroup = makeSocialIconGroup(surfaceNormal, this._ringMat);
        this._iconGroup.quaternion.copy(ringQuat);
        // Rotate arcs to face "up" within the ring plane (arc is symmetric on local Y)
        // Apply a 90° spin around local Z within the group so arcs point upward
        const localUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
        this._iconGroup.quaternion.multiply(localUp);
        this._iconGroup.position.copy(position).addScaledVector(surfaceNormal, 0.08);
        scene.add(this._iconGroup);

        // ── Label (canvas texture) ─────────────────────────────────────────
        this._label = this._makeLabel('SOCIALS', 0x00aaff, position, surfaceNormal, 2.8);

        // ── Particles (InstancedMesh, CPU driven) ─────────────────────────
        this._setupParticles(scene, position, surfaceNormal);
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
        // Orient label to face away from planet (normal = forward)
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        this._scene.add(mesh);
        return mesh;
    }

    // ── Particles ────────────────────────────────────────────────────────────
    _setupParticles(scene, position, surfaceNormal) {
        this._PARTICLE_COUNT = 80;
        const geo = new THREE.BoxGeometry(0.06, 0.06, 0.55);  // elongated streak

        // TSL particle material with emissive glow
        const pColor = color(0x44bbff);
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

        // Per-particle state: position (3) + speed (1) + phase (1)
        this._pPos = new Float32Array(this._PARTICLE_COUNT * 3);
        this._pLifetime = new Float32Array(this._PARTICLE_COUNT);  // 0-1 progress
        this._pSpeed = new Float32Array(this._PARTICLE_COUNT);
        this._pOffset = new Float32Array(this._PARTICLE_COUNT);    // random angle in ring
        this._pDummy = new THREE.Object3D();

        // Tangent vectors for spawning in a disk
        const arbUp = Math.abs(surfaceNormal.y) < 0.9
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(1, 0, 0);
        this._tangentA = new THREE.Vector3().crossVectors(surfaceNormal, arbUp).normalize();
        this._tangentB = new THREE.Vector3().crossVectors(surfaceNormal, this._tangentA).normalize();
        this._spawnPos = position.clone();

        // Initialize all particles with random lifetimes so they don't all start together
        for (let i = 0; i < this._PARTICLE_COUNT; i++) {
            this._pLifetime[i] = Math.random();
            this._pSpeed[i] = 0.3 + Math.random() * 0.5;
            this._pOffset[i] = Math.random() * Math.PI * 2;
            this._spawnParticle(i);
        }

        scene.add(this._particles);
    }

    _spawnParticle(i) {
        // Spawn exactly on the ring circumference
        const angle = this._pOffset[i];
        const r = this._radius;  // fixed radius = ring edge only
        const px = this._spawnPos.x + this._tangentA.x * Math.cos(angle) * r + this._tangentB.x * Math.sin(angle) * r;
        const py = this._spawnPos.y + this._tangentA.y * Math.cos(angle) * r + this._tangentB.y * Math.sin(angle) * r;
        const pz = this._spawnPos.z + this._tangentA.z * Math.cos(angle) * r + this._tangentB.z * Math.sin(angle) * r;
        this._pPos[i * 3] = px;
        this._pPos[i * 3 + 1] = py;
        this._pPos[i * 3 + 2] = pz;
        this._pLifetime[i] = 0;
        this._pOffset[i] = Math.random() * Math.PI * 2;
    }

    /** @param {number} dt @param {THREE.Vector3} playerPos @param {number} absTime */
    update(dt, playerPos, absTime) {
        this._time += dt;

        // ── Player proximity ──────────────────────────────────────────────
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

        // Animate active uniform for TSL pulse
        const targetActive = inside ? 1.0 : 0.0;
        this._activeUniform.value += (targetActive - this._activeUniform.value) * Math.min(1, dt * 6);

        // ── Icon slow spin (rotate around surface normal) ─────────────────
        const spinQuat = new THREE.Quaternion()
            .setFromAxisAngle(this._surfaceNormal, dt * 0.4);
        this._iconGroup.quaternion.premultiply(spinQuat);

        // ── Particles ─────────────────────────────────────────────────────
        const TRAVEL_HEIGHT = 4.0;
        // Precompute streak orientation quaternion (Z axis → surface normal)
        const streakQuat = new THREE.Quaternion()
            .setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._surfaceNormal);

        for (let i = 0; i < this._PARTICLE_COUNT; i++) {
            if (!this._isPlayerInside) {
                // Hide all particles when player is outside
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
            // Orient trait (long Z axis) along the rising direction
            this._pDummy.quaternion.copy(streakQuat);
            this._pDummy.scale.setScalar(scale * (0.6 + 0.4 * Math.sin(t * Math.PI)));
            this._pDummy.updateMatrix();
            this._particles.setMatrixAt(i, this._pDummy.matrix);
        }
        this._particles.instanceMatrix.needsUpdate = true;
    }

    dispose() {
        const toRemove = [this._outerRing, this._innerRing, this._iconGroup, this._label, this._particles];
        for (const obj of toRemove) {
            if (!obj) continue;
            this._scene.remove(obj);
            obj.traverse?.(c => { c.geometry?.dispose(); c.material?.dispose(); });
        }
        this._ringMat?.dispose();
        this._pMat?.dispose();
    }
}
