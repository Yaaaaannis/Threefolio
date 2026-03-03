// chatCharacter.js — A small 3D "viewer" character (cylinder body + sphere head)
// with a comic-book speech bubble above it. Automatically removes itself after LIFETIME_S.

import * as THREE from 'three';

const LIFETIME_S = 15;
const HEAD_RADIUS = 0.45;
const BODY_HEIGHT = 1.1;
const BODY_RADIUS = 0.32;

// Vivid colors for different usernames (hash-based)
const PALETTE = [
    0xff6b6b, 0xffa94d, 0xffe066, 0x69db7c,
    0x4dabf7, 0x9775fa, 0xf783ac, 0x63e6be,
];
function colorForName(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
}

function makeBubbleSprite(username, message, nameColorHex, emotes = [], onUpdate = null) {
    const W = 768, H = 384;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);

    // Sort emotes by start index
    const sortedEmotes = [...emotes].sort((a, b) => a.start - b.start);

    // Segment the message into text blocks and emote blocks
    const segments = [];
    let lastIndex = 0;
    for (const em of sortedEmotes) {
        if (em.start > lastIndex) {
            segments.push({ type: 'text', content: message.substring(lastIndex, em.start) });
        }

        // Use custom URL if provided (for 3rd party emotes), otherwise build Twitch CDN URL
        const imgUrl = em.url || `https://static-cdn.jtvnw.net/emoticons/v2/${em.id}/default/light/3.0`;

        segments.push({ type: 'emote', url: imgUrl, img: null });
        lastIndex = em.end + 1;
    }
    if (lastIndex < message.length) {
        segments.push({ type: 'text', content: message.substring(lastIndex) });
    }

    // Pre-load emote images
    let pendingImages = 0;
    for (const seg of segments) {
        if (seg.type === 'emote') {
            pendingImages++;
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                seg.img = img;
                pendingImages--;
                if (pendingImages === 0) draw();
            };
            img.onerror = () => {
                pendingImages--;
                if (pendingImages === 0) draw();
            };
            img.src = seg.url;
        }
    }

    function draw() {
        // Background: white rounded rect
        const pad = 20, r = 28, tailH = 36;
        const boxH = H - tailH - 4;

        ctx.clearRect(0, 0, W, H);

        // Shadow
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 4;

        // Bubble body
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#222222';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(pad + r, pad);
        ctx.lineTo(W - pad - r, pad);
        ctx.arcTo(W - pad, pad, W - pad, pad + r, r);
        ctx.lineTo(W - pad, boxH - r);
        ctx.arcTo(W - pad, boxH, W - pad - r, boxH, r);
        // Tail
        ctx.lineTo(W / 2 + 40, boxH);
        ctx.lineTo(W / 2, boxH + tailH);
        ctx.lineTo(W / 2 - 20, boxH);
        ctx.lineTo(pad + r, boxH);
        ctx.arcTo(pad, boxH, pad, boxH - r, r);
        ctx.lineTo(pad, pad + r);
        ctx.arcTo(pad, pad, pad + r, pad, r);
        ctx.closePath();
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.stroke();

        // Username
        const nameColor = nameColorHex || ('#' + colorForName(username).toString(16).padStart(6, '0'));
        ctx.font = 'bold 56px Arial';
        ctx.fillStyle = nameColor;
        ctx.textBaseline = 'top';
        ctx.shadowColor = 'rgba(0,0,0,0.2)';
        ctx.shadowBlur = 4;
        ctx.fillText(username, pad + 12, pad + 14);
        ctx.shadowColor = 'transparent';

        // Message
        ctx.font = '46px Arial';
        ctx.fillStyle = '#222222';
        const maxW = W - pad * 2 - 24;

        const lineH = 56;
        let cx = pad + 12;
        let cy = pad + 88;
        let lines = 0;

        for (const seg of segments) {
            if (lines >= 2) break;

            if (seg.type === 'text') {
                const words = seg.content.split(/(\s+)/);
                for (const w of words) {
                    if (!w) continue;
                    const metrics = ctx.measureText(w);
                    if (cx + metrics.width > maxW && cx > pad + 12) {
                        lines++;
                        if (lines >= 2) break;
                        cx = pad + 12;
                        cy += lineH;
                        if (w.trim() === '') continue;
                    }
                    if (w.trim() !== '') {
                        ctx.fillText(w, cx, cy);
                    }
                    cx += metrics.width;
                }
            } else if (seg.type === 'emote') {
                const size = 52;
                if (cx + size > maxW && cx > pad + 12) {
                    lines++;
                    if (lines >= 2) break;
                    cx = pad + 12;
                    cy += lineH;
                }
                if (seg.img) {
                    ctx.drawImage(seg.img, cx, cy - 4, size, size);
                }
                cx += size + 8;
            }
        }

        tex.needsUpdate = true;
        if (onUpdate) onUpdate();
    }

    if (pendingImages === 0) draw();

    return tex;
}

