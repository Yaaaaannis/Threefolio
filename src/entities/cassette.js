// cassette.js — Decorative cassette model with animated gears and custom materials.
//
// • "vitre"         → smoked transparent glass
// • "Material.003"  → matte black body
// • "1" to "5"      → rotate at different speeds (gears)
// • "ecrou" / "ecrou1" → repositioned lower

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
const GEAR_SPEEDS = {
    "1": 1.2,
    "2": 0.8,
    "3": 1.5,
    "4": 0.6,
    "5": 1.0
};

// ─────────────────────────────────────────────────────────────────────────────
// Cassette
// ─────────────────────────────────────────────────────────────────────────────
export class Cassette {
    constructor(scene, position, scale = 2.0, elevation = 2, rotation = Math.PI * 0.14, nutHeight = -0.03) {
        this._scene = scene;
        this._root = null;
        this._gears = []; // Meshes named "1" through "5"
        this._nuts = []; // Meshes named "ecrou" or "ecrou1"
        this._tubes = [];
        this._wires = [];
        this._scale = scale;
        this._elevation = elevation;
        this._rotation = rotation;
        this._nutHeight = nutHeight;
        this._time = 0;
        this._successTimer = 0;

        // Snap to planet surface
        const PC = new THREE.Vector3(0, -50, 0);
        const PLANET_R = 50;
        const surfDir = new THREE.Vector3().subVectors(position, PC).normalize();
        this._pos = PC.clone().addScaledVector(surfDir, PLANET_R + this._elevation);
        this._normal = surfDir.clone();

        this._qY = new THREE.Quaternion()
            .setFromUnitVectors(new THREE.Vector3(0, 1, 0), this._normal);

        this._load();
    }

    /**
     * Allows controlling the height of the nuts from the console.
     * Example: window.cassette.setNutHeight(-0.1)
     */
    setNutHeight(y) {
        this._nutHeight = y;
        for (const nut of this._nuts) {
            nut.position.y = y;
        }
        console.log(`[Cassette] Nut height set to: ${y}`);
    }

    _load() {
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
        const loader = new GLTFLoader();
        loader.setDRACOLoader(dracoLoader);

        loader.load('/models/cassette.glb', (gltf) => {
            this._root = gltf.scene;
            this._root.position.copy(this._pos);

            // Alignment
            const tiltQ = new THREE.Quaternion().setFromAxisAngle(this._normal, this._rotation);
            this._root.quaternion.copy(this._qY).premultiply(tiltQ);
            this._root.scale.setScalar(this._scale);

            this._scene.add(this._root);

            let gearMaterial = null;

            this._root.traverse((child) => {
                if (!child.isMesh) return;
                const n = child.name;
                const mName = (child.material?.name || "");

                // Glass → Smoked Transparent (vitre / Material.001 usually)
                if (n.toLowerCase().includes('vitre') || mName.toLowerCase().includes('vitre')) {
                    child.material = new THREE.MeshPhysicalMaterial({
                        color: 0x020202,
                        transparent: true,
                        opacity: 0.8,
                        roughness: 0.05,
                        metalness: 0.1,
                        transmission: 0.2,
                        thickness: 0.05,
                        envMapIntensity: 0.5,
                        side: THREE.DoubleSide,
                    });
                }

                // Nixie Tubes → Transparent Glass + Glow
                if (n.toLowerCase().includes('tub')) {
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0x222222,
                        transparent: true,
                        opacity: 0.6,
                        roughness: 0.0,
                        metalness: 0.0,
                        emissive: 0xff6600,
                        emissiveIntensity: 0.0,
                    });
                    this._tubes = this._tubes || [];
                    this._tubes.push(child);
                }

                // Antenna & Body → Matte Black
                if (n.toLowerCase().includes('antenne') || mName === 'Material.003') {
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0x050505,
                        roughness: 1.0,
                        metalness: 0.0,
                    });
                }

                // Gears (1 - 5)
                if (GEAR_SPEEDS[n] !== undefined) {
                    this._gears.push(child);
                    if (!gearMaterial) gearMaterial = child.material;
                }

                // Nuts (ecrou / ecrou1) - move lower
                if (n.toLowerCase().includes('ecrou')) {
                    this._nuts.push(child);
                    child.position.y = this._nutHeight;
                }

                // Wires (glimmer effect)
                if (n.toLowerCase().includes('wire')) {
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0x050505,
                        emissive: 0xd1d100,
                        emissiveIntensity: 50.0,
                    });
                    this._wires = this._wires || [];
                    this._wires.push(child);
                }
            });

            // Sync nut material with gears
            if (gearMaterial) {
                for (const nut of this._nuts) {
                    nut.material = gearMaterial;
                }
            }
        });
    }

    /**
     * Triggers a brief bright glimmer in the nixie tubes.
     */
    triggerSuccessGlimmer() {
        this._successTimer = 0.6;
    }

    update(dt) {
        if (!this._root) return;
        this._time += dt;

        // Animate Gears with individual speeds
        for (const gear of this._gears) {
            const speed = GEAR_SPEEDS[gear.name] || 1.0;
            gear.rotation.y += speed * dt;
        }

        // Glimmer Wires
        if (this._wires) {
            const flicker = 50.0 * (0.8 + 0.2 * Math.sin(this._time * 25));
            for (const wire of this._wires) {
                wire.material.emissiveIntensity = flicker;
            }
        }

        // Success Glimmer (Nixie Tubes)
        if (this._successTimer > 0) {
            this._successTimer -= dt;
            const glow = Math.max(0, this._successTimer / 0.6) * 100.0;
            for (const tube of this._tubes) {
                tube.material.emissiveIntensity = glow;
            }
        } else {
            for (const tube of this._tubes) {
                tube.material.emissiveIntensity = 0;
            }
        }
    }

    dispose() {
        if (this._root) {
            this._scene.remove(this._root);
            this._root.traverse((child) => {
                if (child.isMesh) {
                    child.geometry?.dispose();
                    if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                    else child.material?.dispose();
                }
            });
            this._root = null;
        }
        this._gears = [];
    }
}

