// chatSystem.js — Manages Twitch chat characters spawned near the player.
// One character per username at a time — repeated messages update the existing one.

import * as THREE from 'three';
import { TwitchChat } from './twitchChat.js';
import { ChatCharacter } from '../entities/chatCharacter.js';
import { ChatBomb } from '../entities/chatBomb.js';
import { ChatEmoteDrop } from '../entities/chatEmoteDrop.js';

const PLANET_CENTER = new THREE.Vector3(0, -50, 0);
const PLANET_RADIUS = 50;
const SPAWN_RADIUS = 5.0;   // units from player in the surface tangent plane (increased for more spread)
const AVOIDANCE_RADIUS = 2.0; // minimum distance between characters
const MAX_CHARS = 30;    // max simultaneous unique users

export class ChatSystem {
    /**
     * @param {THREE.Scene} scene
     * @param {string} channel  — Twitch channel name (no #)
     * @param {Player} player   — Player instance to modify gravity
     * @param {SceneSetup} sceneSetup — SceneSetup instance to change day/night
     * @param {object} RAPIER   — Rapier physics engine
     * @param {object} world    — Rapier physics world
     */
    constructor(scene, channel, player, sceneSetup, RAPIER, world) {
        this._scene = scene;
        this._player = player;
        this._sceneSetup = sceneSetup;
        this._RAPIER = RAPIER;
        this._world = world;
        this._byUser = new Map();  // username → ChatCharacter (dedup)
        this._queue = [];         // buffered messages while player pos unknown
        this._bombs = [];         // active ChatBombs
        this._emoteDrops = [];    // active ChatEmoteDrops

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

        // Periodically assign new random walking targets to all characters
        this._retargetTimer += dt;
        if (this._retargetTimer > 2.0) { // Every 2 seconds, give them a chance to change direction
            this._retargetTimer = 0;
            for (const char of this._byUser.values()) {
                if (Math.random() < 0.3) { // 30% chance to pick a new destination
                    const newTarget = this._getRandomSurfacePos(playerPos, 5.0); // Wander within 5 units of player
                    char.setTarget(newTarget);
                }
            }
        }

        // Update active bombs
        for (let i = this._bombs.length - 1; i >= 0; i--) {
            const bomb = this._bombs[i];
            if (!bomb.update(dt)) {
                this._bombs.splice(i, 1);
            }
        }

        // Update active emote drops
        for (let i = this._emoteDrops.length - 1; i >= 0; i--) {
            const drop = this._emoteDrops[i];
            if (!drop.update(dt)) {
                this._emoteDrops.splice(i, 1);
            }
        }
    }

    dispose() {
        for (const char of this._byUser.values()) char.dispose();
        this._byUser.clear();
        for (const bomb of this._bombs) bomb.dispose();
        this._bombs = [];
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

    _getRandomSurfacePos(playerPos, radius) {
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

        const activePositions = this.activePositions;

        // Try up to 10 times to find a spot that's far enough from others
        let bestPos = null;
        let maxDist = -1;

        for (let attempt = 0; attempt < 10; attempt++) {
            // Random point on a circle in the tangent plane
            const angle = Math.random() * Math.PI * 2;
            const r = radius * (0.3 + 0.7 * Math.random()); // spawn further out
            const worldOffset = tA.clone().multiplyScalar(Math.cos(angle) * r)
                .addScaledVector(tB, Math.sin(angle) * r);

            // Project back onto sphere surface
            const rawPos = playerPos.clone().add(worldOffset);
            const dir = new THREE.Vector3().subVectors(rawPos, PLANET_CENTER).normalize();
            const candidatePos = PLANET_CENTER.clone().addScaledVector(dir, PLANET_RADIUS);

            // Check distance to other characters
            let minDistToOther = Infinity;
            for (const otherPos of activePositions) {
                const dist = candidatePos.distanceTo(otherPos);
                if (dist < minDistToOther) minDistToOther = dist;
            }

            if (minDistToOther >= AVOIDANCE_RADIUS) {
                return candidatePos; // Found a good spot
            }

            // Keep track of the best attempt in case we fail 10 times
            if (minDistToOther > maxDist) {
                maxDist = minDistToOther;
                bestPos = candidatePos;
            }
        }

        // Fallback to the best found position if it's too crowded
        return bestPos || playerPos;
    }

    _spawn(username, message, playerPos, color = '', emotes = []) {
        // If this user already has a visible character, just update its bubble
        const existing = this._byUser.get(username);
        if (existing) {
            existing.updateMessage(message, color, emotes);
            // Optionally bring them closer to player when they speak again, but try not to overlap
            existing.setTarget(this._getRandomSurfacePos(playerPos, SPAWN_RADIUS));

            // Check for bomb command from existing user
            if (message.toLowerCase().trim().includes('!bomb')) {
                this._spawnBomb(existing._body.position.clone().add(new THREE.Vector3().subVectors(existing._body.position, PLANET_CENTER).normalize().multiplyScalar(1.0)));
            }

            this._dropEmotes(emotes, playerPos);

            return;
        }

        const surfacePos = this._getRandomSurfacePos(playerPos, SPAWN_RADIUS);
        const dir = new THREE.Vector3().subVectors(surfacePos, PLANET_CENTER).normalize();

        // Add a little height so they drop in
        surfacePos.addScaledVector(dir, 5.0);

        const char = new ChatCharacter(
            this._scene,
            surfacePos,
            dir,
            username,
            message,
            color,
            emotes,
            this._RAPIER,
            this._world
        );
        this._byUser.set(username, char);

        // Check for bomb command from new user
        if (message.toLowerCase().trim().includes('!bomb')) {
            this._spawnBomb(surfacePos.clone().add(dir.clone().multiplyScalar(1.0)));
        }

        this._dropEmotes(emotes, playerPos);
    }

    _dropEmotes(emotes, playerPos) {
        if (!emotes || emotes.length === 0) return;

        // Count total emotes, cap at 10 to avoid too many physics objects
        const maxDrops = 10;
        let spawned = 0;

        for (const em of emotes) {
            if (spawned >= maxDrops) break;
            const imgUrl = em.url || `https://static-cdn.jtvnw.net/emoticons/v2/${em.id}/default/light/3.0`;
            const spawnPos = this._getRandomSurfacePos(playerPos, 15.0);
            const upNormal = new THREE.Vector3().subVectors(spawnPos, PLANET_CENTER).normalize();
            // drop gently above the player
            const dropPos = spawnPos.clone().addScaledVector(upNormal, 8.0 + Math.random() * 5.0);
            this._spawnEmoteDrop(imgUrl, dropPos);
            spawned++;
        }
    }

    _spawnEmoteDrop(imageUrl, position) {
        const drop = new ChatEmoteDrop(this._scene, this._RAPIER, this._world, position, imageUrl);
        this._emoteDrops.push(drop);
    }

    _spawnBomb(position) {
        const bomb = new ChatBomb(this._scene, this._RAPIER, this._world, position, this._player);
        this._bombs.push(bomb);
    }

    /**
     * @returns {Array<{x: number, y: number, z: number}>} Array of active character positions
     */
    get activePositions() {
        const positions = [];
        for (const char of this._byUser.values()) {
            if (char._alive && char._body) {
                positions.push(char._body.position.clone());
            }
        }
        return positions;
    }
}
