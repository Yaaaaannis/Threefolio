// jumpRope.js — Decorative skip rope with animated rope geometry.
import * as THREE from 'three';

const ROPE_SPEED_BASE  = 0.85;  // revolutions/second
const ROPE_HALF_SPAN = 2.5;    // centre → post distance
const POST_HEIGHT    = 2.0;    // rope attachment height
const ARC_RADIUS     = 2.0;    // rope arc amplitude
const ZONE_RADIUS    = 1.8;    // player must be within this radius
const DANGER_H       = 0.9;    // rope-bottom height threshold
const TUBE_SEGS      = 24;
const TUBE_R         = 0.055;

export class JumpRope {
    constructor(scene, position, options = {}) {
        this._scene = scene;
        this._onJumpSuccess = options.onJumpSuccess || null;
        this._onJumpFail    = options.onJumpFail    || null;
        this._wasInDanger = false;

        // Planet alignment
        const PC     = new THREE.Vector3(0, -50, 0);
        const PLANET_R = 50;
        const surfDir  = new THREE.Vector3().subVectors(position, PC).normalize();
        this._pos = PC.clone().addScaledVector(surfDir, PLANET_R);
        this._normal = surfDir.clone();

        const ref = Math.abs(this._normal.y) < 0.9
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(1, 0, 0);
        this._tA = new THREE.Vector3().crossVectors(this._normal, ref).normalize();
        this._tB = new THREE.Vector3().crossVectors(this._normal, this._tA).normalize();

        this._qY = new THREE.Quaternion()
            .setFromUnitVectors(new THREE.Vector3(0, 1, 0), this._normal);

        // State
        this._angle = 0;
        this._ropeSpeed = ROPE_SPEED_BASE;

        this._meshes = [];
        this._buildPosts();
        this._buildRope();
    }

    _buildPosts() {
        const postMat = new THREE.MeshToonMaterial({ color: 0x774422 });
        const knobMat = new THREE.MeshToonMaterial({ color: 0x553311 });
        const postGeo = new THREE.CylinderGeometry(0.1, 0.13, POST_HEIGHT, 8);
        const knobGeo = new THREE.SphereGeometry(0.16, 8, 6);

        for (const side of [-1, 1]) {
            const postCenter = this._pos.clone()
                .addScaledVector(this._tA, side * ROPE_HALF_SPAN)
                .addScaledVector(this._normal, POST_HEIGHT / 2);
            const post = new THREE.Mesh(postGeo, postMat);
            post.position.copy(postCenter);
            post.quaternion.copy(this._qY);
            this._scene.add(post);
            this._meshes.push(post);

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

    _ropePoints(angle) {
        const N = 14;
        const pts = [];
        for (let i = 0; i < N; i++) {
            const t    = i / (N - 1);
            const sinT = Math.sin(Math.PI * t);
            const x    = -ROPE_HALF_SPAN + t * ROPE_HALF_SPAN * 2;
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

    update(dt, player) {
        // Advance rope
        this._angle = (this._angle + this._ropeSpeed * Math.PI * 2 * dt) % (Math.PI * 2);

        // Rebuild rope tube geometry
        const oldGeo = this._ropeMesh.geometry;
        this._ropeMesh.geometry = new THREE.TubeGeometry(
            new THREE.CatmullRomCurve3(this._ropePoints(this._angle)),
            TUBE_SEGS, TUBE_R, 6, false
        );
        oldGeo.dispose();

        // ── Player detection ───────────────────────────────────────────────
        if (!player) return;
        const t    = player.rigidBody.translation();
        const pPos = new THREE.Vector3(t.x, t.y, t.z);
        const diff  = new THREE.Vector3().subVectors(pPos, this._pos);
        const heightAbove = diff.dot(this._normal);
        const lateral = diff.clone()
            .sub(this._normal.clone().multiplyScalar(heightAbove))
            .length();

        const isInZone = lateral < ZONE_RADIUS;

        // Rope bottom height above surface
        const ropeBottomH = POST_HEIGHT - ARC_RADIUS * Math.cos(this._angle);
        const inDanger    = ropeBottomH < DANGER_H;

        if (isInZone && inDanger && !this._wasInDanger) {
            const jumped = !player._onGround;
            if (jumped) {
                this._onJumpSuccess?.();
            } else {
                this._onJumpFail?.();
            }
        }

        this._wasInDanger = inDanger;
    }

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
    }
}

