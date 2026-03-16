// planetCore.js — The ONE permanent planet sphere + Rapier ball collider.
// Never destroyed between theme switches. Surface colors lerp smoothly as themes change.
//
// Terrain: FBM noise vertex displacement (radial) fades to ZERO near the planet pole
// so the gameplay area (top cap) stays smooth and works with grass/physics.
// Color: 3-zone system — grass / dirt / rock — driven by the same noise.

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    mx_noise_float,
    color, uniform, mix, sin, normalize, dot, clamp,
    vec3, smoothstep, positionWorld, positionLocal, float
} from 'three/tsl';

export const PLANET_CENTER = new THREE.Vector3(0, -50, 0);
export const PLANET_RADIUS = 50;

// Three colors per theme: grass · dirt · rock
const PALETTES = {
    hub:    { c1: 0x5ecf3e, c2: 0xc07a35, c3: 0x9a8870, emissive: 0.0 },
    desert: { c1: 0xd2955a, c2: 0xa0673a, c3: 0xb89a6a, emissive: 0.0 },
    ice:    { c1: 0xddefff, c2: 0x66ccee, c3: 0xbbc8d8, emissive: 0.0 },
    lava:   { c1: 0x1a0a00, c2: 0xff4400, c3: 0x2a1200, emissive: 0.5 },
};

