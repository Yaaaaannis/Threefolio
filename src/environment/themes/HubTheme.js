// HubTheme.js — Hub/Spawn surface decorations.
// All the entities from HubWorld minus the planet sphere/collider (PlanetCore owns those).

import * as THREE from 'three';
import { BaseTheme } from './BaseTheme.js';
import { Grass } from '../grass.js';
import { Chess } from '../../entities/chess.js';
import { CubeWall } from '../cubeWall.js';
import { Football } from '../../entities/football.js';
import { PortalZone } from '../portalZone.js';
import { ChessZone } from '../chessZone.js';
import { SpawnerZone } from '../spawnerZone.js';
import { FollowerSphere } from '../../entities/followerSphere.js';
import { Antenna } from '../../entities/antenna.js';
import { SocialZone } from '../socialZone.js';

const PC = new THREE.Vector3(0, -50, 0);
const PR = 50;

export class HubTheme extends BaseTheme {
    static get themeKey() { return 'hub'; }

    constructor(onPortal) {
        super();
        this._onPortal = onPortal;
        this._portals = [];
        this._grass = null;
        this._chess = null;
        this._cubeWall = null;
        this._football = null;
        this._chessZone = null;
        this._spawnerZone = null;
        this._follower = null;
        this._antenna = null;
        this._socialZone = null;
    }

    get spawnPoint() { return new THREE.Vector3(0, 1.5, 0); }

    load(scene, RAPIER, rapierWorld) {
        super.load(scene, RAPIER, rapierWorld);

        // ── Wall-jump corridor ────────────────────────────────────────────
        this._addCorridor(scene, RAPIER, rapierWorld);

        // ── Grass ─────────────────────────────────────────────────────────
        this._grass = new Grass(scene);

        // ── Chess ─────────────────────────────────────────────────────────
        this._chess = new Chess(scene, RAPIER, rapierWorld, new THREE.Vector3(5, 0, -5));

        // ── CubeWall ──────────────────────────────────────────────────────
        this._cubeWall = new CubeWall(scene, RAPIER, rapierWorld, new THREE.Vector3(-6, 0, 8), 4, 4, 1.0);

        // ── Football ──────────────────────────────────────────────────────
        this._football = new Football(scene, RAPIER, rapierWorld);

        // ── Hub-specific zones ────────────────────────────────────────────
        this._chessZone = new ChessZone(scene, new THREE.Vector3(-22, 0.05, 0));
        this._spawnerZone = new SpawnerZone(scene, RAPIER, rapierWorld);
        this._follower = new FollowerSphere(scene, new THREE.Vector3(-8, 5, -8));

        // ── Antenna ─ placed next to the football goal (surface-aligned) ──
        const antennaPos = new THREE.Vector3(-14, -2.9, -10);
        const antennaSurfaceNormal = new THREE.Vector3().subVectors(antennaPos, PC).normalize();
        const uprightQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), antennaSurfaceNormal);
        const spinQuat = new THREE.Quaternion().setFromAxisAngle(antennaSurfaceNormal, Math.PI / 6); // 30°
        const antennaQuat = spinQuat.multiply(uprightQuat);
        this._antenna = new Antenna(scene, antennaPos, 2.5, Math.PI * 0.8, antennaQuat, RAPIER, rapierWorld);

        // ── Social Media Zone ─ in front of the antenna ───────────────────
        const antennaWorldPos = new THREE.Vector3(-12, -1.7, -2);
        const socialNormal = new THREE.Vector3().subVectors(antennaWorldPos, PC).normalize();
        const tangent = new THREE.Vector3(0, 0, -1);
        tangent.sub(socialNormal.clone().multiplyScalar(tangent.dot(socialNormal))).normalize();
        const socialPos = antennaWorldPos.clone().addScaledVector(tangent, 3.5).addScaledVector(socialNormal, 0.05);
        this._socialZone = new SocialZone(scene, socialPos);

        // ── Portal (opens Galaxy/Theme Menu) ─────────────────────────────
        const portalDir = new THREE.Vector3(0, 50, 4).normalize();
        const portalPt = PC.clone().addScaledVector(portalDir, PR + 0.05);
        const portal = new PortalZone(
            scene, PC, portalPt, '✦ Travel', 0xaaddff,
            () => this._onPortal('hub')
        );
        this._portals.push(portal);
    }

    update(dt, playerPos, time) {
        const TIMESTEP = 1 / 60;
        this._chess?.update(TIMESTEP);
        this._cubeWall?.update(TIMESTEP);
        this._football?.update(TIMESTEP);
        if (playerPos) {
            const cubePositions = this._cubeWall?.cubes?.map(c => {
                const t = c.rigidBody.translation();
                return { x: t.x, z: t.z };
            }) ?? [];
            this._grass?.update(time, playerPos, true, cubePositions);
            this._chessZone?.update(playerPos);
            this._spawnerZone?.update(playerPos);
            this._follower?.update(time, playerPos, dt ?? 0.016);
            this._antenna?.update(dt ?? 0.016);
            this._socialZone?.update(dt ?? 0.016, playerPos, time);
            for (const p of this._portals) p.update(playerPos, time);
        }
    }

    dispose() {
        this._portals.forEach(p => p.dispose());
        this._portals = [];
        // Grass
        if (this._grass?.mesh) {
            this.scene.remove(this._grass.mesh);
            this._grass.mesh.geometry?.dispose();
            this._grass.mesh.material?.dispose();
        }
        // SpawnerZone ring
        if (this._spawnerZone?.ringMesh) {
            this.scene.remove(this._spawnerZone.ringMesh);
            this._spawnerZone.ringMesh.geometry?.dispose();
            this._spawnerZone.ringMesh.material?.dispose();
        }
        // ChessZone ring
        if (this._chessZone?.ringMesh) {
            this.scene.remove(this._chessZone.ringMesh);
            this._chessZone.ringMesh.geometry?.dispose();
            this._chessZone.ringMesh.material?.dispose();
        }
        this._chess?.dispose();
        this._football?.dispose();
        this._cubeWall?.dispose();
        if (this._follower?.mesh) {
            this.scene.remove(this._follower.mesh);
            this._follower.mesh.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
        }
        this._antenna?.dispose();
        this._socialZone?.dispose();
        super.dispose();
    }

    _addCorridor(scene, RAPIER, world) {
        const wallMat = new THREE.MeshStandardMaterial({ color: 0x778899, roughness: 0.8 });
        const wH = 14, wT = 1, wL = 5, gap = 3, bX = 10, bZ = -5;
        const mk = (x, y, z) => {
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(wT, wH, wL), wallMat);
            mesh.position.set(x, y, z);
            mesh.castShadow = mesh.receiveShadow = true;
            this._track(mesh);
            const b = this._addFixedBody(x, y, z);
            world.createCollider(RAPIER.ColliderDesc.cuboid(wT / 2, wH / 2, wL / 2), b);
        };
        mk(bX - gap / 2 - wT / 2, wH / 2, bZ);
        mk(bX + gap / 2 + wT / 2, wH / 2, bZ);
    }
}
