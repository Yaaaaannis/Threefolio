// BaseTheme.js — Abstract base for all themes.
// Like BaseWorld but WITHOUT the planet sphere/collider (PlanetCore owns those).
// Tracks every Three.js mesh and Rapier body so dispose() can clean them all up.

import * as THREE from 'three';

export class BaseTheme {
    constructor() {
        this._meshes = [];  // THREE.Object3D added to scene
        this._bodies = [];  // Rapier RigidBody
        this.scene = null;
        this.rapierWorld = null;
        this.RAPIER = null;
    }

    // ── Override in subclasses ────────────────────────────────────────────

    /** Called once to build the theme's surface decorations. */
    load(scene, RAPIER, rapierWorld) {
        this.scene = scene;
        this.RAPIER = RAPIER;
        this.rapierWorld = rapierWorld;
    }

    /** Key used by PlanetCore.setTheme(). Override in each subclass. */
    static get themeKey() { return 'hub'; }

    /** Called every frame by ThemeManager (optional override). */
    update(_dt, _playerPos, _time) { }

    // ── Helpers — use these to track objects for cleanup ─────────────────

    _track(mesh) {
        this.scene.add(mesh);
        this._meshes.push(mesh);
        return mesh;
    }

    _trackBody(body) {
        this._bodies.push(body);
        return body;
    }

    _addFixedBody(x, y, z) {
        return this._trackBody(
            this.rapierWorld.createRigidBody(
                this.RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z)
            )
        );
    }

    // ── Dispose ───────────────────────────────────────────────────────────

    dispose() {
        for (const mesh of this._meshes) {
            this.scene.remove(mesh);
            mesh.traverse(child => {
                if (child.isMesh) {
                    child.geometry?.dispose();
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material?.dispose();
                    }
                }
            });
        }
        for (const body of this._bodies) {
            try { this.rapierWorld.removeRigidBody(body); } catch (_) { }
        }
        this._meshes = [];
        this._bodies = [];
    }
}
