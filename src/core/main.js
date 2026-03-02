// main.js — Entry point, game loop, Rapier init

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { SceneSetup } from '../core/scene.js';
import { Player } from '../entities/player.js';
import { EchoSystem } from '../systems/echoSystem.js';
import { ParticleSystem } from '../systems/particleSystem.js';
import { state, updateState } from '../core/stateManager.js';
import Stats from 'three/addons/libs/stats.module.js';
import { initMobileControls } from '../ui/mobileControls.js';

// World system
import { WorldManager } from '../environment/worldManager.js';
import { HubWorld } from '../environment/worlds/HubWorld.js';
import { DesertWorld } from '../environment/worlds/DesertWorld.js';
import { IceWorld } from '../environment/worlds/IceWorld.js';
import { LavaWorld } from '../environment/worlds/LavaWorld.js';
import { GalaxyMenu } from '../ui/galaxyMenu.js';

const CLIMB_THRESHOLD = 5; // units height to trigger ending

async function init() {
    // Init Rapier WASM
    await RAPIER.init();

    // Init Mobile Controls
    initMobileControls();

    // Physics world (zero gravity, we apply spherical gravity manually)
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });

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
    const echoSys = new EchoSystem(scene, RAPIER, world);
    const particleSys = new ParticleSystem(scene);

    // Galaxy Menu — single portal opens this Mario-Galaxy-style selector
    const galaxyMenu = new GalaxyMenu((key) => travelTo(key));

    // World Manager — handles load/unload of one planet at a time
    const worldManager = new WorldManager(scene, RAPIER, world, player);

    // Travel callback — triggers world switch with crossfade
    const WORLD_MAP = {
        hub: (onPortal) => worldManager.switchTo(HubWorld, onPortal),
        desert: (onPortal) => worldManager.switchTo(DesertWorld, onPortal),
        ice: (onPortal) => worldManager.switchTo(IceWorld, onPortal),
        lava: (onPortal) => worldManager.switchTo(LavaWorld, onPortal),
    };
    function travelTo(key) {
        const fn = WORLD_MAP[key];
        if (fn) fn(onPortal);
    }
    function onPortal(currentKey) {
        galaxyMenu.open(currentKey);
    }

    // Load Hub as first world
    await worldManager.init(HubWorld, onPortal);

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
            player.update(TIMESTEP, sceneSetup.camera);
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

        // Room / world update (active world)
        const planetCenter = worldManager.planetCenter;
        worldManager.update(dt, playerPos, now);

        // Zone update (hub-specific zones now in worldManager.update above)

        // Particles update
        particleSys.update(now);

        const targetPos = playerPos;

        // Grass update — delegated to active world (HubWorld manages its own)
        // (world manager update above covers it)

        // Follower Sphere — managed by active world (HubWorld)

        // Camera + lighting
        sceneSetup.update(targetPos, state.roomEnergy, dt);

        sceneSetup.render();

        stats.end();
    }

    gameLoop();
}

init().catch(console.error);
