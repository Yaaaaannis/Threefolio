// chatSystem.js — Manages Twitch chat characters spawned near the player.
// Requires a TWITCH_CHANNEL constant to connect. Set it below or pass via constructor.

import * as THREE from 'three';
import { TwitchChat } from './twitchChat.js';
import { ChatCharacter } from '../entities/chatCharacter.js';

const PLANET_CENTER = new THREE.Vector3(0, -50, 0);
const PLANET_RADIUS = 50;
const SPAWN_RADIUS = 2.0;   // units from player in the surface tangent plane
const MAX_CHARS = 30;    // max simultaneous characters

export class ChatSystem {
    /**
     * @param {THREE.Scene} scene
     * @param {string} channel  — Twitch channel name (no #)
     */
    constructor(scene, channel) {
        this._scene = scene;
        this._characters = [];
        this._queue = [];   // buffered messages while player pos unknown

        this._twitch = new TwitchChat(channel, (username, message, color) => {
            this._queue.push({ username, message, color });
        });

        console.log(`[ChatSystem] Connected to #${channel}`);
    }

    /**
     * Call every frame.
     * @param {number}        dt
     * @param {THREE.Vector3} playerPos
     */
    update(dt, playerPos) {
        // Flush queued messages now that we have a player position
        while (this._queue.length > 0 && this._characters.length < MAX_CHARS) {
            const { username, message, color } = this._queue.shift();
            this._spawn(username, message, playerPos, color);
        }
        // Trim queue if overflowing
        if (this._queue.length > 20) this._queue.splice(0, this._queue.length - 20);

        // Update alive characters; remove dead ones
        this._characters = this._characters.filter(c => c.update(dt));
    }

    dispose() {
        for (const c of this._characters) c.dispose();
        this._characters = [];
        this._twitch.dispose();
    }

    // ── Internal ──────────────────────────────────────────────────────────

    _spawn(username, message, playerPos, color = '') {
        // Surface normal at player position
        const normal = new THREE.Vector3()
            .subVectors(playerPos, PLANET_CENTER)
            .normalize();

        // Two tangent vectors perpendicular to normal
        const arbUp = Math.abs(normal.y) < 0.9
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(1, 0, 0);
        const tA = new THREE.Vector3().crossVectors(normal, arbUp).normalize();
        const tB = new THREE.Vector3().crossVectors(normal, tA).normalize();

        // Random point on a circle of SPAWN_RADIUS around the player in the tangent plane
        const angle = Math.random() * Math.PI * 2;
        const r = SPAWN_RADIUS * (0.5 + 0.5 * Math.random()); // vary 0.5–1× radius
        const worldOffset = tA.clone().multiplyScalar(Math.cos(angle) * r)
            .addScaledVector(tB, Math.sin(angle) * r);

        // Project back onto sphere surface
        const rawPos = playerPos.clone().add(worldOffset);
        const dir = new THREE.Vector3().subVectors(rawPos, PLANET_CENTER).normalize();
        const surfacePos = PLANET_CENTER.clone().addScaledVector(dir, PLANET_RADIUS);

        const char = new ChatCharacter(this._scene, surfacePos, dir, username, message, color);
        this._characters.push(char);
    }
}
