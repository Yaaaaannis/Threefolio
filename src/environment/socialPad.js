// socialPad.js — Sophisticated social media zone, Bruno Simon style.
//
// Visual design:
//   • Hexagonal pedestal (dark navy toon) with a glowing top cap
//   • Wireframe icosahedron slowly rotating above the pedestal — holographic decoration
//   • 3 floating portrait cards (GitHub / LinkedIn / X) in a wide arc
//     – Each card: canvas texture (glyph + grid pattern + label) + emissive brand glow
//     – Bob animation (staggered phases)
//     – Tilt toward player on approach
//   • Segmented ground ring (16 arcs) with animated opacity
//   • Proximity (< 8 u): cards illuminate, hologram spins faster
//   • Very close (< 2.5 u from a card): window.open() — fires once per session

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, uniform, float, sin, mix, smoothstep } from 'three/tsl';

const PC = new THREE.Vector3(0, -50, 0); // planet center

// ── Social entries — fill in your handles ──────────────────────────────────
const SOCIALS = [
    {
        label:    'GitHub',
        glyph:    'GH',
        bg:       0x0d1117,
        fg:       '#e6edf3',
        brand:    0x4078c8,
        url:      'https://github.com/yaaaannis',
    },
    {
        label:    'LinkedIn',
        glyph:    'in',
        bg:       0x00264d,
        fg:       '#ffffff',
        brand:    0x0a66c2,
        url:      'https://www.linkedin.com/in/yaaaannis',
    },
    {
        label:    'Twitter / X',
        glyph:    '𝕏',
        bg:       0x080808,
        fg:       '#f0f0f0',
        brand:    0x888888,
        url:      'https://x.com/yaaaannis_dev',
    },
];

