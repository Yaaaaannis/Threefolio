// cassette.js — Decorative cassette model with animated gears and custom materials.
//
// • "vitre"         → smoked transparent glass
// • "Material.003"  → matte black body
// • "1" to "5"      → rotate at different speeds (gears)
// • "ecrou" / "ecrou1" → repositioned lower

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { positionLocal, uniform, float, smoothstep, vec3, mix, mx_noise_float } from 'three/tsl';
// ─────────────────────────────────────────────────────────────────────────────
// Bruno Simon-style toon materials
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a NearestFilter canvas gradient map — gives the discrete cel-shading
 * steps characteristic of Bruno Simon's style.
 * @param {string[]} stops  CSS colour strings, dark → bright
 */
function makeToonGradient(stops) {
    const w      = 256;
    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = 1;
    const ctx  = canvas.getContext('2d');
    const segW = Math.ceil(w / stops.length);
    stops.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect(i * segW, 0, segW, 1);
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    return tex;
}

// Cassette body — noir mat cassette, 3 marches toon
// shadow: noir profond · mid: gris anthracite · highlight: gris clair
const BODY_GRADIENT = makeToonGradient(['#0A0A0A', '#2A2A2A', '#484848']);
const BODY_MATERIAL = new THREE.MeshToonMaterial({
    color:       0x1A1A1A,
    gradientMap: BODY_GRADIENT,
});

// Antenne — patine verdigris (cuivre oxydé vert-bleu)
// shadow: vert très sombre · mid: vert-teal · highlight: teal clair
const ANTENNA_GRADIENT = makeToonGradient(['#142820', '#3A6858', '#72B09A']);
const ANTENNA_MATERIAL = new THREE.MeshToonMaterial({
    color:       0x4A7C6A,   // verdigris classique
    gradientMap: ANTENNA_GRADIENT,
});

// ─────────────────────────────────────────────────────────────────────────────
// 7-Segment display
// ─────────────────────────────────────────────────────────────────────────────
//        a
//       ─ ─
//    f |   | b
//       ─ ─   ← g (middle)
//    e |   | c
//       ─ ─
//        d
const DIGIT_SEGS = {
    0: new Set(['a','b','c','d','e','f']),
    1: new Set(['b','c']),
    2: new Set(['a','b','d','e','g']),
    3: new Set(['a','b','c','d','g']),
    4: new Set(['b','c','f','g']),
    5: new Set(['a','c','d','f','g']),
    6: new Set(['a','c','d','e','f','g']),
    7: new Set(['a','b','c']),
    8: new Set(['a','b','c','d','e','f','g']),
    9: new Set(['a','b','c','d','f','g']),
};

