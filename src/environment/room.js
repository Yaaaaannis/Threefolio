// room.js — Simplified room (just a floor for now)

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const BASE_HALF = 20;

export class Room {
    /**
     * @param {THREE.Scene} scene
     * @param {import('@dimforge/rapier3d-compat')} RAPIER
     * @param {import('@dimforge/rapier3d-compat').World} world
     */
    constructor(scene, RAPIER, world) {
        this.scene = scene;
        this.RAPIER = RAPIER;
        this.world = world;

        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x44aa44, // Green floor
            roughness: 0.95,
            metalness: 0,
        });

        // Floor
        this.floorMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(BASE_HALF * 20, BASE_HALF * 20),
            floorMat
        );
        this.floorMesh.rotation.x = -Math.PI / 2;
        this.floorMesh.receiveShadow = true;
        scene.add(this.floorMesh);

        // Floor physics
        const floorDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
        const floorBody = world.createRigidBody(floorDesc);
        world.createCollider(RAPIER.ColliderDesc.cuboid(BASE_HALF * 40, 0.1, BASE_HALF * 40), floorBody); // Increased size

        this._addGridFloor(scene);
        this._loadIsland(scene);
        this._addWallJumpCorridor(scene);
    }

    _loadIsland(scene) {
        const loader = new GLTFLoader();
        loader.load('/models/low_poly_floating_island.glb', (gltf) => {
            const island = gltf.scene;

            // Scale and position the island so the player has to jump
            // Scale and position the island so the player has to jump
            island.scale.set(4, 4, 4);
            island.updateMatrixWorld(true);

            // Center the island logically to ensure we can see it
            const box = new THREE.Box3().setFromObject(island);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            console.log('Island bounds:', { center, size });

            // Offset the island so its center is near where we want it,
            // then place it a bit forward in Z.
            island.position.x += (0 - center.x);
            island.position.y += (0 - center.y) + 2; // top of island near Y=2
            island.position.z += (0 - center.z) - 20; // push it forward

            island.updateMatrixWorld(true);

            island.traverse((child) => {
                if (child.isMesh) {
                    child.receiveShadow = true;
                    child.castShadow = true;

                    // Create a trimesh collider for exact physical geometry
                    const geometry = child.geometry.clone();
                    geometry.applyMatrix4(child.matrixWorld); // Bake exact world transform into vertices

                    const vertices = geometry.attributes.position.array;
                    let indices = geometry.index ? geometry.index.array : null;

                    if (vertices.length > 0) {
                        let colliderDesc;
                        if (indices) {
                            colliderDesc = this.RAPIER.ColliderDesc.trimesh(vertices, indices);
                        } else {
                            // If no indices, derive them
                            const generatedIndices = new Uint32Array(vertices.length / 3);
                            for (let i = 0; i < generatedIndices.length; i++) generatedIndices[i] = i;
                            colliderDesc = this.RAPIER.ColliderDesc.trimesh(vertices, generatedIndices);
                        }

                        // Because vertices are baked in world space, the rigid body itself stays at the origin
                        const rbDesc = this.RAPIER.RigidBodyDesc.fixed()
                            .setTranslation(0, 0, 0);

                        const body = this.world.createRigidBody(rbDesc);
                        this.world.createCollider(colliderDesc, body);
                    }
                }
            });

            scene.add(island);
        }, undefined, (err) => {
            console.error('Failed to load island:', err);
        });
    }

    _addGridFloor(scene) {
        // Subtle grid on floor for spatial reference
        const size = BASE_HALF * 40; // Made larger since it's now static
        const divisions = 80;
        const grid = new THREE.GridHelper(size, divisions, 0x000000, 0x000000);
        grid.position.y = 0.01;
        grid.material.opacity = 0.15;
        grid.material.transparent = true;
        scene.add(grid);
        this.grid = grid;
    }

    /**
     * @param {THREE.Vector3} playerPos
     * @param {number} energy - [-1, 1]
     * @param {number} dt
     * @param {number} time
     */
    update(playerPos, energy, dt, time) {
        // Floor and grid are now completely static.
    }

    _addWallJumpCorridor(scene) {
        const wallMat = new THREE.MeshStandardMaterial({
            color: 0x778899, // Slate grey
            roughness: 0.8,
            metalness: 0.1,
        });
        const platformMat = new THREE.MeshStandardMaterial({
            color: 0xddaa55, // Gold platform
            roughness: 0.5,
            metalness: 0.2,
        });

        // Corridor parameters
        const wallHeight = 14;
        const wallThick = 1.0;
        const wallLength = 5;
        const gap = 3.0;        // Gap between the two walls (player navigates this)
        const baseX = 10;       // Position to the side of the start
        const baseZ = -5;

        // Left wall
        const leftWall = new THREE.Mesh(
            new THREE.BoxGeometry(wallThick, wallHeight, wallLength),
            wallMat
        );
        leftWall.position.set(baseX - gap / 2 - wallThick / 2, wallHeight / 2, baseZ);
        leftWall.castShadow = true;
        leftWall.receiveShadow = true;
        scene.add(leftWall);

        // Right wall
        const rightWall = new THREE.Mesh(
            new THREE.BoxGeometry(wallThick, wallHeight, wallLength),
            wallMat
        );
        rightWall.position.set(baseX + gap / 2 + wallThick / 2, wallHeight / 2, baseZ);
        rightWall.castShadow = true;
        rightWall.receiveShadow = true;
        scene.add(rightWall);



        // Physics: Left wall
        const lbDesc = this.RAPIER.RigidBodyDesc.fixed()
            .setTranslation(leftWall.position.x, leftWall.position.y, leftWall.position.z);
        const lb = this.world.createRigidBody(lbDesc);
        this.world.createCollider(
            this.RAPIER.ColliderDesc.cuboid(wallThick / 2, wallHeight / 2, wallLength / 2), lb
        );

        // Physics: Right wall
        const rbDesc = this.RAPIER.RigidBodyDesc.fixed()
            .setTranslation(rightWall.position.x, rightWall.position.y, rightWall.position.z);
        const rb = this.world.createRigidBody(rbDesc);
        this.world.createCollider(
            this.RAPIER.ColliderDesc.cuboid(wallThick / 2, wallHeight / 2, wallLength / 2), rb
        );


    }
}
