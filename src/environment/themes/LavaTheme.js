// LavaTheme.js — Dark rock/lava surface decorations (platforms + animated crack light + portal).

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, mix, positionWorld, sin, uniform } from 'three/tsl';
import { BaseTheme } from './BaseTheme.js';
import { PortalZone } from '../portalZone.js';

const PC = new THREE.Vector3(0, -50, 0);
const PR = 50;

export class LavaTheme extends BaseTheme {
    static get themeKey() { return 'lava'; }

    constructor(onPortal) {
        super();
        this._onPortal = onPortal;
        this._portal = null;
        this._timeNode = null;
    }

    get spawnPoint() { return new THREE.Vector3(0, 1.5, 0); }

    load(scene, RAPIER, rapierWorld) {
        super.load(scene, RAPIER, rapierWorld);

        // ── Animated lava crack platform decorations ───────────────────────
        // (Animated lava material on small surface slabs — not the planet itself)
        this._timeNode = uniform(0);
        const darkRock = color(0x1a0a00);
        const glowLava = color(0xff4400);
        const crackFreq = positionWorld.x.mul(0.3).add(positionWorld.z.mul(0.25)).add(this._timeNode);
        const crackVal = sin(crackFreq).abs().oneMinus().max(0.88);
        const lavaColor = mix(darkRock, glowLava, crackVal);
        const lavaMat = new MeshStandardNodeMaterial({
            colorNode: lavaColor, emissiveNode: lavaColor.mul(0.4),
            roughness: 0.9, metalness: 0,
        });

        // ── Rock platforms ────────────────────────────────────────────────
        const rockMat = new THREE.MeshStandardMaterial({ color: 0x2a0a00, roughness: 0.95, metalness: 0.1 });
        const platforms = [
            [4, 3, 0.5, 3], [-3, 5, 0.5, 2.5], [6, -2, 0.4, 2], [-5, -4, 0.5, 2.8], [0, 4, 0.3, 2],
        ];
        for (const [sx, sz, thick, size] of platforms) {
            const dir = new THREE.Vector3(sx, 50, sz).normalize();
            const pos = PC.clone().addScaledVector(dir, PR + thick / 2);
            const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

            const geo = new THREE.BoxGeometry(size, thick, size);
            const pm = new THREE.Mesh(geo, lavaMat);
            pm.position.copy(pos);
            pm.quaternion.copy(quat);
            pm.castShadow = pm.receiveShadow = true;
            this._track(pm);

            const pb = this._addFixedBody(pos.x, pos.y, pos.z);
            rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(size / 2, thick / 2, size / 2), pb);
        }

        // ── Point light (lava glow) ───────────────────────────────────────
        const glow = new THREE.PointLight(0xff3300, 3, 30);
        glow.position.set(PC.x, PC.y + PR + 1, PC.z);
        this._track(glow);

        // ── Return portal ─────────────────────────────────────────────────
        const portalDir = new THREE.Vector3(0, 50, 4).normalize();
        const surfPt = PC.clone().addScaledVector(portalDir, PR + 0.05);
        this._portal = new PortalZone(scene, PC, surfPt, '✦ Travel', 0xff4400, () => this._onPortal('lava'));
    }

    update(dt, playerPos, time) {
        if (this._timeNode) this._timeNode.value = time * 0.5;
        if (playerPos) this._portal?.update(playerPos, time);
    }

    dispose() {
        this._portal?.dispose();
        this._portal = null;
        super.dispose();
    }
}
