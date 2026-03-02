// worldManager.js — Manages load/unload of one world at a time.
// Only one world (and its physics/3D objects) lives in memory at any moment.

export class WorldManager {
    /**
     * @param {THREE.Scene} scene
     * @param {*} RAPIER
     * @param {*} rapierWorld
     * @param {object} player — player instance (has rigidBody + planetCenter ref)
     */
    constructor(scene, RAPIER, rapierWorld, player) {
        this.scene = scene;
        this.RAPIER = RAPIER;
        this.rapierWorld = rapierWorld;
        this.player = player;
        this.current = null;
        this._transitioning = false;

        this._crossfade = document.getElementById('crossfade');
    }

    /** Load the first world (Hub) without a transition. */
    async init(WorldClass, ...extras) {
        this.current = new WorldClass(...extras);
        this.current.load(this.scene, this.RAPIER, this.rapierWorld);
        this._syncPlayer();
    }

    /**
     * Travel to another world class.
     * @param {typeof import('./worlds/BaseWorld').BaseWorld} WorldClass
     * @param {...any} extras  — extra constructor args (e.g. GLTF loader)
     */
    async switchTo(WorldClass, ...extras) {
        if (this._transitioning) return;
        this._transitioning = true;

        // 1. Fade out
        await this._fade(1);

        // 2. Tear down current world
        if (this.current) {
            this.current.dispose();
            this.current = null;
        }

        // 3. Build next world
        this.current = new WorldClass(...extras);
        this.current.load(this.scene, this.RAPIER, this.rapierWorld);

        // 4. Teleport player to new spawn point
        this._syncPlayer();

        // 5. Short pause to let GPU textures settle
        await new Promise(r => setTimeout(r, 200));

        // 6. Fade in
        await this._fade(0);

        this._transitioning = false;
    }

    /** Called every frame — delegates to the active world. */
    update(dt, playerPos, time) {
        this.current?.update(dt, playerPos, time);
    }

    /** Active planet center for gravity/camera */
    get planetCenter() { return this.current?.planetCenter ?? null; }

    // ── Internal ───────────────────────────────────────────────────────

    _syncPlayer() {
        if (!this.current) return;
        const spawn = this.current.spawnPoint;
        // Teleport physics body
        this.player.rigidBody.setTranslation({ x: spawn.x, y: spawn.y, z: spawn.z }, true);
        this.player.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.player.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    _fade(targetOpacity) {
        return new Promise(resolve => {
            if (!this._crossfade) { resolve(); return; }
            this._crossfade.style.transition = 'opacity 0.5s ease';
            this._crossfade.style.opacity = targetOpacity;
            setTimeout(resolve, 520);
        });
    }
}
