import * as THREE from 'three';

export class FollowerSphere {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Vector3} position
     */
    constructor(scene, position) {
        // Fixed orbit position: 10 units above the planet top
        this.orbitBase = new THREE.Vector3(-8, 5, -8);
        this.mesh = new THREE.Group();
        this.mesh.position.copy(this.orbitBase);

        // Main body (Sphere)
        const bodyGeo = new THREE.SphereGeometry(0.8, 32, 32);
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0xabcdef, roughness: 0.4 });
        this.body = new THREE.Mesh(bodyGeo, bodyMat);
        this.body.castShadow = true;
        this.body.receiveShadow = true;
        this.mesh.add(this.body);

        const eyeGeo = new THREE.SphereGeometry(0.2, 16, 16);
        const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1 });

        const pupilGeo = new THREE.SphereGeometry(0.08, 16, 16);
        const pupilMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1 });

        // Left Eye (Z positive will face the player when the object is rotated to look at the player)
        this.leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        this.leftEye.position.set(-0.35, 0.2, 0.7);
        this.leftPupil = new THREE.Mesh(pupilGeo, pupilMat);
        this.leftPupil.position.set(0, 0, 0.16);
        this.leftEye.add(this.leftPupil);
        this.mesh.add(this.leftEye);

        // Right Eye
        this.rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        this.rightEye.position.set(0.35, 0.2, 0.7);
        this.rightPupil = new THREE.Mesh(pupilGeo, pupilMat);
        this.rightPupil.position.set(0, 0, 0.16);
        this.rightEye.add(this.rightPupil);
        this.mesh.add(this.rightEye);

        this.mesh.scale.setScalar(2);
        scene.add(this.mesh);
    }

    /**
     * @param {number} time
     * @param {THREE.Vector3} playerPos
     * @param {number} dt
     */
    update(time, playerPos, dt) {
        if (!playerPos) return;

        const EYE_LIMIT = Math.PI / 4;  // 45° — eyes can track alone
        const HEAD_START = Math.PI * 0.15; // ~100° — head starts following
        const MAX_PUPIL = 0.10;          // max pupil displacement in socket

        // Hover oscillation
        this.mesh.position.y = this.orbitBase.y + Math.sin(time * 1.5) * 1.2;

        // Direction from head to player (world space)
        const toPlayer = new THREE.Vector3()
            .subVectors(playerPos, this.mesh.position)
            .normalize();

        // Head forward in world space
        const headForward = new THREE.Vector3(0, 0, 1)
            .applyQuaternion(this.mesh.quaternion);

        const dot = Math.min(1, Math.max(-1, headForward.dot(toPlayer)));
        const angle = Math.acos(dot);

        // ── Head rotation: only triggers when player is really off-center ──
        if (angle > HEAD_START) {
            const dummy = new THREE.Object3D();
            dummy.position.copy(this.mesh.position);
            dummy.lookAt(playerPos);
            // Slow head follow — natural catch-up
            this.mesh.quaternion.slerp(dummy.quaternion, 1.2 * dt);
        }

        // ── Pupil movement: project player dir into head local XY ──────────
        // toPlayerLocal.x = right/left, .y = up/down, .z = forward/back
        const invQuat = this.mesh.quaternion.clone().invert();
        const toPlayerLocal = toPlayer.clone().applyQuaternion(invQuat);

        // x/y components of a normalized vector are in [-1, 1]
        // Scale linearly up to MAX_PUPIL — feel = eye rolling in socket
        // Clamp to a circle
        let px = toPlayerLocal.x;
        let py = toPlayerLocal.y;
        const circleLen = Math.sqrt(px * px + py * py);
        if (circleLen > 1) { px /= circleLen; py /= circleLen; }

        const targetPX = px * MAX_PUPIL;
        const targetPY = py * MAX_PUPIL;

        // Smooth pupil motion
        const speed = 8 * dt;
        this.leftPupil.position.x += (targetPX - this.leftPupil.position.x) * speed;
        this.leftPupil.position.y += (targetPY - this.leftPupil.position.y) * speed;
        this.rightPupil.position.x += (targetPX - this.rightPupil.position.x) * speed;
        this.rightPupil.position.y += (targetPY - this.rightPupil.position.y) * speed;
    }
}
