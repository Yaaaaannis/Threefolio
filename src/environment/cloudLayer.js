// cloudLayer.js — Cartoon cloud layer using built-in TSL noise nodes.
// Uses mx_noise_float (3D Perlin FBM) for organic cloud shapes.
// Clouds sit on a displaced sphere above the planet surface.

import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    mx_noise_float,
    uniform, positionLocal, normalLocal,
    vec3, float, mix, smoothstep, clamp
} from 'three/tsl';
import { PLANET_CENTER, PLANET_RADIUS } from './planetCore.js';

export class CloudLayer {
    constructor(scene) {
        this._scene = scene;

        // ── Debug-exposed uniforms ─────────────────────────────────────────
        this._uNoiseScale = uniform(2.4);   // Cloud size (smaller = bigger blobs)
        this._uHeight     = uniform(20.0);  // Height above surface (units)
        this._uThreshold  = uniform(0.52);  // Density: lower = more clouds
        this._uSpeed      = uniform(0.035); // Drift animation speed
        this._uOpacity    = uniform(0.93);  // Max cloud opacity
        this._uVolume     = uniform(1.8);   // Radial bumps amplitude (cartoon puffiness)
        this._uTime       = uniform(0.0);

        this._buildMesh();
    }

    _buildMesh() {
        // ── Unit sphere direction from geometry position ───────────────────
        const dir   = positionLocal.normalize();
        const scale = this._uNoiseScale;
        const drift = this._uTime.mul(this._uSpeed);

        // 3 octave positions — each with its own drift direction + offset
        const p0 = dir.mul(scale)
            .add(vec3(drift, drift.mul(0.4), drift.mul(0.7)));

        const p1 = dir.mul(scale.mul(2.1))
            .add(vec3(drift.mul(1.3), drift.mul(0.8), drift.mul(1.1)))
            .add(vec3(5.2, 1.3, 2.7));

        const p2 = dir.mul(scale.mul(4.3))
            .add(vec3(drift.mul(0.6), drift.mul(1.3), drift.mul(0.5)))
            .add(vec3(1.7, 9.2, 4.1));

        // mx_noise_float(vec3) → Perlin in approx [-1, 1]
        // FBM weights sum to 1 → fbm ∈ [-1, 1]
        const fbm = mx_noise_float(p0).mul(0.50)
            .add(mx_noise_float(p1).mul(0.30))
            .add(mx_noise_float(p2).mul(0.20));

        // Remap to [0, 1]
        const noise = fbm.mul(0.5).add(0.5).clamp(0.0, 1.0);

        // ── Cartoon edge: narrow smoothstep for defined cloud borders ──────
        const thresh    = this._uThreshold;
        const cloudMask = smoothstep(thresh, thresh.add(0.055), noise);

        // ── Color: bright white center → blue-grey shadow at edges ────────
        const depth      = smoothstep(thresh, thresh.add(0.30), noise);
        const shadow     = vec3(0.68, 0.76, 0.90);
        const mid        = vec3(0.88, 0.92, 0.97);
        const highlight  = vec3(0.97, 0.98, 1.00);
        const cloudColor = mix(shadow, mix(mid, highlight, depth), depth);

        // ── Volume: high-freq noise displaces vertices radially ───────────
        // Separate noise layer, no time drift → stable bumpy shape
        const volumeP   = dir.mul(scale.mul(6.0)).add(vec3(13.7, 2.1, 7.4));
        const volumeN   = mx_noise_float(volumeP).mul(0.5).add(0.5); // [0, 1]
        // Only bump upward (always positive offset) for puffy cloud silhouette
        const volumeDisp = volumeN.mul(this._uVolume);

        // ── Material ───────────────────────────────────────────────────────
        const mat = new MeshBasicNodeMaterial({
            transparent: true,
            depthWrite:  false,
            side:        THREE.DoubleSide,
        });
        mat.colorNode    = cloudColor;
        mat.opacityNode  = cloudMask.mul(this._uOpacity);
        // Base height + random per-vertex bump along the normal
        mat.positionNode = normalLocal.mul(
            float(PLANET_RADIUS).add(this._uHeight).add(volumeDisp)
        );

        // ── Mesh ───────────────────────────────────────────────────────────
        // Geometry at PLANET_RADIUS → correct CPU bounding sphere for the renderer
        const geo = new THREE.SphereGeometry(PLANET_RADIUS, 128, 96);

        this._mesh = new THREE.Mesh(geo, mat);
        this._mesh.position.copy(PLANET_CENTER);
        this._mesh.renderOrder   = 2;
        this._mesh.frustumCulled = false;
        this._scene.add(this._mesh);
    }

    /** Drive the animation — pass game clock elapsed time. */
    update(elapsedTime) {
        this._uTime.value = elapsedTime;
    }

    dispose() {
        this._scene.remove(this._mesh);
        this._mesh.geometry.dispose();
        this._mesh.material.dispose();
    }
}
