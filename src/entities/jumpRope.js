// jumpRope.js — Skip rope zone with animated rope and jump counter
import * as THREE from 'three';

const ROPE_SPEED_BASE  = 0.85;  // revolutions/second at start
const ROPE_SPEED_STEP  = 0.08;  // added every SPEED_MILESTONE jumps
const SPEED_MILESTONE  = 15;    // jumps between each speed bump
const ROPE_SPEED_MAX   = 2.2;   // hard cap
const ROPE_HALF_SPAN = 2.5;    // centre → post distance (total span 5 m)
const POST_HEIGHT    = 2.0;    // rope attachment height above surface
const ARC_RADIUS     = 2.0;    // rope arc amplitude (= POST_HEIGHT → touches ground at bottom)
const ZONE_RADIUS    = 1.8;    // player must be within this radius to be "in game"
const DANGER_H       = 0.9;    // rope-bottom height threshold — must exceed player standing height (~0.5)
const TUBE_SEGS      = 24;
const TUBE_R         = 0.055;

export class JumpRope {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Vector3} position
     */
    constructor(scene, position) {
        this._scene = scene;

        // Project the requested position onto the planet surface so the rope
        // base sits exactly at ground level (rope bottom touches the surface at angle=0).
        const PC     = new THREE.Vector3(0, -50, 0);
        const PLANET_R = 50;
        const surfDir  = new THREE.Vector3().subVectors(position, PC).normalize();
        this._pos = PC.clone().addScaledVector(surfDir, PLANET_R);

        // Planet alignment
        this._normal = surfDir.clone();

        const ref = Math.abs(this._normal.y) < 0.9
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(1, 0, 0);
        this._tA = new THREE.Vector3().crossVectors(this._normal, ref).normalize();
        this._tB = new THREE.Vector3().crossVectors(this._normal, this._tA).normalize();

        this._qY = new THREE.Quaternion()
            .setFromUnitVectors(new THREE.Vector3(0, 1, 0), this._normal);
        this._qZ = new THREE.Quaternion()
            .setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._normal);

        // State
        this._angle       = 0;
        this._score       = 0;
        this._ropeSpeed   = ROPE_SPEED_BASE;
        this._wasInDanger = false;
        this._flashTimer  = 0;
        this._flashType   = null;

        this._meshes = [];
        this._buildPosts();
        this._buildRope();
        this._buildZoneRing();
        this._buildScoreDisplay();
    }

    // ── Scene construction ────────────────────────────────────────────────

    _buildPosts() {
        const postMat = new THREE.MeshToonMaterial({ color: 0x774422 });
        const knobMat = new THREE.MeshToonMaterial({ color: 0x553311 });
        const postGeo = new THREE.CylinderGeometry(0.1, 0.13, POST_HEIGHT, 8);
        const knobGeo = new THREE.SphereGeometry(0.16, 8, 6);

        for (const side of [-1, 1]) {
            // Post body
            const postCenter = this._pos.clone()
                .addScaledVector(this._tA, side * ROPE_HALF_SPAN)
                .addScaledVector(this._normal, POST_HEIGHT / 2);
            const post = new THREE.Mesh(postGeo, postMat);
            post.position.copy(postCenter);
            post.quaternion.copy(this._qY);
            this._scene.add(post);
            this._meshes.push(post);

            // Knob at top
            const knob = new THREE.Mesh(knobGeo, knobMat);
            knob.position.copy(this._pos)
                .addScaledVector(this._tA, side * ROPE_HALF_SPAN)
                .addScaledVector(this._normal, POST_HEIGHT);
            this._scene.add(knob);
            this._meshes.push(knob);
        }
    }

    _buildRope() {
        const ropeMat = new THREE.MeshToonMaterial({ color: 0xdd2200 });
        const curve   = new THREE.CatmullRomCurve3(this._ropePoints(0));
        this._ropeMesh = new THREE.Mesh(
            new THREE.TubeGeometry(curve, TUBE_SEGS, TUBE_R, 6, false),
            ropeMat
        );
        this._scene.add(this._ropeMesh);
    }

    _buildZoneRing() {
        this._zoneRing = new THREE.Mesh(
            new THREE.TorusGeometry(ZONE_RADIUS, 0.06, 4, 48),
            new THREE.MeshToonMaterial({ color: 0xffcc00, transparent: true, opacity: 0.3 })
        );
        this._zoneRing.position.copy(this._pos);
        this._zoneRing.quaternion.copy(this._qZ);
        this._scene.add(this._zoneRing);
        this._meshes.push(this._zoneRing);
    }

    _buildScoreDisplay() {
        this._canvas      = document.createElement('canvas');
        this._canvas.width  = 256;
        this._canvas.height = 256;
        this._ctx          = this._canvas.getContext('2d');
        this._scoreTex     = new THREE.CanvasTexture(this._canvas);

        // Sprite = auto-billboard toward camera
        this._scoreSprite = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: this._scoreTex, transparent: true })
        );
        this._scoreSprite.scale.set(3.5, 3.5, 1);
        this._scoreSprite.position.copy(this._pos)
            .addScaledVector(this._tB, ROPE_HALF_SPAN + 2.0)
            .addScaledVector(this._normal, 3.5);
        this._scene.add(this._scoreSprite);
        this._drawScore();
    }

    // ── Canvas score display ──────────────────────────────────────────────

    _drawScore(flash = null) {
        const ctx = this._ctx;
        const W = 256, H = 256;
        ctx.clearRect(0, 0, W, H);

        // Background
        const bg = flash === 'hit'    ? 'rgba(100,15,15,0.93)'
            : flash === 'ok'          ? 'rgba(15,90,35,0.93)'
            : flash === 'faster'      ? 'rgba(80,50,0,0.93)'
            :                           'rgba(12,12,22,0.90)';
        ctx.fillStyle = bg;
        this._rrect(ctx, 6, 6, W - 12, H - 12, 18);
        ctx.fill();

        // Border
        ctx.strokeStyle = flash === 'hit'    ? '#ff4444'
            : flash === 'ok'                 ? '#44ff88'
            : flash === 'faster'             ? '#ffaa00'
            :                                  '#ffcc00';
        ctx.lineWidth = 4;
        this._rrect(ctx, 6, 6, W - 12, H - 12, 18);
        ctx.stroke();

        // Title
        ctx.fillStyle = '#aaaacc';
        ctx.font = 'bold 21px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('CORDE À SAUTER', W / 2, 46);

        // Separator line
        ctx.strokeStyle = '#333344';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(20, 58); ctx.lineTo(W - 20, 58);
        ctx.stroke();

        // Score number
        ctx.fillStyle = flash === 'hit' ? '#ff6666' : flash === 'faster' ? '#ffaa44' : '#ffee44';
        const fontSize = this._score > 99 ? 80 : 96;
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.fillText(this._score.toString(), W / 2, 172);

        // Flash message / speed indicator
        if (flash === 'hit') {
            ctx.fillStyle = '#ff8888';
            ctx.font = 'bold 26px sans-serif';
            ctx.fillText('RATÉ !', W / 2, 212);
        } else if (flash === 'faster') {
            ctx.fillStyle = '#ffaa44';
            ctx.font = 'bold 24px sans-serif';
            ctx.fillText('PLUS VITE ! ⚡', W / 2, 212);
        } else if (flash === 'ok') {
            ctx.fillStyle = '#88ffaa';
            ctx.font = 'bold 26px sans-serif';
            ctx.fillText('SUPER !', W / 2, 212);
        } else {
            ctx.fillStyle = '#666677';
            ctx.font = '19px sans-serif';
            // Show current speed tier when idle
            const tier = Math.floor((this._ropeSpeed - ROPE_SPEED_BASE) / ROPE_SPEED_STEP);
            const label = tier > 0 ? `vitesse x${tier + 1}` : 'sauts consécutifs';
            ctx.fillText(label, W / 2, 218);
        }

        this._scoreTex.needsUpdate = true;
    }

    _rrect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);   ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);   ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);       ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    }

    // ── Rope geometry ────────────────────────────────────────────────────

    _ropePoints(angle) {
        const N = 14;
        const pts = [];
        for (let i = 0; i < N; i++) {
            const t    = i / (N - 1);
            const sinT = Math.sin(Math.PI * t);
            const x    = -ROPE_HALF_SPAN + t * ROPE_HALF_SPAN * 2;
            // Endpoints (t=0,t=1) stay fixed at post tops; centre swings
            const y    = POST_HEIGHT - sinT * ARC_RADIUS * Math.cos(angle);
            const z    = sinT * ARC_RADIUS * Math.sin(angle);
            pts.push(
                this._pos.clone()
                    .addScaledVector(this._tA, x)
                    .addScaledVector(this._normal, y)
                    .addScaledVector(this._tB, z)
            );
        }
        return pts;
    }

    // ── Update ────────────────────────────────────────────────────────────

    update(dt, player) {
        if (!player) return;

        // Advance rope (speed scales with milestone)
        this._angle = (this._angle + this._ropeSpeed * Math.PI * 2 * dt) % (Math.PI * 2);

        // Rebuild rope tube geometry
        const oldGeo = this._ropeMesh.geometry;
        this._ropeMesh.geometry = new THREE.TubeGeometry(
            new THREE.CatmullRomCurve3(this._ropePoints(this._angle)),
            TUBE_SEGS, TUBE_R, 6, false
        );
        oldGeo.dispose();

        // Zone ring opacity pulses with the rope cycle
        this._zoneRing.material.opacity = 0.15 + 0.2 * Math.abs(Math.sin(this._angle * 2));

        // Flash timer
        if (this._flashTimer > 0) {
            this._flashTimer -= dt;
            if (this._flashTimer <= 0) {
                this._flashType = null;
                this._drawScore();
            }
        }

        // ── Player detection ───────────────────────────────────────────────
        const t    = player.rigidBody.translation();
        const pPos = new THREE.Vector3(t.x, t.y, t.z);
        const diff  = new THREE.Vector3().subVectors(pPos, this._pos);
        const heightAbove = diff.dot(this._normal);
        const lateral = diff.clone()
            .sub(this._normal.clone().multiplyScalar(heightAbove))
            .length();

        const isInZone = lateral < ZONE_RADIUS;

        // Rope bottom height above surface (0 = touching ground, 4 = above head)
        const ropeBottomH = POST_HEIGHT - ARC_RADIUS * Math.cos(this._angle);
        const inDanger    = ropeBottomH < DANGER_H;

        if (isInZone && inDanger && !this._wasInDanger) {
            const jumped = !player._onGround;

            if (jumped) {
                this._score++;
                // Every SPEED_MILESTONE consecutive jumps → speed bump
                if (this._score % SPEED_MILESTONE === 0) {
                    this._ropeSpeed = Math.min(
                        this._ropeSpeed + ROPE_SPEED_STEP,
                        ROPE_SPEED_MAX
                    );
                    this._setFlash('faster');
                } else {
                    this._setFlash('ok');
                }
            } else {
                this._score = 0;
                this._ropeSpeed = ROPE_SPEED_BASE;  // reset speed on miss
                this._setFlash('hit');
            }
        }

        this._wasInDanger = inDanger;
    }

    _setFlash(type) {
        this._flashType  = type;
        this._flashTimer = 0.5;
        this._drawScore(type);
    }

    // ── Dispose ───────────────────────────────────────────────────────────

    dispose() {
        for (const m of this._meshes) {
            this._scene.remove(m);
            m.geometry?.dispose();
            if (Array.isArray(m.material)) m.material.forEach(x => x.dispose());
            else m.material?.dispose();
        }
        this._scene.remove(this._ropeMesh);
        this._ropeMesh.geometry?.dispose();
        this._ropeMesh.material?.dispose();
        this._scene.remove(this._scoreSprite);
        this._scoreSprite.material?.map?.dispose();
        this._scoreSprite.material?.dispose();
    }
}
