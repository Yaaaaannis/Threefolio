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
        this.subdivisions = 200; // Optimized size for this scene
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

        this.TRAIL_SIZE = 40;
        this.HOLD_TIME = 3.0;   // seconds grass stays bent
        this.FADE_TIME = 1.0;   // seconds to fade back up

        // Trail ring buffer (CPU side)
        this._trail = [];         // Array of { x, z, t }
        this._lastSampleTime = 0;

        // Flat uniform arrays for the GPU (XZ positions + ages)
        const flatPos = new Array(this.TRAIL_SIZE * 2).fill(99999);   // far off screen initially
        const flatAges = new Array(this.TRAIL_SIZE).fill(9999);       // all expired

        this.trailPosNode = uniformArray(flatPos, 'float');
        this.trailAgesNode = uniformArray(flatAges, 'float');
        this.playerRadius = uniform(1);    // Wide gradient = smooth entry
        this.playerStrength = uniform(1.2);  // Gentle bend strength

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

    update(time, playerPos, onGround = true) {
        this.timeNode.value = time * 2.0;

        if (!playerPos) return;

        const SAMPLE_INTERVAL = 0.1; // seconds
        const totalTime = this.HOLD_TIME + this.FADE_TIME; // 4s max age

        // Only sample footsteps when the player is on the ground
        if (onGround && time - this._lastSampleTime > SAMPLE_INTERVAL) {
            this._lastSampleTime = time;
            this._trail.push({ x: playerPos.x, z: playerPos.z, t: time });

            // Remove entries too old to matter
            this._trail = this._trail.filter(e => (time - e.t) < totalTime + 0.2);

            // Keep only TRAIL_SIZE most recent
            if (this._trail.length > this.TRAIL_SIZE) {
                this._trail = this._trail.slice(-this.TRAIL_SIZE);
            }
        }

        // Upload the trail to the GPU uniform arrays
        for (let i = 0; i < this.TRAIL_SIZE; i++) {
            const entry = this._trail[i];
            if (entry) {
                this.trailPosNode.array[i * 2] = entry.x;
                this.trailPosNode.array[i * 2 + 1] = entry.z;
                this.trailAgesNode.array[i] = time - entry.t;
            } else {
                this.trailPosNode.array[i * 2] = 99999;
                this.trailPosNode.array[i * 2 + 1] = 99999;
                this.trailAgesNode.array[i] = 9999;
            }
        }

        this.trailPosNode.needsUpdate = true;
        this.trailAgesNode.needsUpdate = true;
    }
}
