// portalZone.js — A glowing ring on the sphere surface that triggers world travel.
// Place it anywhere on a sphere; it aligns itself on the surface normal.

import * as THREE from 'three';

export class PortalZone {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Vector3} planetCenter
     * @param {THREE.Vector3} surfacePoint  — point on the planet surface where the ring appears
     * @param {string}        label         — world name shown above the ring
     * @param {number}        color         — hex ring color
     * @param {function}      onTravel      — callback when player triggers the portal
     */
    constructor(scene, planetCenter, surfacePoint, label, ringColor, onTravel) {
        this.scene = scene;
        this.center = surfacePoint.clone();
        this.radius = 2.2;
        this.onTravel = onTravel;
        this.isPlayerIn = false;
        this._consumed = false;

        const normal = new THREE.Vector3().subVectors(surfacePoint, planetCenter).normalize();

        // ── Ring mesh ─────────────────────────────────────────────────────
        const ringGeo = new THREE.RingGeometry(this.radius - 0.25, this.radius, 48);
        this.ringMat = new THREE.MeshStandardMaterial({
            color: ringColor,
            emissive: new THREE.Color(ringColor),
            emissiveIntensity: 0.4,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
        });
        const ringMesh = new THREE.Mesh(ringGeo, this.ringMat);

        // Align ring plane to surface normal
        const upAxis = new THREE.Vector3(0, 0, 1); // RingGeometry faces +Z by default
        ringMesh.quaternion.setFromUnitVectors(upAxis, normal);

        // Lift slightly off surface to avoid z-fighting
        ringMesh.position.copy(surfacePoint).addScaledVector(normal, 0.08);
        scene.add(ringMesh);
        this._ringMesh = ringMesh;

        // ── Floating label ────────────────────────────────────────────────
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.clearRect(0, 0, 512, 128);
        ctx.font = 'bold 56px Arial';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = `#${ringColor.toString(16).padStart(6, '0')}`;
        ctx.shadowBlur = 18;
        ctx.fillText(label, 256, 80);
        const labelTex = new THREE.CanvasTexture(canvas);
        const labelGeo = new THREE.PlaneGeometry(4, 1);
        const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, depthWrite: false });
        this._label = new THREE.Mesh(labelGeo, labelMat);
        this._label.position.copy(surfacePoint).addScaledVector(normal, 2.5);
        this._label.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        scene.add(this._label);

        // ── Hint text below label ─────────────────────────────────────────
        this._hint = this._makeHint('[ ENTER ]', ringColor, surfacePoint, normal, 1.5);

        // ── Input ─────────────────────────────────────────────────────────
        this._keyDown = (e) => { if (e.code === 'Enter' && this.isPlayerIn && !this._consumed) { this._consumed = true; this.onTravel(); } };
        this._keyUp = (e) => { if (e.code === 'Enter') this._consumed = false; };
        window.addEventListener('keydown', this._keyDown);
        window.addEventListener('keyup', this._keyUp);
    }

    _makeHint(text, ringColor, surfacePoint, normal, heightAbove) {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 256, 64);
        ctx.font = '28px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = `#${ringColor.toString(16).padStart(6, '0')}`;
        ctx.fillText(text, 128, 44);
        const tex = new THREE.CanvasTexture(canvas);
        const geo = new THREE.PlaneGeometry(2, 0.5);
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(surfacePoint).addScaledVector(normal, heightAbove);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        this.scene.add(mesh);
        return mesh;
    }

    /** Call each frame with the player's world position and current time. */
    update(playerPos, time) {
        const dist = playerPos.distanceTo(this.center);
        const inside = dist < this.radius;

        if (inside !== this.isPlayerIn) {
            this.isPlayerIn = inside;
            if (!inside) this._consumed = false;
        }

        // Glow pulse when active
        const pulse = inside
            ? 0.6 + Math.sin(time * 6) * 0.4
            : 0.4;
        this.ringMat.emissiveIntensity = pulse;
        this.ringMat.opacity = inside ? 1.0 : 0.85;

        // Pulse the label opacity
        this._label.material.opacity = inside ? 1 : 0.6 + Math.sin(time * 2) * 0.15;
        this._hint.material.opacity = inside ? 1 : 0.3;
    }

    dispose() {
        window.removeEventListener('keydown', this._keyDown);
        window.removeEventListener('keyup', this._keyUp);
        for (const obj of [this._ringMesh, this._label, this._hint]) {
            this.scene.remove(obj);
            obj.geometry?.dispose();
            obj.material?.dispose();
        }
    }
}
