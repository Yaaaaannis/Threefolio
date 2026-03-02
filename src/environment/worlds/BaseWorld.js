// BaseWorld.js — Abstract base class for all worlds.
// Tracks every Three.js mesh and Rapier body added so dispose() can clean them all up.

import * as THREE from 'three';

export class BaseWorld {
    constructor() {
        this._meshes = []; // THREE.Object3D added to scene
        this._bodies = []; // Rapier RigidBody
        this.scene = null;
        this.rapierWorld = null;
    }

    // ── Override these in subclasses ────────────────────────────────────

    /** Called once to build the world. Must call super.load() first. */
    load(scene, RAPIER, rapierWorld) {
        this.scene = scene;
        this.RAPIER = RAPIER;
        this.rapierWorld = rapierWorld;
    }

    /** World's spawn point (where the player appears). */
    get spawnPoint() {
        return new THREE.Vector3(0, this.planetRadius + 1.5, 0).add(this.planetCenter);
    }

    /** Center of this world's planet (also the gravity attractor). */
    get planetCenter() { return new THREE.Vector3(0, -50, 0); }

    /** Radius of this world's planet. */
    get planetRadius() { return 50; }

    /** Called every frame by WorldManager (optional override). */
    update(_dt) { }

    // ── Helpers: use these instead of scene.add / world.createRigidBody ─

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

    // ── Dispose: removes everything this world created ───────────────────

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
