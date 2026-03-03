// planetCore.js — The ONE permanent planet sphere + Rapier ball collider.
// Never destroyed between theme switches. Surface colors lerp smoothly as themes change.

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, uniform, mix, sin, normalize, dot, clamp,
    vec3, smoothstep, positionWorld, float
} from 'three/tsl';

export const PLANET_CENTER = new THREE.Vector3(0, -50, 0);
export const PLANET_RADIUS = 50;

// One entry per theme key — target palette values
const PALETTES = {
    hub: { c1: 0x5ecf3e, c2: 0xc07a35, roughness: 1.0, emissive: 0.0 },
    desert: { c1: 0xd2955a, c2: 0xa0673a, roughness: 0.95, emissive: 0.0 },
    ice: { c1: 0xddefff, c2: 0x66ccee, roughness: 0.05, emissive: 0.0 },
    lava: { c1: 0x1a0a00, c2: 0xff4400, roughness: 0.9, emissive: 0.5 },
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

        // ── TSL animated color uniforms ────────────────────────────────────
        // Start with hub palette
        this._uC1 = uniform(new THREE.Color(PALETTES.hub.c1));
        this._uC2 = uniform(new THREE.Color(PALETTES.hub.c2));
        this._uEmissive = uniform(0.0);

        // Lerp targets
        this._tC1 = new THREE.Color(PALETTES.hub.c1);
        this._tC2 = new THREE.Color(PALETTES.hub.c2);
        this._tEmissive = 0.0;

        // ── TSL shader: cartoon toon with procedural 2-color mix ───────────
        // Procedural surface pattern (dune-like sine waves)
        const patternFreq = positionWorld.x.mul(0.15).add(positionWorld.z.mul(0.1));
        const patternMix = sin(patternFreq).mul(0.5).add(0.5);
        const surfaceColor = mix(this._uC1, this._uC2, patternMix);

        // Cel-shading: 3 bands based on NdotL
        const sunDir = normalize(vec3(0.4, 1.0, 0.5));
        const toSurf = normalize(positionWorld.sub(vec3(PC.x, PC.y, PC.z)));
        const NdotL = clamp(dot(toSurf, sunDir), 0.0, 1.0);
        const toon = clamp(
            smoothstep(0.0, 0.05, NdotL).mul(0.45)
                .add(smoothstep(0.3, 0.35, NdotL).mul(0.35))
                .add(smoothstep(0.65, 0.70, NdotL).mul(0.20)),
            0.0, 1.0
        );
        const shadowed = surfaceColor.mul(float(0.28));
        const lit = surfaceColor.mul(float(1.15));
        const finalCol = mix(shadowed, lit, toon);

        this._mat = new MeshStandardNodeMaterial({
            colorNode: finalCol,
            emissiveNode: this._uC2.mul(this._uEmissive),
            roughness: 1.0,
            metalness: 0.0,
        });

        this._mesh = new THREE.Mesh(new THREE.SphereGeometry(PR, 128, 96), this._mat);
        this._mesh.position.copy(PC);
        this._mesh.receiveShadow = true;
        scene.add(this._mesh);

        // ── Permanent Rapier ball collider — never removed ─────────────────
        const body = rapierWorld.createRigidBody(
            RAPIER.RigidBodyDesc.fixed().setTranslation(PC.x, PC.y, PC.z)
        );
        this._body = body;
        // Default friction/restitution — themes can't change the collider material,
        // only the visual material. Keep neutral values.
        rapierWorld.createCollider(
            RAPIER.ColliderDesc.ball(PR).setFriction(0.7).setRestitution(0.05),
            body
        );
    }

    /** Switch planet colors to match a theme key. Lerp happens in update(). */
    setTheme(themeKey) {
        const p = PALETTES[themeKey] ?? PALETTES.hub;
        this._tC1.setHex(p.c1);
        this._tC2.setHex(p.c2);
        this._tEmissive = p.emissive;
    }

    /** Call every frame. */
    update(dt) {
        const speed = Math.min(1, dt * 1.8); // smooth over ~0.5s
        this._uC1.value.lerp(this._tC1, speed);
        this._uC2.value.lerp(this._tC2, speed);
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
