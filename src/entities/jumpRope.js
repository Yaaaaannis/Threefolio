// jumpRope.js — Skip rope zone with animated rope and jump counter
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { time, uv, sin, float, texture as texNode, vec4 } from 'three/tsl';

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

        // Portal model state
        this._portalRoot  = null;
        this._screenMesh  = null;

        this._meshes = [];
        this._buildPosts();
        this._buildRope();
        this._buildZoneRing();
        this._buildPortalDisplay();
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

    _buildPortalDisplay() {
        // Canvas texture for score rendering
        this._canvas      = document.createElement('canvas');
        this._canvas.width  = 512;
        this._canvas.height = 256;
        this._ctx          = this._canvas.getContext('2d');
        this._scoreTex     = new THREE.CanvasTexture(this._canvas);
        this._drawScore();

        // Load portal model
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

        const loader = new GLTFLoader();
        loader.setDRACOLoader(dracoLoader);

        loader.load('/models/portaltest3.glb', (gltf) => {
            this._portalRoot = gltf.scene;

            // Position: offset along _tB (perpendicular to rope span) + up
            const displayPos = this._pos.clone()
                .addScaledVector(this._tB, ROPE_HALF_SPAN + 2.5)
                .addScaledVector(this._normal, 0.0);

            this._portalRoot.position.copy(displayPos);

            // Align model up-axis with planet normal, then rotate 90° around it
            const rotY90 = new THREE.Quaternion().setFromAxisAngle(this._normal, Math.PI / 2);
            this._portalRoot.quaternion.copy(this._qY).premultiply(rotY90);

            this._portalRoot.scale.setScalar(0.55 * 3);

            this._scene.add(this._portalRoot);

            // Find the screnn mesh and apply hologram material
            this._portalRoot.traverse((child) => {
                if (child.isMesh && child.name === 'screnn') {
                    this._screenMesh = child;
                    this._applyHologramMaterial(child);
                }
            });
        });
    }

    _applyHologramMaterial(mesh) {
        const mat = new MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        // Canvas texture node
        const canvasTex = texNode(this._scoreTex);

        // Animated scanlines: bright bands scrolling upward
        const scanlineY  = uv().y.mul(float(40.0)).sub(time.mul(float(2.5)));
        const scanline   = sin(scanlineY).mul(float(0.5)).add(float(0.5));  // 0..1
        const scanBright = scanline.mul(float(0.18)).add(float(0.82));       // subtle 0.82..1.0

        // Horizontal edge fade (vignette along X): x*(1-x)*4
        const uvX       = uv().x;
        const edgeFadeX = uvX.mul(float(1.0).sub(uvX)).mul(float(4.0)).clamp(float(0.0), float(1.0));

        // Sample canvas
        const col = canvasTex;

        // Combine: canvas color * scanline brightness, alpha from canvas * edge fade
        const finalColor = col.rgb.mul(scanBright);
        const finalAlpha = col.a.mul(edgeFadeX).mul(float(0.95));

        mat.colorNode  = vec4(finalColor, finalAlpha);

        mesh.material = mat;
        mesh.material.needsUpdate = true;
    }

    // ── Canvas score display ──────────────────────────────────────────────

    _drawScore(flash = null) {
        const ctx = this._ctx;
        const W = 512, H = 256;
        ctx.clearRect(0, 0, W, H);

        // Flip vertically so the texture appears right-side up on the screnn mesh
        ctx.save();
        ctx.translate(0, H);
        ctx.scale(1, -1);

        // Dark hologram background
        const bg = flash === 'hit'    ? 'rgba(60,5,5,0.85)'
            : flash === 'ok'          ? 'rgba(5,40,20,0.85)'
            : flash === 'faster'      ? 'rgba(40,25,0,0.85)'
            :                           'rgba(0,8,20,0.82)';
        ctx.fillStyle = bg;
        this._rrect(ctx, 6, 6, W - 12, H - 12, 14);
        ctx.fill();

        // Border glow
        ctx.strokeStyle = flash === 'hit'    ? '#ff3333'
            : flash === 'ok'                 ? '#33ff88'
            : flash === 'faster'             ? '#ffaa00'
            :                                  '#E7B500';
        ctx.lineWidth = 3;
        this._rrect(ctx, 6, 6, W - 12, H - 12, 14);
        ctx.stroke();

        // Title label
        ctx.fillStyle = 'rgba(231,181,0,0.55)';
        ctx.font = 'bold 20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('SAUTS', W / 2, 40);

        // Separator
        ctx.strokeStyle = 'rgba(231,181,0,0.25)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(24, 52); ctx.lineTo(W - 24, 52);
        ctx.stroke();

        // Score number — large yellow digital style
        const scoreColor = flash === 'hit'    ? '#ff5555'
            : flash === 'faster'              ? '#ffaa33'
            :                                   '#E7B500';
        ctx.fillStyle = scoreColor;
        const fontSize = this._score > 999 ? 100 : this._score > 99 ? 120 : 148;
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.fillText(this._score.toString(), W / 2, 185);

        // Flash message
        if (flash === 'hit') {
            ctx.fillStyle = '#ff6666';
            ctx.font = 'bold 24px monospace';
            ctx.fillText('RATÉ !', W / 2, 230);
        } else if (flash === 'faster') {
            ctx.fillStyle = '#ffaa44';
            ctx.font = 'bold 22px monospace';
            ctx.fillText('PLUS VITE !  ⚡', W / 2, 230);
        } else if (flash === 'ok') {
            ctx.fillStyle = '#44ffaa';
            ctx.font = 'bold 24px monospace';
            ctx.fillText('SUPER !', W / 2, 230);
        } else {
            ctx.fillStyle = 'rgba(231,181,0,0.40)';
            ctx.font = '18px monospace';
            const tier = Math.floor((this._ropeSpeed - ROPE_SPEED_BASE) / ROPE_SPEED_STEP);
            const label = tier > 0 ? `vitesse  x${tier + 1}` : 'sauts consécutifs';
            ctx.fillText(label, W / 2, 232);
        }

        ctx.restore();
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

        // Portal model
        if (this._portalRoot) {
            this._scene.remove(this._portalRoot);
            this._portalRoot.traverse((child) => {
                if (child.isMesh) {
                    child.geometry?.dispose();
                    if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                    else child.material?.dispose();
                }
            });
            this._portalRoot = null;
        }

        // Canvas texture
        this._scoreTex?.dispose();
    }
}