export class PlanetCore {
    /**
     * @param {THREE.Scene} scene
     * @param {*} RAPIER
     * @param {*} rapierWorld
     */
    constructor(scene, RAPIER, rapierWorld) {
        this._scene = scene;
        this._rapierWorld = rapierWorld;

        const PC = PLANET_CENTER;
        const PR = PLANET_RADIUS;

        // ── Color uniforms (lerped on theme switch) ────────────────────────
        this._uC1 = uniform(new THREE.Color(PALETTES.hub.c1)); // grass
        this._uC2 = uniform(new THREE.Color(PALETTES.hub.c2)); // dirt
        this._uC3 = uniform(new THREE.Color(PALETTES.hub.c3)); // rock
        this._uEmissive = uniform(0.0);

        this._tC1 = new THREE.Color(PALETTES.hub.c1);
        this._tC2 = new THREE.Color(PALETTES.hub.c2);
        this._tC3 = new THREE.Color(PALETTES.hub.c3);
        this._tEmissive = 0.0;

        // ── Terrain noise (FBM, 4 octaves via mx_noise_float) ─────────────
        // Using positionLocal so colour and displacement share identical inputs.
        const f  = float(0.048);
        const t1 = mx_noise_float(positionLocal.mul(f));
        const t2 = mx_noise_float(positionLocal.mul(f.mul(2.1))).mul(0.50);
        const t3 = mx_noise_float(positionLocal.mul(f.mul(4.4))).mul(0.25);
        const t4 = mx_noise_float(positionLocal.mul(f.mul(9.0))).mul(0.13);
        // Sum ≈ [-1.88 , 1.88]  → remap to [0, 1]
        const terrainNoise = clamp(t1.add(t2).add(t3).add(t4).mul(0.265).add(0.5), 0.0, 1.0);

        // Detail noise (2 octaves) — only used for colour edge dithering
        const d1 = mx_noise_float(positionLocal.mul(float(0.13)));
        const d2 = mx_noise_float(positionLocal.mul(float(0.28))).mul(0.5);
        const detailNoise = clamp(d1.add(d2).mul(0.38).add(0.5), 0.0, 1.0);

        // ── Polar fade — keep the entire gameplay cap perfectly flat ──────
        //   lat = dot(surfaceNormal, up):  1 at north pole, 0 at equator
        //
        //   Safe playable radius ≈ 30 units from centre → lat ≈ 0.80
        //   Displacement must be ZERO inside that radius.
        //   latFade = 0 when lat > 0.72  (≤ 35 units, well outside gameplay)
        //           = 1 when lat < 0.48  (≥ 44 units, sides/equator only)
        const surfNorm = positionLocal.normalize();
        const lat      = dot(surfNorm, vec3(0.0, 1.0, 0.0));
        const latFade  = smoothstep(float(0.72), float(0.48), lat);

        // ── Vertex displacement (visual only, physics stays smooth) ───────
        const displacement = terrainNoise.mul(float(2.2)).mul(latFade);
        // positionNode must return LOCAL space — displacing along the surface normal
        const displacedPos = positionLocal.add(surfNorm.mul(displacement));

        // ── Colour: 3-zone terrain ─────────────────────────────────────────
        // Blend height: terrainNoise + slight detail dither for organic edges
        const blendH = clamp(terrainNoise.add(detailNoise.mul(0.14)).sub(0.07), 0.0, 1.0);

        const grassToDirt = smoothstep(float(0.38), float(0.60), blendH);
        const dirtToRock  = smoothstep(float(0.65), float(0.84), blendH);

        // Rock also bleeds into equatorial / lat-displaced region
        const equatorRock = smoothstep(float(0.72), float(0.45), lat)
            .mul(smoothstep(float(0.0), float(0.25), terrainNoise));

        const baseColor  = mix(this._uC1, this._uC2, grassToDirt);
        let   biomeColor = mix(baseColor, this._uC3, dirtToRock.max(equatorRock));

        // Dark crevices — low terrain in the bumpy zone gets darker (shadowed valleys)
        const crevice     = smoothstep(float(0.32), float(0.18), terrainNoise).mul(latFade);
        const darkEarth   = this._uC1.mul(float(0.25));
        biomeColor        = mix(biomeColor, darkEarth, crevice);

        // Subtle sine-wave path/trail pattern (keeps the warm-dirt strip feel)
        const pathFreq  = positionWorld.x.mul(0.14).add(positionWorld.z.mul(0.09));
        const pathMix   = sin(pathFreq).mul(0.5).add(0.5).mul(float(0.22));
        const surfaceColor = mix(biomeColor, this._uC2, pathMix);

        // ── Cel-shading: 3 toon bands ──────────────────────────────────────
        // toSurf uses positionWorld (post-displacement) → correct NdotL on bumps
        const sunDir = normalize(vec3(0.4, 1.0, 0.5));
        const toSurf = normalize(positionWorld.sub(vec3(PC.x, PC.y, PC.z)));
        const NdotL  = clamp(dot(toSurf, sunDir), 0.0, 1.0);
        const toon   = clamp(
            smoothstep(0.0,  0.05, NdotL).mul(0.45)
                .add(smoothstep(0.3, 0.35, NdotL).mul(0.35))
                .add(smoothstep(0.65, 0.70, NdotL).mul(0.20)),
            0.0, 1.0
        );
        const shadowed = surfaceColor.mul(float(0.28));
        const lit      = surfaceColor.mul(float(1.15));
        const finalCol = mix(shadowed, lit, toon);

        // ── Material ───────────────────────────────────────────────────────
        this._mat = new MeshStandardNodeMaterial({ roughness: 1.0, metalness: 0.0 });
        this._mat.positionNode  = displacedPos;
        this._mat.colorNode     = finalCol;
        this._mat.emissiveNode  = this._uC2.mul(this._uEmissive);

        this._mesh = new THREE.Mesh(new THREE.SphereGeometry(PR, 128, 96), this._mat);
        this._mesh.position.copy(PC);
        this._mesh.receiveShadow = true;
        scene.add(this._mesh);

        // ── Permanent Rapier ball collider — smooth sphere, never displaced ─
        const body = rapierWorld.createRigidBody(
            RAPIER.RigidBodyDesc.fixed().setTranslation(PC.x, PC.y, PC.z)
        );
        this._body = body;
        rapierWorld.createCollider(
            RAPIER.ColliderDesc.ball(PR).setFriction(0.7).setRestitution(0.05),
            body
        );
    }

    /** Switch planet colours to match a theme key. Lerp happens in update(). */
    setTheme(themeKey) {
        const p = PALETTES[themeKey] ?? PALETTES.hub;
        this._tC1.setHex(p.c1);
        this._tC2.setHex(p.c2);
        this._tC3.setHex(p.c3);
        this._tEmissive = p.emissive;
    }

    /** Call every frame. */
    update(dt) {
        const speed = Math.min(1, dt * 1.8);
        this._uC1.value.lerp(this._tC1, speed);
        this._uC2.value.lerp(this._tC2, speed);
        this._uC3.value.lerp(this._tC3, speed);
        this._uEmissive.value += (this._tEmissive - this._uEmissive.value) * speed;
    }

    /** Full cleanup (call only at total game shutdown). */
    dispose() {
        this._scene.remove(this._mesh);
        this._mesh.geometry.dispose();
        this._mat.dispose();
        try { this._rapierWorld.removeRigidBody(this._body); } catch (_) { }
    }
}
