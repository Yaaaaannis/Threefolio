// main.js — Entry point, game loop, Rapier init

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { SceneSetup } from '../core/scene.js';
import { Player } from '../entities/player.js';
import { Room } from '../environment/room.js';
import { EchoSystem } from '../systems/echoSystem.js';
import { SpawnerZone } from '../environment/spawnerZone.js';
import { ParticleSystem } from '../systems/particleSystem.js';
import { CubeWall } from '../environment/cubeWall.js';
import { Grass } from '../environment/grass.js';
import { Chess } from '../entities/chess.js';
import { ChessZone } from '../environment/chessZone.js';
import { state, updateState } from '../core/stateManager.js';
import Stats from 'three/addons/libs/stats.module.js';
import { initMobileControls } from '../ui/mobileControls.js';

const CLIMB_THRESHOLD = 5; // units height to trigger ending

async function init() {
    // Init Rapier WASM
    await RAPIER.init();

    // Init Mobile Controls
    initMobileControls();

    // Physics world (gravity down)
    const world = new RAPIER.World({ x: 0, y: -20, z: 0 });

    // Canvas
    const canvas = document.createElement('canvas');
    document.getElementById('app').appendChild(canvas);

    // Scene
    const sceneSetup = new SceneSetup(canvas);
    const { scene, renderer } = sceneSetup;

    // WebGPU Renderer Initialization
    await renderer.init();

    // Systems
    const player = new Player(scene, RAPIER, world);
    const room = new Room(scene, RAPIER, world);
    const echoSys = new EchoSystem(scene, RAPIER, world);
    const spawnerZone = new SpawnerZone(scene, RAPIER, world);
    const particleSys = new ParticleSystem(scene);
    const grass = new Grass(scene);

    // Chess piece (spawned slightly above the floor and close to the player origin)
    const chessPosition = new THREE.Vector3(-30, 0, 0);
    const chess = new Chess(scene, RAPIER, world, chessPosition);

    // Chess Zone (Shifted slightly closer per request)
    const chessZone = new ChessZone(scene, new THREE.Vector3(-22, 0.05, 0));

    // Spawn a 4x4 wall of 1-unit cubes to the right of the starting position
    const wallStartPos = new THREE.Vector3(-6, 0, 8);
    const cubeWall = new CubeWall(scene, RAPIER, world, wallStartPos, 4, 4, 1.0);

    // Provide player with ability to emit particles using global time
    player.particleSystem = particleSys;
    player.timeGetter = () => clock.elapsedTime;

    // UI refs
    const crossfade = document.getElementById('crossfade');
    const endText = document.getElementById('end-text');
    const hint = document.getElementById('controls-hint');

    // Fade hint out after 5s
    setTimeout(() => { hint.style.opacity = '0'; }, 5000);

    // Stats setup
    const stats = new Stats();
    stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
    stats.dom.style.position = 'absolute';
    stats.dom.style.top = '10px';
    stats.dom.style.left = '10px';
    stats.dom.style.zIndex = '9999';
    stats.dom.style.pointerEvents = 'auto'; // allow clicking through the UI layer
    document.getElementById('ui').appendChild(stats.dom);

    // Possession state
    let isPossessingQueen = false;

    // Keys state for the game loop (since player module abstracts it, we need our own local tracking for possession)
    const inputState = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false, Enter: false, Escape: false };

    // Listen for inputs
    window.addEventListener('keydown', (e) => {
        if (e.code in inputState) inputState[e.code] = true;

        // Handle possession toggling here to avoid multiple triggers per frame
        if (e.code === 'Enter' && chessZone.isPlayerInside && !isPossessingQueen) {
            isPossessingQueen = true;
            player.isFrozen = true;
            sceneSetup.setCameraMode('topdown');
            uiElementToggle(hint, "Press ECHAP to exit Queen Mode", true);
        } else if (e.code === 'Escape' && isPossessingQueen) {
            isPossessingQueen = false;
            player.isFrozen = false;
            sceneSetup.setCameraMode('player');
            uiElementToggle(hint, "", false);
        }
    });
    window.addEventListener('keyup', (e) => {
        if (e.code in inputState) inputState[e.code] = false;
    });

    // Helper for UI
    function uiElementToggle(element, text, show) {
        if (!element) return;
        if (text) element.innerText = text;
        element.style.opacity = show ? '1' : '0';
        element.style.transition = 'opacity 0.3s';
    }

    // Clock
    const clock = new THREE.Clock();
    let ending = false;
    let physicsAccumulator = 0;

    function gameLoop() {
        requestAnimationFrame(gameLoop);
        stats.begin();

        const dt = Math.min(clock.getDelta(), 0.1); // cap at 100ms
        const now = clock.elapsedTime;

        // --- Physics step (Fix: Frame-rate independence) ---
        const TIMESTEP = 1 / 60;
        physicsAccumulator += dt;
        while (physicsAccumulator >= TIMESTEP) {
            // Player logic must be inside the fixed loop for consistent movement
            player.update(TIMESTEP);
            world.step();
            physicsAccumulator -= TIMESTEP;
        }

        const playerPos = player.getPosition();

        // State update
        updateState(player.speed, dt, playerPos.y);

        // Manual ghost echo spawn
        if (player.wantsToSpawnGhost) {
            echoSys.spawnManualEcho(playerPos, state.elapsedTime);
        }

        // Echo system
        echoSys.tick(state.elapsedTime, dt);

        // Room update
        room.update(playerPos, state.roomEnergy, dt, now);

        // Zone update
        spawnerZone.update(playerPos);

        // Particles update
        particleSys.update(now);

        // Grass update (pass player position so grass bends on contact)
        const targetPos = isPossessingQueen ?
            (chess.getBlackQueen() ? chess.getBlackQueen().body.translation() : playerPos) :
            playerPos;

        const cubePositions = cubeWall.cubes.map(c => {
            const t = c.rigidBody.translation();
            return { x: t.x, z: t.z };
        });
        grass.update(now, targetPos, player._onGround, cubePositions);

        // Zone update for the chess mini-game
        chessZone.update(playerPos);

        // Wall update
        cubeWall.update();

        // Chess update
        chess.update();
        if (isPossessingQueen) {
            chess.moveQueen(TIMESTEP, inputState);
        }

        // Camera + lighting
        sceneSetup.update(targetPos, state.roomEnergy, dt);

        sceneSetup.render();

        stats.end();
    }

    gameLoop();
}

init().catch(console.error);
