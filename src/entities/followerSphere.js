import * as THREE from 'three';

export class FollowerSphere {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Vector3} position
     */
    constructor(scene, position) {
        this.initialPosition = position.clone();

        this.mesh = new THREE.Group();
        this.mesh.position.copy(position);

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

        scene.add(this.mesh);
    }

    /**
     * @param {number} time
     * @param {THREE.Vector3} playerPos
     * @param {number} dt
     */
    update(time, playerPos, dt) {
        if (!playerPos) return;

        // Subtle hover effect
        this.mesh.position.y = this.initialPosition.y + Math.sin(time * 2) * 0.15;

        // Aim at player
        const targetPoint = playerPos.clone();
        targetPoint.y += 0.5; // Look roughly at center/head of player

        // We use a dummy object to calculate the target rotation
        const dummy = new THREE.Object3D();
        dummy.position.copy(this.mesh.position);
        dummy.lookAt(targetPoint);

        // Slerp towards target lookAt rotation for smooth tracking
        this.mesh.quaternion.slerp(dummy.quaternion, 5 * dt);
    }
}
