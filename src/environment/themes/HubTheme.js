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
import { Chimney } from '../../entities/chimney.js';
import { Lamp } from '../../entities/lamp.js';
import { Trampoline } from '../../entities/trampoline.js';
import { Cassette } from '../../entities/cassette.js';
import { JumpRope } from '../../entities/jumpRope.js';
import { CloudLayer } from '../cloudLayer.js';
import { HighStriker } from '../../entities/highStriker.js';
import { Rocks } from '../../entities/rocks.js';
import { SocialPad } from '../socialPad.js';


const PC = new THREE.Vector3(0, -50, 0);
const PR = 50;

// ── Layout — Bruno Simon style ────────────────────────────────────────────────
//
//                         NORTH  (Z-)
//              CubeWall (-8, 0, -15)  ← platforming zone
//         Chimney (0, 2, -10)  ← landmark beacon behind spawn
//
//  WEST                                              EAST
//  ChessZone (-24, 0, 0)       HighStriker (18, 1, 0)
//  Lamp (-12, 0, 6)            Trampoline  (16, 1, 12)
//
//            ● SPAWN (0, 1.5, 0)
//            FollowerSphere (-5, 4, -4)
//
//            JumpRope  (8,  1, 16)
//            Cassette  (13, 3, 22)  ← scoreboard above the rope
//            Football  (0,  1, 8)
//
//                         SOUTH  (Z+)
// ─────────────────────────────────────────────────────────────────────────────

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
        this._chimney = null;
        this._lamp = null;
        this._trampoline = null;
        this._cassette = null;
        this._jumpRope = null;
        this._cloudLayer = null;
        this._striker = null;
        this._rocks  = null;
        this._social = null;
    }

    get spawnPoint() { return new THREE.Vector3(0, 1.5, 0); }

    load(scene, RAPIER, rapierWorld, sceneSetup) {
        super.load(scene, RAPIER, rapierWorld, sceneSetup);

        // ── Atmosphere — hemisphere sky/ground light ──────────────────────
        this._hemiLight = new THREE.HemisphereLight(0xffeeb1, 0x4466aa, 0.5);
        scene.add(this._hemiLight);

        // ── Bloom post-processing ─────────────────────────────────────────
        sceneSetup?.setupPostProcessing({ strength: 0.3, radius: 0.45, threshold: 0.82 });

        // ── Grass ─────────────────────────────────────────────────────────
        this._grass = new Grass(scene);

        // ── Zones ─────────────────────────────────────────────────────────
        this._chessZone  = new ChessZone(scene, new THREE.Vector3(-24, 0.05, 0));
        this._spawnerZone = new SpawnerZone(scene, RAPIER, rapierWorld);

        // ── Follower — floats near spawn ──────────────────────────────────
        this._follower = new FollowerSphere(scene, new THREE.Vector3(-5, 4, -4));

        // ── Chimney — landmark beacon, north of spawn ─────────────────────
        this._chimney = new Chimney(
            scene,
            new THREE.Vector3(0, 2, -10),
            2,
            RAPIER,
            rapierWorld
        );
        if (sceneSetup) sceneSetup.chimney = this._chimney;

        // ── Lamp — lights the west path ───────────────────────────────────
        this._lamp = new Lamp(
            scene,
            20,
            RAPIER,
            rapierWorld
        );
        if (sceneSetup) sceneSetup.lamp = this._lamp;

        // ── CubeWall — platforming zone, north ────────────────────────────
        this._cubeWall = new CubeWall(scene, RAPIER, rapierWorld, new THREE.Vector3(-8, 0, -15), 4, 4, 1.0);

        // ── Football — free-play near spawn, south ────────────────────────
        this._football = new Football(scene, RAPIER, rapierWorld);

        // ── Trampoline — east bounce zone ─────────────────────────────────
        this._trampoline = new Trampoline(
            scene,
            new THREE.Vector3(16, 1, 12),
            2.0,
            RAPIER,
            rapierWorld
        );

        // ── High Striker — east challenge ─────────────────────────────────
        this._striker = new HighStriker(
            scene,
            new THREE.Vector3(18, 1, 0),
            RAPIER,
            rapierWorld
        );

        // ── JumpRope + Cassette scoreboard — south activity zone ──────────
        this._jumpCount = 0;
        this._jumpRope = new JumpRope(scene, new THREE.Vector3(8, 1, 16), {
            onJumpSuccess: () => {
                this._jumpCount++;
                this._cassette?.triggerSuccessGlimmer();
                this._cassette?.setCount(this._jumpCount);
            },
            onJumpFail: () => {
                this._jumpCount = 0;
                this._cassette?.triggerFailFlash();
            }
        });

        const CASSETTE_SCALE    = 0.8;
        const CASSETTE_ELEVATION = 3;
        const CASSETTE_ROTATION  = Math.PI * 0.5;

        this._cassette = new Cassette(
            scene,
            new THREE.Vector3(13, 3, 22),
            CASSETTE_SCALE,
            CASSETTE_ELEVATION,
            CASSETTE_ROTATION
        );
        window.cassette = this._cassette;

        // ── Rocks — pebble props on the dirt zones ────────────────────────
        this._rocks = new Rocks(scene);

        // ── Social Pad — GitHub / LinkedIn / X ───────────────────────────
        this._social = new SocialPad(scene, new THREE.Vector3(-20, 1, -12));

        // ── Cloud Layer ───────────────────────────────────────────────────
        this._cloudLayer = new CloudLayer(scene);
        if (sceneSetup) sceneSetup.clouds = this._cloudLayer;
    }

    update(dt, playerPos, time, chatPositions = [], player = null) {
        const TIMESTEP = 1 / 60;
        this._cubeWall?.update(TIMESTEP);
        this._football?.update(TIMESTEP);
        if (playerPos) {
            let cubePositions = this._cubeWall?.cubes?.map(c => {
                const t = c.rigidBody.translation();
                return { x: t.x, z: t.z };
            }) ?? [];

            // Chat characters also displace the grass
            if (chatPositions.length > 0) {
                cubePositions = cubePositions.concat(chatPositions.map(p => ({ x: p.x, z: p.z })));
            }

            this._grass?.update(time, playerPos, true, cubePositions);
            this._chessZone?.update(playerPos);
            this._spawnerZone?.update(playerPos);
            this._follower?.update(time, playerPos, dt ?? 0.016);
            this._chimney?.update(dt ?? 0.016);
            this._trampoline?.update(dt ?? 0.016, player);
            this._cassette?.update(dt ?? 0.016);
            this._jumpRope?.update(dt ?? 0.016, player);
            this._striker?.update(dt ?? 0.016, player);
        }
        this._social?.update(dt ?? 0.016, playerPos);
        this._cloudLayer?.update(time ?? 0);
    }

    dispose() {
        if (this.scene) this.scene.fog = null;

        if (this._hemiLight) {
            this.scene?.remove(this._hemiLight);
            this._hemiLight.dispose?.();
            this._hemiLight = null;
        }

        this.sceneSetup?.teardownPostProcessing();

        if (this._grass?.mesh) {
            this.scene.remove(this._grass.mesh);
            this._grass.mesh.geometry?.dispose();
            this._grass.mesh.material?.dispose();
        }
        if (this._spawnerZone?.ringMesh) {
            this.scene.remove(this._spawnerZone.ringMesh);
            this._spawnerZone.ringMesh.geometry?.dispose();
            this._spawnerZone.ringMesh.material?.dispose();
        }
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
        this._chimney?.dispose();
        if (this.sceneSetup) this.sceneSetup.lamp = null;
        if (this.sceneSetup) this.sceneSetup.chimney = null;
        this._lamp?.dispose();
        this._trampoline?.dispose();
        this._cassette?.dispose();
        this._jumpRope?.dispose();
        this._cloudLayer?.dispose();
        if (this.sceneSetup) this.sceneSetup.clouds = null;
        this._striker?.dispose();
        this._rocks?.dispose();
        this._social?.dispose();
        super.dispose();
    }
}
