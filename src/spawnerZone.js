import * as THREE from 'three';

export class SpawnerZone {
    /**
     * @param {THREE.Scene} scene
     * @param {import('@dimforge/rapier3d-compat')} RAPIER
     * @param {import('@dimforge/rapier3d-compat').World} world
     */
    constructor(scene, RAPIER, world) {
        this.scene = scene;
        this.RAPIER = RAPIER;
        this.world = world;

        this.radius = 2.0;
        // Positioned to the left of where the player starts (which is typically around 0, 1.5, 0)
        this.center = new THREE.Vector3(-4, 0.05, 0);
        this.isActive = false;

        // Visuals: Glowing circle on the ground
        const ringGeo = new THREE.RingGeometry(this.radius - 0.2, this.radius, 32);
        this.ringMat = new THREE.MeshStandardMaterial({
            color: 0x444444,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.8,
            depthWrite: false, // Fix transparency rendering issues with the floor
            roughness: 1,
            metalness: 0
        });

        this.ringMesh = new THREE.Mesh(ringGeo, this.ringMat);
        this.ringMesh.rotation.x = -Math.PI / 2;
        this.ringMesh.position.set(this.center.x, 0.1, this.center.z); // Slightly above floor
        this.scene.add(this.ringMesh);

        // Interaction state
        this.isPlayerInside = false;
        this.pressedEnter = false;
        this.cubes = [];

        // Simple local input listener for Enter
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Enter') {
                this.pressedEnter = true;
            }
        });
        window.addEventListener('keyup', (e) => {
            if (e.code === 'Enter') {
                this.pressedEnter = false;
            }
        });

        this._enterConsumed = false;
    }

    _spawnCubes() {
        const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
        const colors = [0xff4444, 0x44ff44, 0x4444ff]; // Red, Green, Blue

        for (let i = 0; i < 3; i++) {
            const mat = new THREE.MeshStandardMaterial({ color: colors[i] });
            const mesh = new THREE.Mesh(cubeGeo, mat);
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            // Spawn them in a small pyramid: 2 on bottom, 1 on top
            let spawnPos;
            if (i === 0) {
                // Bottom left
                spawnPos = { x: this.center.x - 0.6, y: this.center.y + 1, z: this.center.z };
            } else if (i === 1) {
                // Bottom right
                spawnPos = { x: this.center.x + 0.6, y: this.center.y + 1, z: this.center.z };
            } else {
                // Top center
                spawnPos = { x: this.center.x, y: this.center.y + 2.1, z: this.center.z };
            }

            mesh.position.copy(spawnPos);
            this.scene.add(mesh);

            // Rapier physics definition
            const rbDesc = this.RAPIER.RigidBodyDesc.dynamic().setTranslation(spawnPos.x, spawnPos.y, spawnPos.z);
            const rigidBody = this.world.createRigidBody(rbDesc);

            // Cuboid colliders take half-extents, so 1x1x1 means 0.5 half-extents
            // Increase bounciness (restitution) and lower density to make them fly further
            const colDesc = this.RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
                .setRestitution(0.7)
                .setDensity(0.5);
            this.world.createCollider(colDesc, rigidBody);

            this.cubes.push({ mesh, rigidBody });
        }
    }

    /**
     * @param {THREE.Vector3} playerPos 
     */
    update(playerPos) {
        // Distance check (ignoring Y for a flat circle check)
        const dx = playerPos.x - this.center.x;
        const dz = playerPos.z - this.center.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        const wasInside = this.isPlayerInside;
        this.isPlayerInside = distance <= this.radius;

        // Visual feedback
        if (this.isPlayerInside) {
            this.ringMat.color.setHex(0xffff44); // Glow yellow
            this.ringMat.emissive = new THREE.Color(0xffff44);

            // Handle spawn event
            if (this.pressedEnter && !this._enterConsumed) {
                this._spawnCubes();
                this._enterConsumed = true; // Consume the press to avoid spamming
            } else if (!this.pressedEnter) {
                this._enterConsumed = false; // Reset when key is released
            }
        } else {
            this.ringMat.color.setHex(0x444444); // Dark grey
            this.ringMat.emissive = new THREE.Color(0x000000);
            this._enterConsumed = false; // Also reset outside
        }

        // Sync spawned cubes meshes with their rigidbodies
        for (const cube of this.cubes) {
            const pos = cube.rigidBody.translation();
            const rot = cube.rigidBody.rotation();
            cube.mesh.position.set(pos.x, pos.y, pos.z);
            cube.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
        }
    }
}
