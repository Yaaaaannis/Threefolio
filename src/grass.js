import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    mul, max, step, If, output, color, sin, smoothstep, mix, float, mod,
    transformNormalToView, uniformArray, varying, vertexIndex, rotateUV, Loop,
    cameraPosition, vec4, atan, vec3, vec2, modelWorldMatrix, Fn, attribute, uniform
} from 'three/tsl';

export class Grass {
    constructor(scene) {
        this.scene = scene;
        const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

        this.subdivisions = isMobile ? 100 : 200; // 4x fewer blades on mobile
        this.size = 60; // Spread across a 60x60 area
        this.count = this.subdivisions * this.subdivisions;
        this.fragmentSize = this.size / this.subdivisions;

        this.setGeometry();
        this.setMaterial();
        this.setMesh();
    }

    setGeometry() {
        const position = new Float32Array(this.count * 3 * 2);
        const heightRandomness = new Float32Array(this.count * 3);

        for (let iX = 0; iX < this.subdivisions; iX++) {
            const fragmentX = (iX / this.subdivisions - 0.5) * this.size + this.fragmentSize * 0.5;

            for (let iZ = 0; iZ < this.subdivisions; iZ++) {
                const fragmentZ = (iZ / this.subdivisions - 0.5) * this.size + this.fragmentSize * 0.5;

                const i = (iX * this.subdivisions + iZ);
                const i3 = i * 3;
                const i6 = i * 6;

                // Center of the blade + random offset
                const positionX = fragmentX + (Math.random() - 0.5) * this.fragmentSize;
                const positionZ = fragmentZ + (Math.random() - 0.5) * this.fragmentSize;

                position[i6] = positionX;
                position[i6 + 1] = positionZ;

                position[i6 + 2] = positionX;
                position[i6 + 3] = positionZ;

                position[i6 + 4] = positionX;
                position[i6 + 5] = positionZ;

                // Randomness factors for blade height
                heightRandomness[i3] = Math.random();
                heightRandomness[i3 + 1] = Math.random();
                heightRandomness[i3 + 2] = Math.random();
            }
        }

        this.geometry = new THREE.BufferGeometry();
        this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.size);
        this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 2));
        this.geometry.setAttribute('heightRandomness', new THREE.Float32BufferAttribute(heightRandomness, 1));
    }

    setMaterial() {
        this.center = uniform(new THREE.Vector2(0, 0));

        const vertexLoopIndex = varying(vertexIndex.toFloat().mod(3));
        const tipness = varying(step(vertexLoopIndex, 0.5));
        const wind = varying(vec2());
        const bladePosition = varying(vec2());

        this.bladeWidth = uniform(0.12);
        this.bladeHeight = uniform(1.2);
        this.bladeHeightRandomness = uniform(0.6);
        this.sizeUniform = uniform(this.size);
        this.timeNode = uniform(0.0);

        const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
        this.TRAIL_SIZE = isMobile ? 40 : 80;
        this.PLAYER_SLOTS = isMobile ? 20 : 40;
        this.CUBE_SLOTS = isMobile ? 20 : 40;
        this.HOLD_TIME = 3.0;
        this.FADE_TIME = 1.0;

        // CPU-side ring buffers (separate so cubes never crowd out the player)
        this._playerTrail = [];
        this._cubeTrail = [];
        this._lastSampleTime = 0;
        this._lastCubeSampleTime = 0;

        // Flat uniform arrays for the GPU (XZ positions + ages)
        const flatPos = new Array(this.TRAIL_SIZE * 2).fill(99999);   // far off screen initially
        const flatAges = new Array(this.TRAIL_SIZE).fill(9999);       // all expired

        this.trailPosNode = uniformArray(flatPos, 'float');
        this.trailAgesNode = uniformArray(flatAges, 'float');
        this.playerRadius = uniform(1);    // Wide gradient = smooth entry
        this.playerStrength = uniform(1.2);  // Gentle bend strength

        // Cube instant displacement (no trail, no memory)
        this.CUBE_COUNT = 32;
        const flatCubePos = new Array(this.CUBE_COUNT * 2).fill(99999);
        this.cubePosNode = uniformArray(flatCubePos, 'float');
        this.cubeRadius = uniform(0.8);
        this.cubeStrength = uniform(1.0);

        const bladeShape = uniformArray([
            // Tip
            0, 1,
            // Left side
            1, 0,
            // Right side
            -1, 0,
        ]);

        // Base color nodes
        const colorBase = color(0x113311);
        const colorTip = color(0x339933);
        const bladeColor = mix(colorBase, colorTip, tipness);

        // We use MeshStandardNodeMaterial since MeshDefaultMaterial is from the user's specific project structure
        this.material = new MeshStandardNodeMaterial({
            colorNode: bladeColor,
            roughness: 0.8,
            metalness: 0.1,
            side: THREE.DoubleSide
        });

        this.material.positionNode = Fn(() => {
            // Static Blade position mapping
            const position = attribute('position');
            const position3 = vec3(position.x, 0, position.y);
            const worldPosition = modelWorldMatrix.mul(position3);
            bladePosition.assign(worldPosition.xz);

            // Procedural Terrain Noise (Low frequency for big patches)
            const patchNoise = sin(bladePosition.x.mul(0.15))
                .add(sin(bladePosition.y.mul(0.15)))
                .mul(0.5).add(0.5); // Range ~0 to 1

            // Hide blades outside patches
            const hiddenThreshold = 0.4;
            // 1.0 if patchNoise < 0.4, 0.0 otherwise
            const hidden = step(patchNoise, hiddenThreshold);

            // Height mapping
            const height = this.bladeHeight
                .mul(this.bladeHeightRandomness.mul(attribute('heightRandomness')).add(this.bladeHeightRandomness.oneMinus()))
                .mul(patchNoise); // Taller in the center of patches

            // Shape interpolation
            const shapeX = bladeShape.element(vertexLoopIndex.mod(3).mul(2)).mul(this.bladeWidth);
            const shapeY = bladeShape.element(vertexLoopIndex.mod(3).mul(2).add(1)).mul(height);
            const shape = vec3(shapeX, shapeY, 0);

            // Vertex positioning
            const vertexPosition = position3.add(shape);

            // Vertex rotation facing camera
            const angleToCamera = atan(worldPosition.z.sub(cameraPosition.z), worldPosition.x.sub(cameraPosition.x)).add(-Math.PI * 0.5);
            vertexPosition.xz.assign(rotateUV(vertexPosition.xz, angleToCamera, worldPosition.xz));

            // // Procedural Wind Effect (breezy sine waves) — DISABLED
            // const windStrength = tipness.mul(height).mul(0.3);
            // const windNoiseX = sin(bladePosition.x.mul(0.5).add(this.timeNode));
            // const windNoiseY = sin(bladePosition.y.mul(0.5).add(this.timeNode.mul(1.2)));
            // wind.assign(vec2(windNoiseX, windNoiseY).mul(windStrength));
            // vertexPosition.addAssign(vec3(wind.x, 0, wind.y));

            // Trail Displacement: iterate recent footsteps, take the strongest one
            // Using max per entry avoids additive accumulation blowing up
            const totalPush = vec2(0, 0).toVar();

            Loop({ start: 0, end: this.TRAIL_SIZE }, ({ i }) => {
                const tx = this.trailPosNode.element(i.mul(2));
                const tz = this.trailPosNode.element(i.mul(2).add(1));
                const trailPoint = vec2(tx, tz);
                const age = this.trailAgesNode.element(i);

                // Spatial falloff
                const toDelta = bladePosition.sub(trailPoint);
                const dist = toDelta.length().add(0.001); // avoid divide by zero
                const spatialFalloff = smoothstep(this.playerRadius, float(0.0), dist);

                // Time falloff: full for 3s, fade over next 1s
                const timeFalloff = smoothstep(float(4.0), float(3.0), age);

                const weight = spatialFalloff.mul(timeFalloff);
                const pushDir = toDelta.div(dist); // normalized, safe
                const contribution = pushDir.mul(weight);

                // Only keep max contribution, don't accumulate additively
                If(contribution.length().greaterThan(totalPush.length()), () => {
                    totalPush.assign(contribution);
                });
            });

            // Scale clamp and apply: only influence tips, not grass base
            const clampedPush = totalPush.mul(this.playerStrength).mul(tipness);
            vertexPosition.addAssign(vec3(clampedPush.x, 0, clampedPush.y));

            // Cube instant displacement (no trail, no time decay)
            const cubePush = vec2(0, 0).toVar();

            Loop({ start: 0, end: this.CUBE_COUNT }, ({ i: ci }) => {
                const cx = this.cubePosNode.element(ci.mul(2));
                const cz = this.cubePosNode.element(ci.mul(2).add(1));
                const cubePoint = vec2(cx, cz);

                const cubeDelta = bladePosition.sub(cubePoint);
                const cubeDist = cubeDelta.length().add(0.001);
                const cubeSpatial = smoothstep(this.cubeRadius, float(0.0), cubeDist);
                const cubeDir = cubeDelta.div(cubeDist);
                const cubeContrib = cubeDir.mul(cubeSpatial);

                If(cubeContrib.length().greaterThan(cubePush.length()), () => {
                    cubePush.assign(cubeContrib);
                });
            });

            vertexPosition.addAssign(vec3(
                cubePush.mul(this.cubeStrength).mul(tipness).x,
                0,
                cubePush.mul(this.cubeStrength).mul(tipness).y
            ));

            // Hide (far above or below) if outside patch
            vertexPosition.y.addAssign(hidden.mul(-100));

            return vertexPosition;
        })();
    }

    setMesh() {
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.frustumCulled = false;
        this.mesh.receiveShadow = true;
        this.mesh.castShadow = true;
        this.scene.add(this.mesh);
    }

    update(time, playerPos, onGround = true, cubePositions = null) {
        this.timeNode.value = time * 2.0;

        if (!playerPos) return;

        const SAMPLE_INTERVAL = 0.1;
        const CUBE_SAMPLE_INTERVAL = 0.15;  // slightly less frequent for cubes
        const totalTime = this.HOLD_TIME + this.FADE_TIME;

        // --- Player footsteps (only when grounded) ---
        if (onGround && time - this._lastSampleTime > SAMPLE_INTERVAL) {
            this._lastSampleTime = time;
            this._playerTrail.push({ x: playerPos.x, z: playerPos.z, t: time });
            this._playerTrail = this._playerTrail.filter(e => (time - e.t) < totalTime + 0.2);
            if (this._playerTrail.length > this.PLAYER_SLOTS) {
                this._playerTrail = this._playerTrail.slice(-this.PLAYER_SLOTS);
            }
        }

        // --- Cube footsteps: only record when a cube has moved significantly ---
        // This avoids flooding the buffer with stationary entries
        const MOVE_THRESHOLD_SQ = 0.09; // 0.3 units squared
        if (cubePositions) {
            if (!this._cubeLastPos) {
                this._cubeLastPos = cubePositions.map(c => ({ x: c.x, z: c.z }));
            }
            for (let i = 0; i < cubePositions.length; i++) {
                const cube = cubePositions[i];
                const last = this._cubeLastPos[i];
                const dx = cube.x - last.x;
                const dz = cube.z - last.z;
                if (dx * dx + dz * dz > MOVE_THRESHOLD_SQ) {
                    // Record the OLD position as a footprint (where it was)
                    this._cubeTrail.push({ x: last.x, z: last.z, t: time });
                    this._cubeLastPos[i] = { x: cube.x, z: cube.z };
                }
            }
            this._cubeTrail = this._cubeTrail.filter(e => (time - e.t) < totalTime + 0.2);
            if (this._cubeTrail.length > this.CUBE_SLOTS) {
                this._cubeTrail = this._cubeTrail.slice(-this.CUBE_SLOTS);
            }
        }

        // --- GPU upload: player entries first, cubes get whatever is left ---
        let gpuSlot = 0;

        // 1. Player trail gets priority — fill from the start
        for (let i = 0; i < this._playerTrail.length && gpuSlot < this.TRAIL_SIZE; i++, gpuSlot++) {
            const e = this._playerTrail[i];
            this.trailPosNode.array[gpuSlot * 2] = e.x;
            this.trailPosNode.array[gpuSlot * 2 + 1] = e.z;
            this.trailAgesNode.array[gpuSlot] = time - e.t;
        }

        // 2. Fill remaining slots with cube trail entries
        for (let j = 0; j < this._cubeTrail.length && gpuSlot < this.TRAIL_SIZE; j++, gpuSlot++) {
            const e = this._cubeTrail[j];
            this.trailPosNode.array[gpuSlot * 2] = e.x;
            this.trailPosNode.array[gpuSlot * 2 + 1] = e.z;
            this.trailAgesNode.array[gpuSlot] = time - e.t;
        }

        // 3. Zero-out any remaining unused slots
        for (; gpuSlot < this.TRAIL_SIZE; gpuSlot++) {
            this.trailPosNode.array[gpuSlot * 2] = 99999;
            this.trailPosNode.array[gpuSlot * 2 + 1] = 99999;
            this.trailAgesNode.array[gpuSlot] = 9999;
        }

        this.trailPosNode.needsUpdate = true;
        this.trailAgesNode.needsUpdate = true;
    }
}
