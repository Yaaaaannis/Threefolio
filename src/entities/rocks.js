// rocks.js — Low-poly pebble props placed on the dirt zones of the hub planet.
//
// Placement is driven by the Terrain_splatmap.png.
//   Green channel → used in HubWorld.js:  dirtBlend = smoothstep(0,1, green)
//                   high green = brown dirt surface  ← rocks go HERE
//   Red channel   → used in grass.js:    high red = dense grass  ← avoid
//
// Three InstancedMesh layers share IcosahedronGeometry(detail=0).
// Each instance gets a surface-aligned rotation + random tilt + non-uniform scale
// so the same 20-face icosahedron reads as a completely different rock each time.
//
// Build is async (image load) — meshes are added to the scene once the splatmap
// is ready. No impact on game startup time.

import * as THREE from 'three';

const PLANET_CENTER = new THREE.Vector3(0, -50, 0);
const PLANET_RADIUS = 50;

// UV mapping matching grass.js:
//   U = x / grassSize + 0.5   (grassSize = 60)
//   V = 0.5 - z / grassSize
// Three.js TextureLoader sets flipY=true by default, which means V=0 → top row
// of the original PNG.  So canvas row = floor(V * imgHeight).
const GRASS_SIZE = 60;

function worldToUV(x, z) {
    return {
        u: x / GRASS_SIZE + 0.5,
        v: 0.5 - z / GRASS_SIZE,
    };
}

// [geo_radius, target_count, hex_color]
// Colours match the planet dirt palette (c2: #c07a35 family)
const LAYERS = [
    [0.13,  140, 0xB07848], // small pebbles
    [0.27,   55, 0x8C6035], // medium rocks
    [0.48,   18, 0x6E4A28], // large boulders
];

// Entities to keep clear of (XZ + radius)
const AVOID = [
    { x:   0, z:   0, r:  7  }, // spawn
    { x:   0, z: -10, r:  4  }, // chimney
    { x:   8, z:  16, r:  4  }, // jumprope
    { x:  13, z:  22, r:  5  }, // cassette
    { x:  16, z:  12, r:  4  }, // trampoline
    { x:  18, z:   0, r:  4  }, // high striker
    { x:  -8, z: -15, r:  5  }, // cube wall
    { x: -24, z:   0, r:  5  }, // chess zone
    { x:  -5, z:  -4, r:  3  }, // follower sphere
];

function tooClose(x, z) {
    for (const a of AVOID) {
        const dx = x - a.x, dz = z - a.z;
        if (dx * dx + dz * dz < a.r * a.r) return true;
    }
    return false;
}

// Deterministic pseudo-random [0,1]
function rnd(seed) {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
}

export class Rocks {
    constructor(scene) {
        this._scene  = scene;
        this._meshes = [];
        this._load();
    }

    _load() {
        const img = new Image();
        img.onload = () => {
            // Draw to canvas to access pixel data
            const canvas = document.createElement('canvas');
            canvas.width  = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            this._buildFromSplatmap(imgData, canvas.width, canvas.height);
        };
        img.onerror = () => {
            // Fallback: build without splatmap filter (original ring method)
            console.warn('[Rocks] Splatmap load failed — using ring fallback');
            this._buildFallback();
        };
        img.src = '/textures/Terrain_splatmap.png';
    }

    // Sample green + red channels at a world (x, z) position — [0, 1]
    _sampleChannels(imgData, imgW, imgH, x, z) {
        const { u, v } = worldToUV(x, z);
        const uc  = Math.min(Math.max(u, 0), 0.9999);
        const vc  = Math.min(Math.max(v, 0), 0.9999);
        // flipY=true: V=0 → top of PNG → canvas row 0
        const px  = Math.floor(uc * imgW);
        const py  = Math.floor(vc * imgH);
        const idx = (py * imgW + px) * 4;
        return {
            red:   imgData.data[idx]     / 255,
            green: imgData.data[idx + 1] / 255,
        };
    }

