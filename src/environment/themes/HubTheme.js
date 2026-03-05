// HubTheme.js — Hub/Spawn surface decorations.
// All the entities from HubWorld minus the planet sphere/collider (PlanetCore owns those).

import * as THREE from 'three';
import { BaseTheme } from './BaseTheme.js';
import { Grass } from '../grass.js';
import { CubeWall } from '../cubeWall.js';
import { Football } from '../../entities/football.js';

import { ChessZone } from '../chessZone.js';
import { SpawnerZone } from '../spawnerZone.js';
import { FollowerSphere } from '../../entities/followerSphere.js';
import { StartPlane } from '../../entities/startPlane.js';
import { Chimney } from '../../entities/chimney.js';
import { Lamp } from '../../entities/lamp.js';

const PC = new THREE.Vector3(0, -50, 0);
const PR = 50;

export class HubTheme extends BaseTheme {
    static get themeKey() { return 'hub'; }

    constructor(onPortal) {
        super();
        this._onPortal = onPortal;
        this._grass = null;
        this._cubeWall = null;
        this._football = null;
        this._chessZone = null;
        this._spawnerZone = null;
        this._follower = null;
        this._socialZone = null;
        this._startPlane = null;
        this._chimney = null;
        this._lamp = null;
    }

    get spawnPoint() { return new THREE.Vector3(0, 1.5, 0); }

    load(scene, RAPIER, rapierWorld, sceneSetup) {
        super.load(scene, RAPIER, rapierWorld, sceneSetup);

        // ── Atmosphere — hemisphere sky/ground light ──────────────────────
        // Adds a warm golden sky tone from above and cool blue-green from below
        this._hemiLight = new THREE.HemisphereLight(0xffeeb1, 0x4466aa, 0.5);
        scene.add(this._hemiLight);

        // ── Bloom post-processing ─────────────────────────────────────────
        // Subtle bloom: only very bright areas (sky, glowing particles, lights) bleed
        sceneSetup?.setupPostProcessing({ strength: 0.3, radius: 0.45, threshold: 0.82 });

        // ── Wall-jump corridor ────────────────────────────────────────────


        // ── Grass ─────────────────────────────────────────────────────────
        this._grass = new Grass(scene);

        // ── CubeWall ──────────────────────────────────────────────────────
        this._cubeWall = new CubeWall(scene, RAPIER, rapierWorld, new THREE.Vector3(-10, 0, 8), 4, 4, 1.0);

        // ── Football ──────────────────────────────────────────────────────
        this._football = new Football(scene, RAPIER, rapierWorld);

        // ── Hub-specific zones ────────────────────────────────────────────
        this._chessZone = new ChessZone(scene, new THREE.Vector3(-22, 0.05, 0));
        this._spawnerZone = new SpawnerZone(scene, RAPIER, rapierWorld);
        this._follower = new FollowerSphere(scene, new THREE.Vector3(-8, 5, -8));

        // ── Start Plane ── near spawn (Acts as portal) ─────────────────────
        this._startPlane = new StartPlane(
            scene,
            new THREE.Vector3(-15, -1.5, -10),
            7,
            RAPIER,
            rapierWorld,
            () => this._onPortal('hub')
        );

        // ── Chimney ────────────────────────────────────────────────────────
        this._chimney = new Chimney(
            scene,
            new THREE.Vector3(0, 2, 0),
            2,
            RAPIER,
            rapierWorld
        );

        // ── Lamp ───────────────────────────────────────────────────────────
        this._lamp = new Lamp(
            scene,
            20 // Max instances
        );
        if (sceneSetup) sceneSetup.lamp = this._lamp;
    }


    update(dt, playerPos, time, chatPositions = []) {
        const TIMESTEP = 1 / 60;
        this._cubeWall?.update(TIMESTEP);
        this._football?.update(TIMESTEP);
        if (playerPos) {
            let cubePositions = this._cubeWall?.cubes?.map(c => {
                const t = c.rigidBody.translation();
                return { x: t.x, z: t.z };
            }) ?? [];

            // Add chat characters so they also displace the grass
            if (chatPositions.length > 0) {
                cubePositions = cubePositions.concat(chatPositions.map(p => ({ x: p.x, z: p.z })));
            }

            this._grass?.update(time, playerPos, true, cubePositions);
            this._chessZone?.update(playerPos);
            this._spawnerZone?.update(playerPos);
            this._follower?.update(time, playerPos, dt ?? 0.016);
            this._socialZone?.update(dt ?? 0.016, playerPos, time);
            this._startPlane?.update(dt ?? 0.016, playerPos);
            this._chimney?.update(dt ?? 0.016);
        }
    }

    dispose() {
        // Remove fog
        if (this.scene) this.scene.fog = null;

        // Remove hemisphere light
        if (this._hemiLight) {
            this.scene?.remove(this._hemiLight);
            this._hemiLight.dispose?.();
            this._hemiLight = null;
        }

        // Tear down bloom
        this.sceneSetup?.teardownPostProcessing();

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
        this._football?.dispose();
        this._cubeWall?.dispose();
        if (this._follower?.mesh) {
            this.scene.remove(this._follower.mesh);
            this._follower.mesh.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
        }
        this._socialZone?.dispose();
        this._startPlane?.dispose();
        this._chimney?.dispose();
        if (this.sceneSetup) this.sceneSetup.lamp = null;
        this._lamp?.dispose();
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
