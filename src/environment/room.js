// room.js — Simplified room (just a floor for now)

import * as THREE from 'three';

import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, mix, texture, vec2, positionWorld, float, smoothstep } from 'three/tsl';

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

        const splatmapTexture = new THREE.TextureLoader().load('/textures/newmap.png');

        // Match the grass splatmap UV scaling (size = 60)
        const grassSize = 60.0;
        const uvX = positionWorld.x.div(grassSize).add(0.5);
        const uvY = float(0.5).sub(positionWorld.z.div(grassSize));
        const splatUV = vec2(uvX, uvY);

        const splatColor = texture(splatmapTexture, splatUV);
        const greenChannel = splatColor.g;

        // Smoothstep to ensure borders are in gradient, avoiding sharp breaks
        const dirtBlend = smoothstep(0.0, 1.0, greenChannel);

        const grassColor = color(0x44aa44);
        const dirtColor = color(0x7a5c3b); // Dirt brown color

        // Final color blends between green and dirt based on the splatmap
        const finalColor = mix(grassColor, dirtColor, dirtBlend);

        const floorMat = new MeshStandardNodeMaterial({
            colorNode: finalColor,
            roughness: 0.95,
            metalness: 0,
        });

        this.PLANET_RADIUS = 50;
        this.PLANET_CENTER = new THREE.Vector3(0, -this.PLANET_RADIUS, 0);

        // Planet Mesh
        this.floorMesh = new THREE.Mesh(
            new THREE.SphereGeometry(this.PLANET_RADIUS, 128, 128),
            floorMat
        );
        this.floorMesh.position.copy(this.PLANET_CENTER);
        this.floorMesh.receiveShadow = true;
        scene.add(this.floorMesh);

        // Planet Physics
        const floorDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(this.PLANET_CENTER.x, this.PLANET_CENTER.y, this.PLANET_CENTER.z);
        const floorBody = world.createRigidBody(floorDesc);
        world.createCollider(RAPIER.ColliderDesc.ball(this.PLANET_RADIUS), floorBody);

        this._addWallJumpCorridor(scene);
    }

    // Removed _loadIsland and _addGridFloor

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
