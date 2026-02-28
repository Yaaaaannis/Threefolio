import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

export class Chess {
    /**
     * @param {THREE.Scene} scene
     * @param {import('@dimforge/rapier3d-compat')} RAPIER
     * @param {import('@dimforge/rapier3d-compat').World} world
     * @param {THREE.Vector3} position
     */
    constructor(scene, RAPIER, world, position = new THREE.Vector3(0, 0, 0)) {
        this.scene = scene;
        this.RAPIER = RAPIER;
        this.world = world;
        this.mesh = null;
        this.pieces = [];
        this.boardSquares = []; // Store the squares
        this.blackQueen = null; // Specific reference

        // Input state just for the queen
        this._queenMoveCooldown = 0;

        this._loadModel(position);
    }

    _loadModel(position) {
        const loader = new GLTFLoader();

        // Setup Draco Decoder
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/'); // Use standard CDN path
        loader.setDRACOLoader(dracoLoader);

        loader.load('/models/chess.glb', (gltf) => {
            this.mesh = gltf.scene;
            this.mesh.position.copy(position);
            this.mesh.scale.set(60, 60, 60);

            // Force compute world matrices immediately for calculation
            this.mesh.updateMatrixWorld(true);

            const piecesToProcess = [];
            const boardParts = [];

            // Sort children
            this.mesh.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;

                    // Group by semantic names
                    const isPiece = /pawn|rook|knight|bishop|queen|king/i.test(child.name) || /piece/i.test(child.material?.name);

                    if (isPiece) {
                        piecesToProcess.push(child);

                        // Identifying the black queen specifically
                        if (child.name.toLowerCase().includes('queen') && child.material?.name.toLowerCase().includes('black')) {
                            // Save a reference to process it later
                            child.userData.isBlackQueen = true;
                        }
                    } else {
                        boardParts.push(child);
                    }
                }
            });

            this.scene.add(this.mesh);

            // 1. Process playable pieces as dynamic objects
            piecesToProcess.forEach(piece => {
                // Compute world space bounding box
                const box = new THREE.Box3().setFromObject(piece);
                const size = new THREE.Vector3();
                box.getSize(size);

                const center = new THREE.Vector3();
                box.getCenter(center);

                if (size.x === 0) size.x = 0.5;
                if (size.y === 0) size.y = 0.5;
                if (size.z === 0) size.z = 0.5;

                // Detach from global scene group so its position/rotation become absolute in the world
                this.scene.attach(piece);

                // Generate dynamic physics
                let rbDesc = this.RAPIER.RigidBodyDesc.dynamic()
                    .setTranslation(center.x, center.y, center.z);

                if (piece.userData.isBlackQueen) {
                    rbDesc = rbDesc.lockRotations(); // Keep only the Queen upright
                }

                const body = this.world.createRigidBody(rbDesc);

                // Create cuboid collider
                const colliderDesc = this.RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2);
                colliderDesc.setMass(1.0);
                this.world.createCollider(colliderDesc, body);

                this.pieces.push({ mesh: piece, body: body });

                if (piece.userData.isBlackQueen) {
                    this.blackQueen = { mesh: piece, body: body };
                }
            });

            // 2. Process board as fixed objects
            boardParts.forEach(part => {
                const box = new THREE.Box3().setFromObject(part);
                const size = new THREE.Vector3();
                box.getSize(size);
                const center = new THREE.Vector3();
                box.getCenter(center);

                if (size.x <= 0.01 && size.y <= 0.01 && size.z <= 0.01) return;

                // Ensure minimal thickness
                size.x = Math.max(size.x, 0.05);
                size.y = Math.max(size.y, 0.05);
                size.z = Math.max(size.z, 0.05);

                // Save square center for grid movement
                this.boardSquares.push(center.clone());

                const rbDesc = this.RAPIER.RigidBodyDesc.fixed()
                    .setTranslation(center.x, center.y, center.z);
                const body = this.world.createRigidBody(rbDesc);

                const colliderDesc = this.RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2);
                this.world.createCollider(colliderDesc, body);
            });

        }, undefined, (err) => {
            console.error('Failed to load chess model:', err);
        });
    }

    update() {
        // Synchronize all dynamic pieces
        for (const p of this.pieces) {
            const t = p.body.translation();
            const r = p.body.rotation();
            p.mesh.position.set(t.x, t.y, t.z);
            p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        }
    }

    getBlackQueen() {
        return this.blackQueen;
    }

    /**
     * @param {number} dt 
     * @param {Object} KEYS 
     */
    moveQueen(dt, KEYS) {
        if (!this.blackQueen) return;

        if (this._queenMoveCooldown > 0) {
            this._queenMoveCooldown -= dt;
        }

        let dx = 0, dz = 0;
        if (KEYS.ArrowUp) dz -= 1;
        if (KEYS.ArrowDown) dz += 1;
        if (KEYS.ArrowLeft) dx -= 1;
        if (KEYS.ArrowRight) dx += 1;

        if (dx === 0 && dz === 0) return;
        if (this._queenMoveCooldown > 0) return;

        // Grid-based hopping
        const currentPos = this.blackQueen.body.translation();
        const posVec = new THREE.Vector3(currentPos.x, currentPos.y, currentPos.z);
        const dir = new THREE.Vector3(dx, 0, dz).normalize();

        let bestSquare = null;
        let bestDist = Infinity;

        // Find the closest square roughly in the input direction
        for (const sq of this.boardSquares) {
            const toSq = new THREE.Vector3().subVectors(sq, posVec);
            toSq.y = 0; // Evaluate only 2D plane
            const dist = toSq.length();

            // A typical chess square width here is around 7-8 units (assuming scale 60 and 8x8 on a ~60 unit board)
            if (dist > 1.0 && dist < 25.0) {
                toSq.normalize();
                const dot = toSq.dot(dir);
                if (dot > 0.8) { // Strict angle requirement to enforce grid lines
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestSquare = sq;
                    }
                }
            }
        }

        if (bestSquare) {
            // Teleport slightly above the specific square to complete the "hop"
            this.blackQueen.body.setTranslation({ x: bestSquare.x, y: posVec.y + 0.5, z: bestSquare.z }, true);
            this._queenMoveCooldown = 0.25; // 250ms cooldown between hops
        }
    }
}
