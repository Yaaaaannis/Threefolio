// echoSystem.js — Records player positions, spawns ghost echoes that become platforms

import * as THREE from 'three';

const RECORD_INTERVAL = 0.3;   // seconds between recordings
const SPAWN_DELAY = 3.0;   // seconds before ghost appears
const MAX_BUFFER_SIZE = 200;
const DISSOLVE_DURATION = 4.0;   // fade-in from dissolve=1 → 0
const ECHO_LIFETIME = 20.0;  // seconds before echo dissolves out
const GHOST_SIZE = 0.45;  // radius of ghost sphere

export class EchoSystem {
    /**
     * @param {THREE.Scene} scene
     * @param {import('@dimforge/rapier3d-compat')} RAPIER
     * @param {import('@dimforge/rapier3d-compat').World} world
     */
    constructor(scene, RAPIER, world) {
        this.scene = scene;
        this.RAPIER = RAPIER;
        this.world = world;

        /** @type {EchoInstance[]} Active echo objects */
        this.echoes = [];
    }

    /**
     * Spawns an echo immediately.
     * @param {THREE.Vector3} position
     * @param {number} elapsedTime
     */
    spawnManualEcho(position, elapsedTime) {
        // Simply standard material
        const geo = new THREE.SphereGeometry(GHOST_SIZE, 12, 12);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x66aaff,
            emissive: 0x2255aa,
            transparent: true,
            opacity: 0,
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(position);
        // Lift echo slightly so it sits on floor
        mesh.position.y = Math.max(position.y, GHOST_SIZE);
        this.scene.add(mesh);

        // Rapier fixed collider (becomes a platform)
        const rbDesc = this.RAPIER.RigidBodyDesc.fixed()
            .setTranslation(mesh.position.x, mesh.position.y, mesh.position.z);
        const rb = this.world.createRigidBody(rbDesc);
        const col = this.world.createCollider(
            this.RAPIER.ColliderDesc.ball(GHOST_SIZE * 0.9),
            rb
        );

        const echo = {
            mesh, mat, rb, col,
            spawnTime: elapsedTime,
        };
        this.echoes.push(echo);
    }

    /**
     * @param {number} elapsedTime
     * @param {number} dt
     */
    update(elapsedTime, dt) {
        for (let i = this.echoes.length - 1; i >= 0; i--) {
            const echo = this.echoes[i];
            const age = elapsedTime - echo.spawnTime;

            // Fade in (opacity 0->1 over DISSOLVE_DURATION)
            if (echo.mat.opacity < 1.0 && age < ECHO_LIFETIME) {
                echo.mat.opacity += dt / DISSOLVE_DURATION;
                if (echo.mat.opacity > 1.0) echo.mat.opacity = 1.0;
            }

            // Fade out after lifetime
            if (age >= ECHO_LIFETIME) {
                echo.mat.opacity -= dt / 3.0;

                if (echo.mat.opacity <= 0) {
                    // Cleanup
                    this.scene.remove(echo.mesh);
                    echo.mesh.geometry.dispose();
                    echo.mat.dispose();
                    this.world.removeRigidBody(echo.rb);
                    this.echoes.splice(i, 1);
                }
            }
        }
    }

    /**
     * Main update — call once per frame.
     * @param {number} elapsedTime
     * @param {number} dt
     */
    tick(elapsedTime, dt) {
        this.update(elapsedTime, dt);
    }
}