export class ChatCharacter {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Vector3} position  — world position to place the character
     * @param {THREE.Vector3} normal    — surface normal (character stands along this)
     * @param {string} username
     * @param {string} message
     * @param {string} [twitchColor]  — hex color from Twitch IRC tag, e.g. '#FF0000'
     * @param {Array} [emotes]        — Twitch emotes array
     */
    constructor(scene, position, normal, username, message, twitchColor = '', emotes = []) {
        this._scene = scene;
        this._alive = true;
        this._elapsed = 0;
        this._meshes = [];
        this._username = username;
        this._emotes = emotes;
        this._username = username;

        const col = twitchColor
            ? parseInt(twitchColor.replace('#', ''), 16)  // use real Twitch color
            : colorForName(username);                     // fallback: hash palette
        const up = normal.clone();
        // Pass the resolved hex string to the bubble
        const resolvedHex = twitchColor || ('#' + col.toString(16).padStart(6, '0'));

        // ── Body ─────────────────────────────────────────────────────────
        const bodyGeo = new THREE.CylinderGeometry(BODY_RADIUS, BODY_RADIUS, BODY_HEIGHT, 8);
        const bodyMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.8 });
        this._body = new THREE.Mesh(bodyGeo, bodyMat);
        // Sit the cylinder on the surface
        this._body.position.copy(position).addScaledVector(up, BODY_HEIGHT / 2 + 0.02);
        // Align Y axis to surface normal
        this._body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
        this._body.castShadow = true;
        scene.add(this._body);
        this._meshes.push(this._body);

        // ── Head ─────────────────────────────────────────────────────────
        const headGeo = new THREE.SphereGeometry(HEAD_RADIUS, 10, 8);
        const headMat = new THREE.MeshStandardMaterial({ color: 0xffe0b2, roughness: 0.7 });
        this._head = new THREE.Mesh(headGeo, headMat);
        this._head.position.copy(this._body.position)
            .addScaledVector(up, BODY_HEIGHT / 2 + HEAD_RADIUS);
        this._head.castShadow = true;
        scene.add(this._head);
        this._meshes.push(this._head);

        // ── Speech bubble (Sprite – always faces camera) ──────────────────
        let needsHackUpdate = false;
        const tex = makeBubbleSprite(username, message, resolvedHex, emotes, () => {
            needsHackUpdate = true; // Triggers material re-render in update()
        });
        const sprMat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true });
        this._sprite = new THREE.Sprite(sprMat);
        this._wantsTexUpdate = () => { if (needsHackUpdate) { sprMat.needsUpdate = true; needsHackUpdate = false; } };
        // Position above head; scale to world units (canvas 512×256 → 2×1 world units)
        this._sprite.position.copy(this._head.position).addScaledVector(up, 2.2);
        this._sprite.scale.set(4.5, 2.25, 1);
        scene.add(this._sprite);

        // ── Subtle spawn animation ────────────────────────────────────────
        this._body.scale.setScalar(0.001);
        this._head.scale.setScalar(0.001);
        this._sprite.scale.setScalar(0.001);
        this._spawnPhase = true;
    }

    /** @param {number} dt */
    update(dt) {
        if (!this._alive) return false;

        this._wantsTexUpdate?.(); // apply newly loaded emote textures

        this._elapsed += dt;

        // Spawn spring animation (first 0.4s)
        if (this._spawnPhase) {
            const t = Math.min(this._elapsed / 0.4, 1);
            const s = t < 1 ? 1 + 0.3 * Math.sin(t * Math.PI) * (1 - t) : 1;
            this._body.scale.setScalar(s);
            this._head.scale.setScalar(s);
            this._sprite.scale.set(4.5 * s, 2.25 * s, 1);
            if (t >= 1) this._spawnPhase = false;
        }

        // Fade out during last 2 seconds
        const remaining = LIFETIME_S - this._elapsed;
        if (remaining < 2) {
            const alpha = Math.max(0, remaining / 2);
            this._body.material.opacity = alpha;
            this._body.material.transparent = true;
            this._head.material.opacity = alpha;
            this._head.material.transparent = true;
            this._sprite.material.opacity = alpha;
        }

        // Gentle bob (0.1 units) along surface normal
        const bob = Math.sin(this._elapsed * 1.8) * 0.05;
        const up = new THREE.Vector3().subVectors(this._body.position, this._body.position.clone().normalize().multiplyScalar(-1)).normalize();
        // Simpler bob: just move sprite Y slightly
        this._sprite.position.y += Math.sin(this._elapsed * 1.8) * 0.0008;

        if (this._elapsed >= LIFETIME_S) {
            this._alive = false;
            this.dispose();
            return false;
        }
        return true;
    }

    /**
     * Replace the speech bubble with a new message and reset the lifetime.
     * @param {string} message
     * @param {string} [twitchColor]
     * @param {Array} [emotes]
     */
    updateMessage(message, twitchColor = '', emotes = []) {
        this._emotes = emotes;
        // Rebuild the bubble texture with the same color logic as constructor
        const resolvedHex = twitchColor
            ? twitchColor
            : '#' + colorForName(this._username).toString(16).padStart(6, '0');
        let needsHackUpdate = false;
        const newTex = makeBubbleSprite(this._username, message, resolvedHex, emotes, () => {
            needsHackUpdate = true;
        });
        const oldTex = this._sprite.material.map;
        this._sprite.material.map = newTex;
        this._sprite.material.needsUpdate = true;
        this._wantsTexUpdate = () => { if (needsHackUpdate) { this._sprite.material.needsUpdate = true; needsHackUpdate = false; } };
        oldTex?.dispose();

        // Reset lifetime and fade
        this._elapsed = 0;
        this._alive = true;
        this._body.material.opacity = 1;
        this._body.material.transparent = false;
        this._head.material.opacity = 1;
        this._head.material.transparent = false;
        this._sprite.material.opacity = 1;
    }

    dispose() {
        for (const m of this._meshes) {
            this._scene.remove(m);
            m.geometry?.dispose();
            m.material?.dispose();
        }
        this._scene.remove(this._sprite);
        this._sprite.material.map?.dispose();
        this._sprite.material.dispose();
        this._meshes = [];
    }
}
