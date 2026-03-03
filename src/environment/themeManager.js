// themeManager.js — Orchestrates PlanetCore + theme switching with in/out scale animations.
// Replaces worldManager.js. The planet sphere/collider never gets destroyed.

import { PlanetCore, PLANET_CENTER } from './planetCore.js';

// Easing
const easeInCubic = t => t * t * t;
const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

const OUT_MS = 400;  // ms — tracked meshes shrink into ground
const IN_MS = 500;  // ms — new meshes spring up

export class ThemeManager {
    /**
     * @param {THREE.Scene} scene
     * @param {*} RAPIER
     * @param {*} rapierWorld
     * @param {object} player
     */
    constructor(scene, RAPIER, rapierWorld, player) {
        this.scene = scene;
        this.RAPIER = RAPIER;
        this.rapierWorld = rapierWorld;
        this.player = player;

        // Permanent planet — lives for the entire session
        this._planet = new PlanetCore(scene, RAPIER, rapierWorld);

        this._current = null;
        this._transitioning = false;

        // Transition animation state (driven in update())
        this._phase = null;         // 'out' | 'in' | null
        this._elapsed = 0;
        this._outMeshes = [];           // { mesh, origScale: THREE.Vector3 }
        this._inMeshes = [];
    }

    // ── Public API ────────────────────────────────────────────────────────

    get planetCenter() { return PLANET_CENTER; }

    /** Load the first theme without animation. */
    async init(ThemeClass, ...extras) {
        this._current = new ThemeClass(...extras);
        this._current.load(this.scene, this.RAPIER, this.rapierWorld);
        this._planet.setTheme(ThemeClass.themeKey ?? 'hub');
        this._syncPlayer();
    }

    /**
     * Switch to a new theme with scale in/out animation.
     * Tracked meshes (those added via _track()) sink into the surface, then rise back up.
     */
    async switchTheme(ThemeClass, ...extras) {
        if (this._transitioning) return;
        this._transitioning = true;

        // ── 1. Out animation ───────────────────────────────────────────────
        this._outMeshes = (this._current?._meshes ?? []).map(m => ({
            mesh: m, origScale: m.scale.clone(),
        }));
        this._phase = 'out';
        this._elapsed = 0;
        await this._wait(OUT_MS + 50); // let update() run the animation

        // ── 2. Swap themes ─────────────────────────────────────────────────
        this._current?.dispose();
        this._current = null;

        const next = new ThemeClass(...extras);
        next.load(this.scene, this.RAPIER, this.rapierWorld);

        // Capture new theme meshes and zero their scale for the in-animation
        this._inMeshes = (next._meshes ?? []).map(m => ({
            mesh: m, origScale: m.scale.clone(),
        }));
        for (const { mesh } of this._inMeshes) mesh.scale.setScalar(0);

        this._current = next;
        this._planet.setTheme(ThemeClass.themeKey ?? 'hub');
        this._syncPlayer();

        // ── 3. In animation ────────────────────────────────────────────────
        this._phase = 'in';
        this._elapsed = 0;
        await this._wait(IN_MS + 50);

        // Snap to exact final scales (easing might leave tiny float error)
        for (const { mesh, origScale } of this._inMeshes) mesh.scale.copy(origScale);

        this._phase = null;
        this._outMeshes = [];
        this._inMeshes = [];
        this._transitioning = false;
    }

    /** Call every frame from the game loop. */
    update(dt, playerPos, time, chatPositions = []) {
        // Lerp planet surface colors
        this._planet.update(dt);

        // Transition animation
        if (this._phase) {
            this._elapsed += dt;

            if (this._phase === 'out') {
                const t = Math.min(this._elapsed / (OUT_MS / 1000), 1);
                const s = 1 - easeInCubic(t);
                for (const { mesh, origScale } of this._outMeshes) {
                    mesh.scale.set(origScale.x * s, origScale.y * s, origScale.z * s);
                }
            } else if (this._phase === 'in') {
                const t = Math.min(this._elapsed / (IN_MS / 1000), 1);
                const s = Math.max(0, easeOutBack(t));
                for (const { mesh, origScale } of this._inMeshes) {
                    mesh.scale.set(origScale.x * s, origScale.y * s, origScale.z * s);
                }
            }
        }

        // Update active theme
        this._current?.update(dt, playerPos, time, chatPositions);
    }

    // ── Internal ──────────────────────────────────────────────────────────

    _syncPlayer() {
        if (!this._current?.spawnPoint) return;
        const sp = this._current.spawnPoint;
        this.player.rigidBody.setTranslation({ x: sp.x, y: sp.y, z: sp.z }, true);
        this.player.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.player.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    _wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
}
