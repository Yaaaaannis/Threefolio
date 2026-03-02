// DesertWorld.js — Sandy orange planet with dune ridges and a return portal to Hub.

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, mix, float, positionWorld, sin, add } from 'three/tsl';
import { BaseWorld } from './BaseWorld.js';
import { PortalZone } from '../portalZone.js';

export class DesertWorld extends BaseWorld {
    constructor(onPortal) {
        super();
        this._onPortal = onPortal;
        this._portal = null;
    }

    get planetCenter() { return new THREE.Vector3(0, -50, 0); }
    get planetRadius() { return 50; }
    get spawnPoint() { return new THREE.Vector3(0, 1.5, 0); }

    load(scene, RAPIER, rapierWorld) {
        super.load(scene, RAPIER, rapierWorld);
        const PC = this.planetCenter;
        const PR = this.planetRadius;

        // ── Sandy planet ──────────────────────────────────────────────────
        // Procedural dune-like color variation from TSL position noise
        const sandBase = color(0xd2955a);
        const sandDark = color(0xa0673a);
        // Mix based on a sine wave of world XZ position (dune stripes)
        const duneFreq = positionWorld.x.mul(0.15).add(positionWorld.z.mul(0.1));
        const duneMix = sin(duneFreq).mul(0.5).add(0.5); // remap to [0,1]
        const sandColor = mix(sandBase, sandDark, duneMix);

        const mat = new MeshStandardNodeMaterial({ colorNode: sandColor, roughness: 0.95, metalness: 0 });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(PR, 128, 96), mat);
        mesh.position.copy(PC);
        mesh.receiveShadow = true;
        this._track(mesh);

        // Rapier planet
        const body = this._trackBody(rapierWorld.createRigidBody(
            RAPIER.RigidBodyDesc.fixed().setTranslation(PC.x, PC.y, PC.z)
        ));
        rapierWorld.createCollider(RAPIER.ColliderDesc.ball(PR), body);

        // ── Rock pillars / ruins ──────────────────────────────────────────
        const rockMat = new THREE.MeshStandardMaterial({ color: 0x8b6c42, roughness: 0.9 });
        const pillarPositions = [
            [4, 0, 3], [-3, 0, 5], [7, 0, -2], [-6, 0, -4], [2, 0, -7],
        ];
        for (const [x, z, h] of pillarPositions.map((p, i) => [...p, 2 + i % 3])) {
            const pillarH = 3 + Math.random() * 3;
            const pillarW = 0.8 + Math.random() * 0.8;
            const geo = new THREE.CylinderGeometry(pillarW * 0.5, pillarW, pillarH, 6);

            // Place on sphere surface
            const dir = new THREE.Vector3(x, 50, z).normalize();
            const pos = PC.clone().addScaledVector(dir, PR + pillarH / 2);
            const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

            const pillarMesh = new THREE.Mesh(geo, rockMat);
            pillarMesh.position.copy(pos);
            pillarMesh.quaternion.copy(quat);
            pillarMesh.castShadow = true;
            this._track(pillarMesh);

            // Fixed physics for each pillar
            const pb = this._addFixedBody(pos.x, pos.y, pos.z);
            rapierWorld.createCollider(
                RAPIER.ColliderDesc.cylinder(pillarH / 2, pillarW * 0.5), pb
            );
        }

        // ── Return portal ─────────────────────────────────────────────────
        const portalDir = new THREE.Vector3(0, 50, 4).normalize();
        const surfPt = PC.clone().addScaledVector(portalDir, PR + 0.05);
        this._portal = new PortalZone(scene, PC, surfPt, '✦ Travel', 0xaaddff, () => this._onPortal('desert'));
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