// ── Canvas card texture ────────────────────────────────────────────────────
function makeCardTexture(glyph, label, bg, fg) {
    const W = 256, H = 320;
    const cv  = document.createElement('canvas');
    cv.width  = W;
    cv.height = H;
    const ctx = cv.getContext('2d');

    // Background fill
    ctx.fillStyle = `#${bg.toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, W, H);

    // Subtle grid — Bruno Simon signature detail
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth   = 1;
    for (let x = 0; x < W; x += 22) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += 22) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Corner dots
    const DOT = 4;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    [[DOT,DOT],[W-DOT,DOT],[DOT,H-DOT],[W-DOT,H-DOT]].forEach(([x,y]) => {
        ctx.beginPath(); ctx.arc(x, y, DOT, 0, Math.PI*2); ctx.fill();
    });

    // Brand glyph
    ctx.fillStyle   = fg;
    ctx.font        = `bold 88px Arial`;
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    // Subtle text shadow for depth
    ctx.shadowColor  = fg;
    ctx.shadowBlur   = 12;
    ctx.fillText(glyph, W / 2, H * 0.40);
    ctx.shadowBlur   = 0;

    // Thin divider
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(28, H * 0.67);
    ctx.lineTo(W - 28, H * 0.67);
    ctx.stroke();

    // Label
    ctx.font      = '500 26px Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.60)';
    ctx.fillText(label, W / 2, H * 0.82);

    return new THREE.CanvasTexture(cv);
}

// ── Segmented ring helper ──────────────────────────────────────────────────
function makeSegmentedRing(scene, pos, norm, radius, segments, color, meshList) {
    const ringQuat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1), norm
    );
    const arcs = [];
    const GAP  = 0.15; // radians of gap between segments
    const arc  = (Math.PI * 2 / segments) - GAP;

    for (let i = 0; i < segments; i++) {
        const start = i * (Math.PI * 2 / segments);
        const geo   = new THREE.RingGeometry(radius - 0.06, radius, 1, 1, start, arc);
        const mat   = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity:     0.35,
            side:        THREE.DoubleSide,
            depthWrite:  false,
        });
        const m = new THREE.Mesh(geo, mat);
        m.quaternion.copy(ringQuat);
        m.position.copy(pos).addScaledVector(norm, 0.04);
        m.renderOrder = 1;
        scene.add(m);
        meshList.push(m);
        arcs.push(mat);
    }
    return arcs; // array of materials for animation
}

// ──────────────────────────────────────────────────────────────────────────
export class SocialPad {
    /**
     * @param {THREE.Scene}       scene
     * @param {THREE.Vector3}     position   world position on sphere surface
     */
    constructor(scene, position) {
        this._scene    = scene;
        this._pos      = position.clone();
        this._time     = 0;
        this._active   = 0;   // lerped 0→1 when player is near
        this._meshes   = [];
        this._cards    = [];
        this._arcMats  = [];

        // Surface basis
        const norm  = position.clone().sub(PC).normalize();
        this._norm  = norm;
        const ref   = Math.abs(norm.y) < 0.9
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(1, 0, 0);
        this._tA    = new THREE.Vector3().crossVectors(norm, ref).normalize();
        this._tB    = new THREE.Vector3().crossVectors(norm, this._tA).normalize();

        this._build(scene, position, norm);
    }

    _build(scene, pos, norm) {
        const alignQuat = new THREE.Quaternion()
            .setFromUnitVectors(new THREE.Vector3(0, 1, 0), norm);

        // ── Pedestal ─────────────────────────────────────────────────────
        const baseGeo = new THREE.CylinderGeometry(0.55, 0.72, 0.18, 6);
        const stemGeo = new THREE.CylinderGeometry(0.22, 0.30, 1.10, 6);
        const capGeo  = new THREE.CylinderGeometry(0.50, 0.50, 0.10, 6);

        const darkMat  = new THREE.MeshToonMaterial({ color: 0x14162a });
        const accentMat = new THREE.MeshToonMaterial({ color: 0x2a2d4a });

        const base = new THREE.Mesh(baseGeo, darkMat);
        base.position.copy(pos).addScaledVector(norm, 0.09);
        base.quaternion.copy(alignQuat);
        base.castShadow = true;
        scene.add(base); this._meshes.push(base);

        const stem = new THREE.Mesh(stemGeo, darkMat);
        stem.position.copy(pos).addScaledVector(norm, 0.73);
        stem.quaternion.copy(alignQuat);
        stem.castShadow = true;
        scene.add(stem); this._meshes.push(stem);

        const cap = new THREE.Mesh(capGeo, accentMat);
        cap.position.copy(pos).addScaledVector(norm, 1.38);
        cap.quaternion.copy(alignQuat);
        scene.add(cap); this._meshes.push(cap);

        // Cap emissive glow node
        this._capGlowU = uniform(0.0);
        const capNodeMat = new MeshStandardNodeMaterial({ roughness: 0.3, metalness: 0.5 });
        capNodeMat.colorNode    = color(0x2a2d4a);
        capNodeMat.emissiveNode = color(0x4466ff).mul(this._capGlowU);
        cap.material = capNodeMat;

        // ── Holographic wireframe icosahedron ─────────────────────────────
        const holoGeo = new THREE.IcosahedronGeometry(0.45, 1);
        const holoMat = new MeshStandardNodeMaterial({
            wireframe:   true,
            transparent: true,
            depthWrite:  false,
        });
        this._holoGlowU = uniform(0.15);
        holoMat.colorNode    = color(0x88aaff);
        holoMat.emissiveNode = color(0x88aaff).mul(this._holoGlowU);
        holoMat.opacityNode  = this._holoGlowU.mul(float(1.8)).clamp(float(0), float(1));

        this._holo = new THREE.Mesh(holoGeo, holoMat);
        this._holo.position.copy(pos).addScaledVector(norm, 2.2);
        this._holoBasePos = this._holo.position.clone();
        scene.add(this._holo); this._meshes.push(this._holo);

        // ── Segmented ground ring ─────────────────────────────────────────
        this._arcMats = makeSegmentedRing(scene, pos, norm, 4.2, 16, 0x4466ff, this._meshes);

        // Inner ring (static, dimmer)
        makeSegmentedRing(scene, pos, norm, 1.4, 8, 0x8899ff, this._meshes);

        // ── Social cards ──────────────────────────────────────────────────
        // Fan arrangement: center card slightly higher, two flanking cards lower
        // spread along tA axis, all slightly offset along tB (toward player approach)
        const fanConfig = [
            { tA:  0.0,  height: 3.2, tB:  0.4 }, // center
            { tA: -2.0,  height: 2.5, tB:  0.0 }, // left
            { tA:  2.0,  height: 2.5, tB:  0.0 }, // right
        ];

        // Cards face toward the player's likely approach direction
        // We point them along -tB (back toward spawn roughly)
        const faceDir   = this._tB.clone().negate();
        const faceQuat  = new THREE.Quaternion()
            .setFromUnitVectors(new THREE.Vector3(0, 0, 1), faceDir);
        // Tilt slightly so they're legible even from a low angle on sphere surface
        const tiltQ = new THREE.Quaternion()
            .setFromAxisAngle(this._tA, 0.18); // 10° lean toward player
        faceQuat.premultiply(tiltQ);

        for (let i = 0; i < SOCIALS.length; i++) {
            const s      = SOCIALS[i];
            const cfg    = fanConfig[i];

            const basePos = pos.clone()
                .addScaledVector(norm,    cfg.height)
                .addScaledVector(this._tA, cfg.tA)
                .addScaledVector(this._tB, cfg.tB);

            // Canvas texture
            const tex = makeCardTexture(s.glyph, s.label, s.bg, s.fg);

            // Emissive uniform
            const emU = uniform(0.0);

            const mat = new MeshStandardNodeMaterial({ roughness: 0.25, metalness: 0.05 });
            mat.map          = tex;
            mat.emissiveNode = color(s.brand).mul(emU.mul(float(1.5)));

            const geo  = new THREE.BoxGeometry(1.1, 1.4, 0.07);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(basePos);
            mesh.quaternion.copy(faceQuat);
            mesh.castShadow = true;
            scene.add(mesh);
            this._meshes.push(mesh);

            // Thin emissive border plane behind the card
            const borderGeo = new THREE.BoxGeometry(1.18, 1.48, 0.01);
            const borderMat = new MeshStandardNodeMaterial({ transparent: true, depthWrite: false });
            borderMat.colorNode    = color(s.brand);
            borderMat.emissiveNode = color(s.brand).mul(emU.mul(float(0.8)));
            borderMat.opacityNode  = emU.mul(float(0.6));
            const border = new THREE.Mesh(borderGeo, borderMat);
            border.position.copy(basePos).addScaledVector(faceDir, -0.05);
            border.quaternion.copy(faceQuat);
            border.renderOrder = 1;
            scene.add(border);
            this._meshes.push(border);

            this._cards.push({
                mesh,
                border,
                emU,
                bobPhase:  (i / SOCIALS.length) * Math.PI * 2,
                basePos:   basePos.clone(),
                baseQuat:  faceQuat.clone(),
                social:    s,
                _opened:   false,
            });
        }
    }

    update(dt, playerPos) {
        if (!playerPos) return;
        this._time += dt;
        const t = this._time;

        // ── Proximity ────────────────────────────────────────────────────
        const dist   = playerPos.distanceTo(this._pos);
        const target = dist < 8.0 ? 1.0 : 0.0;
        this._active += (target - this._active) * Math.min(1, dt * 3.5);

        // ── Ground ring pulse ─────────────────────────────────────────────
        const ringBase = 0.15 + this._active * 0.30;
        for (let i = 0; i < this._arcMats.length; i++) {
            // Each segment pulses with a small phase offset → rotating chase effect
            const phase = (i / this._arcMats.length) * Math.PI * 2;
            this._arcMats[i].opacity = ringBase + 0.12 * Math.sin(t * 3.0 + phase);
        }

        // ── Holographic decoration ────────────────────────────────────────
        const spinSpeed = 0.4 + this._active * 1.2;
        this._holo.rotation.y += dt * spinSpeed;
        this._holo.rotation.x += dt * spinSpeed * 0.6;
        // Bob
        const holoBob = Math.sin(t * 1.4) * 0.08;
        this._holo.position.copy(this._holoBasePos).addScaledVector(this._norm, holoBob);
        // Glow intensity
        this._holoGlowU.value += (0.12 + this._active * 0.55 - this._holoGlowU.value) * Math.min(1, dt * 4);
        this._capGlowU.value  += (this._active * 0.9 - this._capGlowU.value) * Math.min(1, dt * 4);

        // ── Cards ─────────────────────────────────────────────────────────
        for (let i = 0; i < this._cards.length; i++) {
            const card = this._cards[i];

            // Bob along surface normal
            const bob = Math.sin(t * 1.15 + card.bobPhase) * 0.13;
            const newPos = card.basePos.clone().addScaledVector(this._norm, bob);
            card.mesh.position.copy(newPos);

            // Border follows card
            const faceDir = new THREE.Vector3(0, 0, 1).applyQuaternion(card.baseQuat);
            card.border.position.copy(newPos).addScaledVector(faceDir, -0.05);

            // On approach: cards slowly tilt to face the player
            if (this._active > 0.02) {
                const toPlayer = playerPos.clone().sub(newPos);
                const projected = toPlayer
                    .clone()
                    .addScaledVector(this._norm, -toPlayer.dot(this._norm))
                    .normalize();
                const lookQuat = new THREE.Quaternion()
                    .setFromUnitVectors(new THREE.Vector3(0, 0, 1), projected);
                card.mesh.quaternion.slerpQuaternions(
                    card.baseQuat, lookQuat, this._active * 0.55
                );
                card.border.quaternion.copy(card.mesh.quaternion);
            } else {
                card.mesh.quaternion.copy(card.baseQuat);
                card.border.quaternion.copy(card.baseQuat);
            }

            // Emissive glow — slightly staggered wave per card
            const glowWave = 0.25 + 0.12 * Math.sin(t * 2.8 + card.bobPhase);
            const glowTarget = this._active * glowWave;
            card.emU.value += (glowTarget - card.emU.value) * Math.min(1, dt * 5);

            // Link trigger — only when very close to a specific card
            if (!card._opened) {
                const cardDist = playerPos.distanceTo(card.mesh.position);
                if (cardDist < 2.5) {
                    card._opened = true;
                    window.open(card.social.url, '_blank');
                }
            }
        }
    }

    dispose() {
        for (const m of this._meshes) {
            this._scene.remove(m);
            m.geometry?.dispose();
            if (Array.isArray(m.material)) {
                m.material.forEach(mat => mat.dispose());
            } else {
                m.material?.dispose();
            }
        }
        this._meshes = [];
        this._cards  = [];
        this._arcMats = [];
    }
}
