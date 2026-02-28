import * as THREE from 'three';

export class ChessZone {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Vector3} position
     */
    constructor(scene, position) {
        this.scene = scene;
        this.radius = 2.5;
        this.center = position;

        // Visuals: Glowing circle on the ground
        const ringGeo = new THREE.RingGeometry(this.radius - 0.2, this.radius, 32);
        this.ringMat = new THREE.MeshStandardMaterial({
            color: 0x8a2be2, // Purple default
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.8,
            depthWrite: false,
            roughness: 1,
            metalness: 0
        });

        this.ringMesh = new THREE.Mesh(ringGeo, this.ringMat);
        this.ringMesh.rotation.x = -Math.PI / 2;
        this.ringMesh.position.set(this.center.x, 0.1, this.center.z);
        this.scene.add(this.ringMesh);

        // Interaction state
        this.isPlayerInside = false;

        // Let main handle the actual key tracking for possession to avoid double-bindings
        this.isPossessing = false;
    }

    /**
     * @param {THREE.Vector3} playerPos 
     * @returns {boolean} Whether the player is inside the zone
     */
    update(playerPos) {
        const dx = playerPos.x - this.center.x;
        const dz = playerPos.z - this.center.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        this.isPlayerInside = distance <= this.radius;

        if (this.isPlayerInside) {
            this.ringMat.color.setHex(0xff00ff); // Bright magenta when inside
            this.ringMat.emissive.setHex(0x550055);
        } else {
            this.ringMat.color.setHex(0x8a2be2); // Dim purple
            this.ringMat.emissive.setHex(0x000000);
        }

        return this.isPlayerInside;
    }
}
