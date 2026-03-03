// chatSystem.js — Manages Twitch chat characters spawned near the player.
// One character per username at a time — repeated messages update the existing one.

import * as THREE from 'three';
import { TwitchChat } from './twitchChat.js';
import { ChatCharacter } from '../entities/chatCharacter.js';

const PLANET_CENTER = new THREE.Vector3(0, -50, 0);
const PLANET_RADIUS = 50;
const SPAWN_RADIUS = 2.0;   // units from player in the surface tangent plane
const MAX_CHARS = 30;    // max simultaneous unique users

export class ChatSystem {
    /**
     * @param {THREE.Scene} scene
     * @param {string} channel  — Twitch channel name (no #)
     * @param {Player} player   — Player instance to modify gravity
     * @param {SceneSetup} sceneSetup — SceneSetup instance to change day/night
     */
    constructor(scene, channel, player, sceneSetup) {
        this._scene = scene;
        this._player = player;
        this._sceneSetup = sceneSetup;
        this._byUser = new Map();  // username → ChatCharacter (dedup)
        this._queue = [];         // buffered messages while player pos unknown

        this._twitch = new TwitchChat(channel, (username, message, color, emotes) => {
            const msg = message.trim().toLowerCase();
            if (msg === '!gravité') {
                this._triggerLowGravity();
            } else if (msg === '!day') {
                this._sceneSetup.setTimeOfDay(1.0);
            } else if (msg === '!night') {
                this._sceneSetup.setTimeOfDay(0.0);
            }
            this._queue.push({ username, message, color, emotes });
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
        while (this._queue.length > 0 && this._byUser.size < MAX_CHARS) {
            const { username, message, color, emotes } = this._queue.shift();
            this._spawn(username, message, playerPos, color, emotes);
        }
        // Trim queue if overflowing
        if (this._queue.length > 20) this._queue.splice(0, this._queue.length - 20);

        // Update alive characters; remove dead ones from the map
        for (const [user, char] of this._byUser) {
            if (!char.update(dt)) this._byUser.delete(user);
        }
    }

    dispose() {
        for (const char of this._byUser.values()) char.dispose();
        this._byUser.clear();
        this._twitch.dispose();
        if (this._gravityTimeout) clearTimeout(this._gravityTimeout);
    }

    _triggerLowGravity() {
        // Set low gravity (e.g. 0.2x normal gravity)
        this._player.gravityMultiplier = 0.2;

        // Reset timer if already active
        if (this._gravityTimeout) clearTimeout(this._gravityTimeout);

        // Restore gravity after 15 seconds
        this._gravityTimeout = setTimeout(() => {
            this._player.gravityMultiplier = 1.0;
            this._gravityTimeout = null;
        }, 15000);
    }

    // ── Internal ──────────────────────────────────────────────────────────

    _spawn(username, message, playerPos, color = '', emotes = []) {
        // If this user already has a visible character, just update its bubble
        const existing = this._byUser.get(username);
        if (existing) {
            existing.updateMessage(message, color, emotes);
            return;
        }

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

        // Random point on a circle of SPAWN_RADIUS around player in the tangent plane
        const angle = Math.random() * Math.PI * 2;
        const r = SPAWN_RADIUS * (0.5 + 0.5 * Math.random());
        const worldOffset = tA.clone().multiplyScalar(Math.cos(angle) * r)
            .addScaledVector(tB, Math.sin(angle) * r);

        // Project back onto sphere surface
        const rawPos = playerPos.clone().add(worldOffset);
        const dir = new THREE.Vector3().subVectors(rawPos, PLANET_CENTER).normalize();
        const surfacePos = PLANET_CENTER.clone().addScaledVector(dir, PLANET_RADIUS);

        const char = new ChatCharacter(this._scene, surfacePos, dir, username, message, color, emotes);
        this._byUser.set(username, char);
    }
}
