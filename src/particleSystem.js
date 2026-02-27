import * as THREE from 'three';

export class ParticleSystem {
    constructor(scene, maxParticles = 800) {
        this.maxParticles = maxParticles;
        this.particleIndex = 0;

        // Base states (immutable spawn data)
        this.startPositions = new Float32Array(this.maxParticles * 3);
        this.velocities = new Float32Array(this.maxParticles * 3);
        this.startTimes = new Float32Array(this.maxParticles);
        this.lifeSpans = new Float32Array(this.maxParticles);

        // Dynamic states (passed to GPU)
        this.positions = new Float32Array(this.maxParticles * 3);
        this.colors = new Float32Array(this.maxParticles * 3);

        for (let i = 0; i < this.maxParticles; i++) {
            this.startTimes[i] = -999.0;
            this.lifeSpans[i] = 0.1;
            this.positions[i * 3 + 1] = 9999.0; // Hide offscreen initially
        }

        // WebGPU Workaround: THREE.Points is completely broken in r183 early WebGPU.
        // We use an highly optimized InstancedMesh of tiny shards instead.
        const geometry = new THREE.BoxGeometry(0.08, 0.3, 0.08); // Sharper shards
        const material = new THREE.MeshStandardMaterial({
            color: 0xffffee, // Very bright white core
            emissive: 0xffaa00,
            emissiveIntensity: 2.0, // Stronger glow
            roughness: 0.1,
            metalness: 0.8
        });

        this.instancedMesh = new THREE.InstancedMesh(geometry, material, this.maxParticles);
        this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.instancedMesh.frustumCulled = false;

        // Hide all instances initially by scaling them to 0
        this.dummy = new THREE.Object3D();
        this.dummy.scale.set(0, 0, 0);
        this.dummy.updateMatrix();

        for (let i = 0; i < this.maxParticles; i++) {
            this.instancedMesh.setMatrixAt(i, this.dummy.matrix);
        }

        this.instancedMesh.instanceMatrix.needsUpdate = true;
        scene.add(this.instancedMesh);
    }

    emit(origin, normal, count, currentTime) {
        // Limit max emission at once
        count = Math.min(count, 50);

        for (let i = 0; i < count; i++) {
            const idx = this.particleIndex;

            // Start positions (tighter cluster)
            this.startPositions[idx * 3] = origin.x + (Math.random() - 0.5) * 0.5;
            this.startPositions[idx * 3 + 1] = origin.y + (Math.random() - 0.5) * 0.5;
            this.startPositions[idx * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.5;

            // Velocities (much punchier)
            if (normal) {
                const spread = 6.0;
                const power = 8.0 + Math.random() * 6.0;
                this.velocities[idx * 3] = normal.x * power + (Math.random() - 0.5) * spread;
                this.velocities[idx * 3 + 1] = normal.y * power + (Math.random() - 0.5) * spread + 4.0;
                this.velocities[idx * 3 + 2] = normal.z * power + (Math.random() - 0.5) * spread;
            } else {
                const spread = 15.0;
                const power = 5.0 + Math.random() * 8.0;

                const u = Math.random();
                const v = Math.random();
                const theta = u * 2.0 * Math.PI;
                const phi = Math.acos(2.0 * v - 1.0);
                const rx = Math.sin(phi) * Math.cos(theta);
                const ry = Math.sin(phi) * Math.sin(theta);
                const rz = Math.cos(phi);

                this.velocities[idx * 3] = rx * power * spread;
                this.velocities[idx * 3 + 1] = ry * power * spread + 5.0;
                this.velocities[idx * 3 + 2] = rz * power * spread;
            }

            this.startTimes[idx] = currentTime;
            this.lifeSpans[idx] = 0.15 + Math.random() * 0.25; // Shorter sharper lifespan

            this.particleIndex = (this.particleIndex + 1) % this.maxParticles;
        }
    }

    update(time) {
        // CPU-based Particle physics loop updating InstancedMesh matrices
        let needsUpdate = false;

        for (let i = 0; i < this.maxParticles; i++) {
            const age = time - this.startTimes[i];
            const lifeSpan = this.lifeSpans[i];

            // If dead or unborn
            if (age < 0 || age > lifeSpan) {
                // If it was just alive, scale it to 0 cleanly once to avoid re-rendering
                if (this.positions[i * 3 + 1] !== 9999.0) {
                    this.positions[i * 3] = 9999.0;
                    this.positions[i * 3 + 1] = 9999.0;
                    this.positions[i * 3 + 2] = 9999.0;

                    this.dummy.scale.set(0, 0, 0);
                    this.dummy.position.set(0, -999, 0);
                    this.dummy.updateMatrix();
                    this.instancedMesh.setMatrixAt(i, this.dummy.matrix);
                    needsUpdate = true;
                }
                continue;
            }

            // Valid particle, calc position
            const sx = this.startPositions[i * 3];
            const sy = this.startPositions[i * 3 + 1];
            const sz = this.startPositions[i * 3 + 2];

            const vx = this.velocities[i * 3];
            const vy = this.velocities[i * 3 + 1];
            const vz = this.velocities[i * 3 + 2];

            const px = sx + (vx * age);
            // More aggressive gravity for punchy look
            const py = sy + (vy * age) - (15.0 * age * age);
            const pz = sz + (vz * age);

            this.positions[i * 3] = px;
            this.positions[i * 3 + 1] = py;
            this.positions[i * 3 + 2] = pz;

            // Shrink as it dies
            const lifePct = age / lifeSpan;
            const size = 1.0 - (lifePct * lifePct);

            this.dummy.position.set(px, py, pz);
            this.dummy.scale.set(size, size, size);
            // Spin incredibly fast
            this.dummy.rotation.set(time * 20 + i, time * 15 + i, 0);

            this.dummy.updateMatrix();
            this.instancedMesh.setMatrixAt(i, this.dummy.matrix);

            needsUpdate = true;
        }

        if (needsUpdate) {
            this.instancedMesh.instanceMatrix.needsUpdate = true;
        }
    }
}
