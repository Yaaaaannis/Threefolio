// DesertTheme.js — Sandy orange surface decorations (rock pillars + portal).

import * as THREE from 'three';
import { BaseTheme } from './BaseTheme.js';
import { PortalZone } from '../portalZone.js';

const PC = new THREE.Vector3(0, -50, 0);
const PR = 50;

export class DesertTheme extends BaseTheme {
    static get themeKey() { return 'desert'; }

    constructor(onPortal) {
        super();
        this._onPortal = onPortal;
        this._portal = null;
    }

    get spawnPoint() { return new THREE.Vector3(0, 1.5, 0); }

    load(scene, RAPIER, rapierWorld) {
        super.load(scene, RAPIER, rapierWorld);

        // ── Rock pillars / ruins ──────────────────────────────────────────
        const rockMat = new THREE.MeshStandardMaterial({ color: 0x8b6c42, roughness: 0.9 });
        const pillarPositions = [
            [4, 3], [-3, 5], [7, -2], [-6, -4], [2, -7],
        ];
        for (const [x, z] of pillarPositions) {
            const pillarH = 3 + Math.random() * 3;
            const pillarW = 0.8 + Math.random() * 0.8;
            const geo = new THREE.CylinderGeometry(pillarW * 0.5, pillarW, pillarH, 6);

            const dir = new THREE.Vector3(x, 50, z).normalize();
            const pos = PC.clone().addScaledVector(dir, PR + pillarH / 2);
            const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

            const mesh = new THREE.Mesh(geo, rockMat);
            mesh.position.copy(pos);
            mesh.quaternion.copy(quat);
            mesh.castShadow = true;
            this._track(mesh);

            const pb = this._addFixedBody(pos.x, pos.y, pos.z);
            rapierWorld.createCollider(RAPIER.ColliderDesc.cylinder(pillarH / 2, pillarW * 0.5), pb);
        }

        // ── Return portal ─────────────────────────────────────────────────
        const portalDir = new THREE.Vector3(0, 50, 4).normalize();
        const surfPt = PC.clone().addScaledVector(portalDir, PR + 0.05);
        this._portal = new PortalZone(scene, PC, surfPt, '✦ Travel', 0xffaa44, () => this._onPortal('desert'));
    }

    update(dt, playerPos, time) {
        if (playerPos) this._portal?.update(playerPos, time);
    }

    dispose() {
        this._portal?.dispose();
        this._portal = null;
        super.dispose();
    }
}
