// LavaWorld.js — Dark red/black planet with glowing lava cracks and rock platforms.

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, mix, positionWorld, sin, uniform } from 'three/tsl';
import { BaseWorld } from './BaseWorld.js';
import { PortalZone } from '../portalZone.js';

export class LavaWorld extends BaseWorld {
    constructor(onPortal) {
        super();
        this._onPortal = onPortal;
        this._portal = null;
        this._timeNode = null;
    }

    get planetCenter() { return new THREE.Vector3(0, -50, 0); }
    get planetRadius() { return 50; }
    get spawnPoint() { return new THREE.Vector3(0, 1.5, 0); }

    load(scene, RAPIER, rapierWorld) {
        super.load(scene, RAPIER, rapierWorld);
        const PC = this.planetCenter;
        const PR = this.planetRadius;

        // ── Animated lava planet ──────────────────────────────────────────
        this._timeNode = uniform(0);
        const darkRock = color(0x1a0a00);
        const glowLava = color(0xff4400);
        // Animated crack pattern using sine of world position + time
        const crackFreq = positionWorld.x.mul(0.3).add(positionWorld.z.mul(0.25)).add(this._timeNode);
        const crackVal = sin(crackFreq).abs().oneMinus().max(0.88); // thin bright cracks
        const lavaColor = mix(darkRock, glowLava, crackVal);

        const mat = new MeshStandardNodeMaterial({
            colorNode: lavaColor, emissiveNode: lavaColor.mul(0.4),
            roughness: 0.9, metalness: 0
        });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(PR, 128, 96), mat);
        mesh.position.copy(PC);
        mesh.receiveShadow = true;
        this._track(mesh);

        const body = this._trackBody(rapierWorld.createRigidBody(
            RAPIER.RigidBodyDesc.fixed().setTranslation(PC.x, PC.y, PC.z)
        ));
        rapierWorld.createCollider(
            RAPIER.ColliderDesc.ball(PR).setFriction(0.8).setRestitution(0.05), body
        );

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
            const pm = new THREE.Mesh(geo, rockMat);
            pm.position.copy(pos);
            pm.quaternion.copy(quat);
            pm.castShadow = pm.receiveShadow = true;
            this._track(pm);

            const pb = this._addFixedBody(pos.x, pos.y, pos.z);
            // Build rotation matrix for the collider
            const e = new THREE.Euler().setFromQuaternion(quat);
            rapierWorld.createCollider(
                RAPIER.ColliderDesc.cuboid(size / 2, thick / 2, size / 2), pb
            );
        }

        // ── Point light to simulate lava glow ────────────────────────────
        const glow = new THREE.PointLight(0xff3300, 3, 30);
        glow.position.set(PC.x, PC.y + PR + 1, PC.z);
        this._track(glow);

        // ── Return portal ─────────────────────────────────────────────────
        const portalDir = new THREE.Vector3(0, 50, 4).normalize();
        const surfPt = PC.clone().addScaledVector(portalDir, PR + 0.05);
        this._portal = new PortalZone(scene, PC, surfPt, '✦ Travel', 0xaaddff, () => this._onPortal('lava'));
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