// Segment materials: orange-amber glow (on) vs dark off
const SEG_ON_MAT = new THREE.MeshStandardMaterial({
    color:             0xff8800,
    emissive:          new THREE.Color(0xff6600),
    emissiveIntensity: 4.0,
    roughness:         0.4,
    metalness:         0.0,
    toneMapped:        false,
});
const SEG_OFF_MAT = new THREE.MeshStandardMaterial({
    color:             0x1a0800,
    emissive:          new THREE.Color(0x000000),
    emissiveIntensity: 0.0,
    roughness:         0.8,
    metalness:         0.0,
});

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
        this._failTimer = 0;
        // digit_N_seg_X → mesh   (N = digit position, X = a-g)
        this._segMeshes = {};   // key: "digit_0_seg_a" → THREE.Mesh

        // Copper tube + heat
        this._tube1          = null;
        this._uElec          = uniform(0.0);
        this._uElecTime      = uniform(0.0);
        this._uNoiseScale    = uniform(4.0);
        this._electricTimer  = 0;

        // Boulons snap
        this._boulons = [];  // [{ mesh, vel }]

        // Aiguille rouge
        this._aiguille       = null;  // mesh "red-aiguille"
        this._aiguilleVel    = 0;     // vitesse angulaire courante
        this._aiguilleTarget = 0;     // angle cible

        // Fumée chemine
        this._chemineMesh = null;
        this._blastPuffs  = [];   // [{ mesh, vel, life, maxLife }]
        this._smokeMat    = null;
        this._jumpCount   = 0;

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

    _makeTube1Material() {
        const mat = new MeshStandardNodeMaterial({
            metalness: 0.85,
            roughness: 0.30,
        });

        // FBM chaleur — bruit multi-octave qui dérive lentement avec le temps
        const p  = positionLocal.mul(this._uNoiseScale)
            .add(vec3(float(0), this._uElecTime.mul(float(0.15)), float(0)));
        const n1 = mx_noise_float(p);
        const n2 = mx_noise_float(p.mul(float(2.1)).add(vec3(float(5.3), float(0), float(2.1))));
        const n3 = mx_noise_float(p.mul(float(4.3)).add(vec3(float(1.7), float(3.2), float(0))));
        const fbm = n1.mul(float(0.5)).add(n2.mul(float(0.3))).add(n3.mul(float(0.2)));

        // heat ∈ [0,1] modulé par l'intensité globale
        const heat = fbm.mul(float(1.6)).mul(this._uElec).clamp(float(0), float(1));

        // Dégradé de couleur : cuivre froid → ambre → orange vif → jaune blanc
        const cold = vec3(float(0.72), float(0.45), float(0.20));
        const warm = vec3(float(0.85), float(0.42), float(0.12));
        const hot  = vec3(float(1.00), float(0.55), float(0.05));
        const vhot = vec3(float(1.00), float(0.85), float(0.20));

        const c1 = mix(cold, warm, smoothstep(float(0.00), float(0.35), heat));
        const c2 = mix(c1,   hot,  smoothstep(float(0.35), float(0.65), heat));
        const c3 = mix(c2,   vhot, smoothstep(float(0.65), float(1.00), heat));

        mat.colorNode    = c3;
        mat.emissiveNode = c3.mul(smoothstep(float(0.25), float(1.0), heat).mul(float(4.0)));

        return mat;
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

                // Copper tube with electricity
                if (n === 'tube1') {
                    child.material = this._makeTube1Material();
                    this._tube1 = child;
                    return;
                }

                // Boulons — snap on success
                if (n === 'boulon1' || n === 'boulon2') {
                    this._boulons.push({ mesh: child, vel: 0 });
                }

                // Chemine — bouche de fumée
                if (n === 'chemine') {
                    this._chemineMesh = child;
                }

                // Aiguille rouge — matériau toon rouge + pivot à la base
                if (n === 'red-aiguille') {
                    child.material = new THREE.MeshToonMaterial({ color: 0xE02010 });

                    // Translate la géométrie pour que le bas de l'aiguille
                    // soit à l'origine locale → la rotation se fait autour de la base
                    child.geometry.computeBoundingBox();
                    const bb  = child.geometry.boundingBox;
                    const cx  = (bb.min.x + bb.max.x) * 0.5;
                    const cy  = bb.min.y;   // bas de l'aiguille
                    const cz  = (bb.min.z + bb.max.z) * 0.5;
                    child.geometry.translate(-cx, -cy, -cz);
                    // Compense la position du mesh pour ne pas déplacer visuellement
                    child.position.x += cx;
                    child.position.y += cy;
                    child.position.z += cz;

                    this._aiguille = child;
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

                // Body → warm dark brown cartoon
                if (mName === 'Material.003') {
                    child.material = BODY_MATERIAL;
                }

                // Antenna → dark graphite cartoon (distinct from body)
                if (n.toLowerCase().includes('antenne')) {
                    child.material = ANTENNA_MATERIAL;
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

                // 7-segment display — digit_N_seg_X
                const segMatch = n.match(/^digit_(\d+)_seg_([a-g])$/i);
                if (segMatch) {
                    child.material = SEG_OFF_MAT.clone();
                    child.material.toneMapped = false;
                    this._segMeshes[n.toLowerCase()] = child;
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
     * Smoke burst from the "chemine" mesh — N puffs shot outward.
     */
    triggerSmokeBurst() {
        if (!this._chemineMesh) return;

        // Create shared material once
        if (!this._smokeMat) {
            this._smokeMat = new THREE.MeshStandardMaterial({
                color:       0xBBBBBB,
                transparent: true,
                depthWrite:  false,
                roughness:   1.0,
                metalness:   0.0,
            });
        }

        // World position of the chemine mouth — décalée vers le haut
        const origin = new THREE.Vector3();
        this._chemineMesh.getWorldPosition(origin);
        origin.addScaledVector(this._normal, 0.6);

        // Tangent vectors for spread
        const up = this._normal.clone();
        const ref = Math.abs(up.y) < 0.9
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(1, 0, 0);
        const tA = new THREE.Vector3().crossVectors(up, ref).normalize();
        const tB = new THREE.Vector3().crossVectors(up, tA).normalize();

        const PUFF_COUNT = 9;
        for (let i = 0; i < PUFF_COUNT; i++) {
            const geo  = new THREE.IcosahedronGeometry(0.18 + Math.random() * 0.18, 1);
            const mesh = new THREE.Mesh(geo, this._smokeMat.clone());
            mesh.position.copy(origin);
            this._scene.add(mesh);

            // Velocity: mostly outward (normal) + random lateral spread
            const spread = 0.6;
            const vel = up.clone()
                .multiplyScalar(1.0 + Math.random() * 1.2)
                .addScaledVector(tA, (Math.random() - 0.5) * spread)
                .addScaledVector(tB, (Math.random() - 0.5) * spread);

            this._blastPuffs.push({
                mesh,
                vel,
                life:    0,
                maxLife: 0.8 + Math.random() * 0.5,
            });
        }
    }

    /**
     * Display a number (0-99) on the 7-segment display.
     * digit_0 = units, digit_1 = tens.
     */
    setCount(n) {
        const clamped = Math.max(0, Math.min(99, Math.floor(n)));

        // Déclenche la fumée tous les 5 sauts (et pas au reset à 0)
        if (clamped > 0 && clamped % 5 === 0 && clamped !== this._jumpCount) {
            this.triggerSmokeBurst();
        }
        this._jumpCount = clamped;

        const digits  = [Math.floor(clamped / 10), clamped % 10]; // [digit_0=tens, digit_1=units]

        for (let d = 0; d < 2; d++) {
            const active = DIGIT_SEGS[digits[d]] ?? new Set();
            for (const seg of 'abcdefg') {
                const key  = `digit_${d}_seg_${seg}`;
                const mesh = this._segMeshes[key];
                if (!mesh) continue;
                const on = active.has(seg);
                mesh.material.emissive.setHex(on ? 0xff6600 : 0x000000);
                mesh.material.emissiveIntensity = on ? 4.0 : 0.0;
                mesh.material.color.setHex(on ? 0xff8800 : 0x1a0800);
            }
        }
    }

    /**
     * Flash all segments red then reset display to 00.
     */
    triggerFailFlash() {
        this._failTimer = 0.5; // seconds of red flash
    }

    /**
     * Triggers a brief bright glimmer in the nixie tubes,
     * a traveling electricity pulse on tube1, and a bolt snap.
     */
    triggerSuccessGlimmer() {
        this._successTimer  = 0.6;
        this._electricTimer = 1.0;   // 1 s de traversée
        this._uElec.value   = 1.0;
        this._uElecTime.value = 0.0;

        // Snap angulaire des boulons
        for (const b of this._boulons) {
            b.vel += Math.PI * 1.5 * (Math.random() > 0.5 ? 1 : -1);
        }

        // Nouvel angle cible aléatoire entre -150° et +150°
        this._aiguilleTarget = (Math.random() * 2 - 1) * Math.PI * 0.83;
        this._aiguilleVel   += (this._aiguilleTarget - (this._aiguille?.rotation.z ?? 0)) * 4;
    }

    update(dt) {
        if (!this._root) return;
        this._time += dt;

        // Animate Gears with individual speeds
        for (const gear of this._gears) {
            const speed = GEAR_SPEEDS[gear.name] || 1.0;
            gear.rotation.y += speed * dt;
        }

        // Boulons — décélération avec ressort
        for (const b of this._boulons) {
            if (Math.abs(b.vel) > 0.001) {
                b.mesh.rotation.y += b.vel * dt;
                b.vel *= Math.pow(0.04, dt);
            }
        }

        // Aiguille rouge — ressort vers la cible aléatoire
        if (this._aiguille && Math.abs(this._aiguilleVel) > 0.0005) {
            this._aiguille.rotation.z += this._aiguilleVel * dt;
            const err = this._aiguille.rotation.z - this._aiguilleTarget;
            this._aiguilleVel -= err * 18 * dt;   // spring vers target
            this._aiguilleVel *= Math.pow(0.12, dt); // damping
        }

        // Noise scale du tube : deux sinus incommensurables → jamais en boucle visible
        this._uNoiseScale.value = 3.2
            + Math.sin(this._time * 0.37) * 0.9
            + Math.sin(this._time * 0.71) * 0.4;

        // Chaleur tube1 — monte vite (0.3 s), redescend lentement (1.7 s)
        if (this._electricTimer > 0) {
            this._electricTimer -= dt;
            const progress = 1.0 - Math.max(0, this._electricTimer);
            // _uElecTime dérive lentement pour que le FBM "bouge"
            this._uElecTime.value += dt * 0.4;
            // Intensité : pic à 0.3 s puis décroissance progressive
            if (progress < 0.3) {
                this._uElec.value = progress / 0.3;
            } else {
                this._uElec.value = Math.max(0, 1.0 - (progress - 0.3) / 0.7);
            }
            if (this._electricTimer <= 0) {
                this._uElec.value = 0.0;
            }
        }

        // Blast puffs — fumée chemine
        for (let i = this._blastPuffs.length - 1; i >= 0; i--) {
            const p = this._blastPuffs[i];
            p.life += dt;
            const t = p.life / p.maxLife;

            if (t >= 1.0) {
                this._scene.remove(p.mesh);
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
                this._blastPuffs.splice(i, 1);
                continue;
            }

            // Position: move along velocity, slow down over time
            p.mesh.position.addScaledVector(p.vel, dt * (1 - t * 0.6));

            // Scale: grow fast then shrink
            const s = t < 0.3
                ? t / 0.3
                : 1.0 - (t - 0.3) / 0.7;
            p.mesh.scale.setScalar(Math.max(0.01, s) * (1.2 + p.life * 0.8));

            // Opacity: fade out in second half
            p.mesh.material.opacity = t < 0.4 ? 1.0 : 1.0 - (t - 0.4) / 0.6;
        }

        // Glimmer Wires
        if (this._wires) {
            const flicker = 50.0 * (0.8 + 0.2 * Math.sin(this._time * 25));
            for (const wire of this._wires) {
                wire.material.emissiveIntensity = flicker;
            }
        }

        // Fail Flash (segments → red, then reset to 00)
        if (this._failTimer > 0) {
            this._failTimer -= dt;
            // Pulse: fast flicker between bright red and dim red
            const pulse = 0.5 + 0.5 * Math.sin(this._time * 40);
            const intensity = 3.0 + pulse * 3.0;
            for (const mesh of Object.values(this._segMeshes)) {
                mesh.material.emissive.setHex(0xff0000);
                mesh.material.emissiveIntensity = intensity;
                mesh.material.color.setHex(0xff2200);
            }
            if (this._failTimer <= 0) {
                this.setCount(0); // reset to 00 after flash
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
        for (const p of this._blastPuffs) {
            this._scene.remove(p.mesh);
            p.mesh.geometry.dispose();
            p.mesh.material.dispose();
        }
        this._blastPuffs = [];
        this._smokeMat?.dispose();
        this._smokeMat = null;

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

