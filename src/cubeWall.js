import * as THREE from 'three';

export class CubeWall {
    /**
     * @param {THREE.Scene} scene
     * @param {import('@dimforge/rapier3d-compat')} RAPIER
     * @param {import('@dimforge/rapier3d-compat').World} world
     * @param {THREE.Vector3} startPos
     * @param {number} cols
     * @param {number} rows
     * @param {number} cubeSize
     */
    constructor(scene, RAPIER, world, startPos, cols = 4, rows = 4, cubeSize = 1) {
        this.scene = scene;
        this.RAPIER = RAPIER;
        this.world = world;

        this.cubes = [];

        const cubeGeo = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
        // Alternate colors for a checkered/brick look
        const mat1 = new THREE.MeshStandardMaterial({ color: 0x888888 }); // Gray
        const mat2 = new THREE.MeshStandardMaterial({ color: 0xcc4444 }); // Brick red

        // Build the wall
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const mat = ((r + c) % 2 === 0) ? mat1 : mat2;
                const mesh = new THREE.Mesh(cubeGeo, mat);
                mesh.castShadow = true;
                mesh.receiveShadow = true;

                // Calculate position
                // StartPos is the center of the wall base.
                // Y goes up with rows, Z goes depth-wise with cols
                const posX = startPos.x;
                const posY = startPos.y + (cubeSize / 2) + (r * cubeSize);
                const posZ = startPos.z + (c * cubeSize) - ((cols * cubeSize) / 2); // Center the wall around startPos Z

                mesh.position.set(posX, posY, posZ);
                this.scene.add(mesh);

                // Physics body
                const rbDesc = this.RAPIER.RigidBodyDesc.dynamic().setTranslation(posX, posY, posZ);
                const rigidBody = this.world.createRigidBody(rbDesc);

                // Physics collider
                const halfSize = cubeSize / 2;
                const colDesc = this.RAPIER.ColliderDesc.cuboid(halfSize, halfSize, halfSize)
                    .setRestitution(0.2) // Less bouncy than the individual spawner cubes so the wall stands
                    .setDensity(1.0)
                    .setFriction(0.6); // Higher friction keeps the wall from sliding apart on its own

                this.world.createCollider(colDesc, rigidBody);

                this.cubes.push({ mesh, rigidBody });
            }
        }
    }

    update() {
        // Sync visual meshes with physics bodies
        for (const cube of this.cubes) {
            const pos = cube.rigidBody.translation();
            const rot = cube.rigidBody.rotation();
            cube.mesh.position.set(pos.x, pos.y, pos.z);
            cube.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
        }
    }
}
