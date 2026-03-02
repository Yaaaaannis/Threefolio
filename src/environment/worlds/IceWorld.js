// IceWorld.js — Cyan/white crystal planet, slippery, icy spikes, return portal.

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, mix, positionWorld, sin, cos } from 'three/tsl';
import { BaseWorld } from './BaseWorld.js';
import { PortalZone } from '../portalZone.js';

export class IceWorld extends BaseWorld {
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

        // ── Icy planet ────────────────────────────────────────────────────
        const iceWhite = color(0xddefff);
        const iceCyan = color(0x66ccee);
        const iceMix = sin(positionWorld.x.mul(0.2)).mul(cos(positionWorld.z.mul(0.2))).mul(0.5).add(0.5);
        const iceColor = mix(iceWhite, iceCyan, iceMix);

        const mat = new MeshStandardNodeMaterial({ colorNode: iceColor, roughness: 0.05, metalness: 0.3 });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(PR, 128, 96), mat);
        mesh.position.copy(PC);
        mesh.receiveShadow = true;
        this._track(mesh);

        const body = this._trackBody(rapierWorld.createRigidBody(
            RAPIER.RigidBodyDesc.fixed().setTranslation(PC.x, PC.y, PC.z)
        ));
        rapierWorld.createCollider(
            RAPIER.ColliderDesc.ball(PR).setFriction(0.02).setRestitution(0.1), body  // very slippery!
        );

        // ── Ice crystal spikes ────────────────────────────────────────────
        const crystalMat = new THREE.MeshStandardMaterial({
            color: 0xaaddff, transparent: true, opacity: 0.8,
            roughness: 0.05, metalness: 0.5
        });
        const spikeData = [
            [3, 5], [-4, 3], [6, -2], [-2, -6], [5, 4], [-5, -3], [1, -5], [-3, 2],
        ];
        for (const [sx, sz] of spikeData) {
            const h = 2.5 + Math.random() * 3;
            const r = 0.2 + Math.random() * 0.3;
            const geo = new THREE.ConeGeometry(r, h, 5);
            const dir = new THREE.Vector3(sx, 50, sz).normalize();
            const pos = PC.clone().addScaledVector(dir, PR + h / 2);
            const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

            const spike = new THREE.Mesh(geo, crystalMat);
            spike.position.copy(pos);
            spike.quaternion.copy(quat);
            spike.castShadow = true;
            this._track(spike);

            const sb = this._addFixedBody(pos.x, pos.y, pos.z);
            rapierWorld.createCollider(RAPIER.ColliderDesc.cone(h / 2, r), sb);
        }

        // ── Return portal ─────────────────────────────────────────────────
        const portalDir = new THREE.Vector3(0, 50, 4).normalize();
        const surfPt = PC.clone().addScaledVector(portalDir, PR + 0.05);
        this._portal = new PortalZone(scene, PC, surfPt, '✦ Travel', 0xaaddff, () => this._onPortal('ice'));
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