    _buildFromSplatmap(imgData, imgW, imgH) {
        const dummy = new THREE.Object3D();
        const up    = new THREE.Vector3(0, 1, 0);

        for (let li = 0; li < LAYERS.length; li++) {
            const [geoRadius, targetCount, hex] = LAYERS[li];
            const geo = new THREE.IcosahedronGeometry(geoRadius, 0);
            const mat = new THREE.MeshToonMaterial({ color: hex });

            const matrices = [];
            let attempt = 0;

            while (matrices.length < targetCount && attempt < targetCount * 20) {
                attempt++;
                const s = li * 99991 + attempt * 137.7;

                // Candidate position in the playable ring
                const angle = rnd(s) * Math.PI * 2;
                const ring  = 6 + rnd(s + 1) * 22;   // 6 → 28 units from pole
                const x     = Math.cos(angle) * ring;
                const z     = Math.sin(angle) * ring;

                if (tooClose(x, z)) continue;

                // Green channel = dirt blend (HubWorld.js: dirtBlend = smoothstep(0,1, green))
                // Red channel   = grass density (grass.js)
                // Rocks go where dirt is present (green > 0.2) AND grass is sparse (red < 0.5)
                const { red, green } = this._sampleChannels(imgData, imgW, imgH, x, z);
                if (green < 0.2 || red > 0.5) continue;

                // Project onto sphere surface
                const r2 = x * x + z * z;
                const y  = Math.sqrt(Math.max(0, PLANET_RADIUS * PLANET_RADIUS - r2))
                           + PLANET_CENTER.y;

                const worldPos = new THREE.Vector3(x, y, z);
                const norm     = worldPos.clone().sub(PLANET_CENTER).normalize();

                // 1. Align Y-up → surface normal
                const alignQuat = new THREE.Quaternion().setFromUnitVectors(up, norm);

                // 2. Random spin around the normal (facing direction)
                const spinQuat = new THREE.Quaternion().setFromAxisAngle(
                    norm, rnd(s + 2) * Math.PI * 2
                );

                // 3. Random tilt — makes each rock look like a different shape
                const tiltAxis = new THREE.Vector3(
                    rnd(s + 3) - 0.5,
                    rnd(s + 4) - 0.5,
                    rnd(s + 5) - 0.5,
                ).normalize();
                const tiltQuat = new THREE.Quaternion().setFromAxisAngle(
                    tiltAxis,
                    (rnd(s + 6) - 0.5) * Math.PI * 0.55 // ±~50°
                );

                // 4. Non-uniform scale — squish / elongate
                dummy.position.copy(worldPos);
                dummy.quaternion
                    .copy(tiltQuat)
                    .premultiply(spinQuat)
                    .premultiply(alignQuat);
                dummy.scale.set(
                    0.65 + rnd(s + 7) * 0.7,
                    0.55 + rnd(s + 8) * 0.6,
                    0.65 + rnd(s + 9) * 0.7,
                );
                dummy.updateMatrix();
                matrices.push(dummy.matrix.clone());
            }

            if (matrices.length === 0) { geo.dispose(); mat.dispose(); continue; }

            const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
            mesh.castShadow    = true;
            mesh.receiveShadow = true;
            for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
            mesh.instanceMatrix.needsUpdate = true;

            this._scene.add(mesh);
            this._meshes.push({ mesh, geo, mat });
        }
    }

    // Fallback: same as above but without splatmap filtering
    _buildFallback() {
        const dummy = new THREE.Object3D();
        const up    = new THREE.Vector3(0, 1, 0);

        for (let li = 0; li < LAYERS.length; li++) {
            const [geoRadius, targetCount, hex] = LAYERS[li];
            const geo = new THREE.IcosahedronGeometry(geoRadius, 0);
            const mat = new THREE.MeshToonMaterial({ color: hex });
            const matrices = [];
            let attempt = 0;

            while (matrices.length < targetCount && attempt < targetCount * 15) {
                attempt++;
                const s = li * 99991 + attempt * 137.7;
                const angle = rnd(s) * Math.PI * 2;
                const ring  = 8 + rnd(s + 1) * 19;
                const x     = Math.cos(angle) * ring;
                const z     = Math.sin(angle) * ring;
                if (tooClose(x, z)) continue;
                const r2 = x * x + z * z;
                const y  = Math.sqrt(Math.max(0, PLANET_RADIUS * PLANET_RADIUS - r2)) + PLANET_CENTER.y;
                const worldPos = new THREE.Vector3(x, y, z);
                const norm     = worldPos.clone().sub(PLANET_CENTER).normalize();
                const alignQuat = new THREE.Quaternion().setFromUnitVectors(up, norm);
                const spinQuat  = new THREE.Quaternion().setFromAxisAngle(norm, rnd(s + 2) * Math.PI * 2);
                const tiltAxis  = new THREE.Vector3(rnd(s+3)-0.5, rnd(s+4)-0.5, rnd(s+5)-0.5).normalize();
                const tiltQuat  = new THREE.Quaternion().setFromAxisAngle(tiltAxis, (rnd(s+6)-0.5)*Math.PI*0.55);
                dummy.position.copy(worldPos);
                dummy.quaternion.copy(tiltQuat).premultiply(spinQuat).premultiply(alignQuat);
                dummy.scale.set(0.65+rnd(s+7)*0.7, 0.55+rnd(s+8)*0.6, 0.65+rnd(s+9)*0.7);
                dummy.updateMatrix();
                matrices.push(dummy.matrix.clone());
            }

            if (matrices.length === 0) { geo.dispose(); mat.dispose(); continue; }
            const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
            mesh.castShadow = mesh.receiveShadow = true;
            for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
            mesh.instanceMatrix.needsUpdate = true;
            this._scene.add(mesh);
            this._meshes.push({ mesh, geo, mat });
        }
    }

    dispose() {
        for (const { mesh, geo, mat } of this._meshes) {
            this._scene.remove(mesh);
            geo.dispose();
            mat.dispose();
        }
        this._meshes = [];
    }
}
