// HubWorld.js — The main Hub/Spawn planet (the current room content).
// Splatmap-textured sphere + grass + chess + football + cubewall + portals to 3 worlds.

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, mix, texture, vec2, positionWorld, float, smoothstep, normalize, dot, max, floor, vec3, clamp } from 'three/tsl';
import { BaseWorld } from './BaseWorld.js';
import { Grass } from '../grass.js';
import { PortalZone } from '../portalZone.js';
import { SpawnerZone } from '../spawnerZone.js';
import { FollowerSphere } from '../../entities/followerSphere.js';
import { Antenna } from '../../entities/antenna.js';
import { SocialZone } from '../socialZone.js';
import { Football } from '../../entities/football.js';
import { StartPlane } from '../../entities/startPlane.js';


export class HubWorld extends BaseWorld {
    constructor(onPortal) {
        super();
        this._onPortal = onPortal; // (worldKey) => opens GalaxyMenu
        this._portals = [];
        this._grass = null;
        this._football = null;
        this._spawnerZone = null;
        this._follower = null;
        this._antenna = null;
        this._socialZone = null;
        this._startPlane = null;
    }

    get planetCenter() { return new THREE.Vector3(0, -50, 0); }
    get planetRadius() { return 50; }
    get spawnPoint() { return new THREE.Vector3(0, 1.5, 0); }

    load(scene, RAPIER, rapierWorld) {
        super.load(scene, RAPIER, rapierWorld);

        const PC = this.planetCenter;
        const PR = this.planetRadius;

        // ── Cartoon / cel-shading floor material ──────────────────────────
        // Splatmap still drives grass/dirt blending
        const splatmapTexture = new THREE.TextureLoader().load('/textures/newmap.png');
        const grassSize = 60.0;
        const uvX = positionWorld.x.div(grassSize).add(0.5);
        const uvY = float(0.5).sub(positionWorld.z.div(grassSize));
        const splatUV = vec2(uvX, uvY);
        const splatColor = texture(splatmapTexture, splatUV);
        const dirtBlend = smoothstep(0.0, 1.0, splatColor.g);

        // 1. Bright saturated cartoon grass & dirt base colors
        const grassColor = color(0x5ecf3e);   // vivid cartoon green
        const dirtColor = color(0xc07a35);   // warm cartoon dirt
        const surfaceColor = mix(grassColor, dirtColor, dirtBlend);

        // 2. Quantize diffuse into 3 steps:  shadow / mid / lit
        //    Sun direction (matches scene directional light roughly)
        const sunDir = normalize(vec3(0.4, 1.0, 0.5));
        // Sphere normal at each fragment = normalize(positionWorld - planetCenter)
        const toSurface = normalize(positionWorld.sub(vec3(PC.x, PC.y, PC.z)));
        const NdotL = clamp(dot(toSurface, sunDir), 0.0, 1.0);
        // 3 hard bands: 0-0.3 = shadow, 0.3-0.65 = mid, 0.65-1 = lit
        const band = float(0);
        const toon = clamp(
            smoothstep(0.0, 0.05, NdotL).mul(0.45)          // shadow → mid edge
                .add(smoothstep(0.3, 0.35, NdotL).mul(0.35))    // mid → lit edge
                .add(smoothstep(0.65, 0.70, NdotL).mul(0.20)),  // lit → bright edge
            0.0, 1.0
        );

        // 3. Dark shadow color + lit surface color blended by toon factor
        const shadowColor = surfaceColor.mul(float(0.28));
        const rimColor = surfaceColor.mul(float(1.15));   // slight rim boost
        const finalColor = mix(shadowColor, rimColor, toon);

        const floorMat = new MeshStandardNodeMaterial({
            colorNode: finalColor,
            roughness: 1.0,
            metalness: 0.0,
            envMapIntensity: 0.0,   // disable env reflections for flat cartoon look
        });
        const floorMesh = new THREE.Mesh(new THREE.SphereGeometry(PR, 128, 128), floorMat);
        floorMesh.position.copy(PC);
        floorMesh.receiveShadow = true;
        this._track(floorMesh);

        // Rapier planet collider
        const floorBody = this._trackBody(rapierWorld.createRigidBody(
            RAPIER.RigidBodyDesc.fixed().setTranslation(PC.x, PC.y, PC.z)
        ));
        rapierWorld.createCollider(RAPIER.ColliderDesc.ball(PR), floorBody);

        // ── Grass ─────────────────────────────────────────────────────────
        this._grass = new Grass(scene);

        // ── Football ──────────────────────────────────────────────────────
        this._football = new Football(scene, RAPIER, rapierWorld);

        // ── Hub-specific zones ────────────────────────────────────────────
        this._spawnerZone = new SpawnerZone(scene, RAPIER, rapierWorld);
        this._follower = new FollowerSphere(scene, new THREE.Vector3(-8, 5, -8));

        // ── Antenna ── placed at hub spawn (top of sphere, surface normal = Y up) ─
        const antennaPos = new THREE.Vector3(-14, -2.9, -10);
        // Surface normal = direction from planet center to antenna position
        const antennaSurfaceNormal = new THREE.Vector3()
            .subVectors(antennaPos, new THREE.Vector3(0, -50, 0))
            .normalize();
        const uprightQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), antennaSurfaceNormal);
        const spinQuat = new THREE.Quaternion().setFromAxisAngle(antennaSurfaceNormal, Math.PI / 6); // 30° around surface normal
        const antennaQuat = spinQuat.multiply(uprightQuat);
        this._antenna = new Antenna(scene, antennaPos, 2.5, Math.PI * 0.8, antennaQuat, RAPIER, rapierWorld);

        // ── Social Media Zone ── in front of the antenna ──────────────────
        // Offset from antenna position along a tangent so it sits ~3 units in front
        const antennaWorldPos = new THREE.Vector3(-12, -1.7, -2);
        const socialNormal = new THREE.Vector3().subVectors(antennaWorldPos, PC).normalize();
        // "Forward" tangent relative to the antenna position (along -Z world projected on surface)
        const tangent = new THREE.Vector3(0, 0, -1);
        tangent.sub(socialNormal.clone().multiplyScalar(tangent.dot(socialNormal))).normalize();
        const socialPos = antennaWorldPos.clone().addScaledVector(tangent, 3.5).addScaledVector(socialNormal, 0.05);
        this._socialZone = new SocialZone(scene, socialPos);


        // ── Start Plane ── near spawn ──────────────────────────────────────
        console.log('[HubWorld] About to create StartPlane');
        this._startPlane = new StartPlane(scene, new THREE.Vector3(0, 0.5, 0), 1);
        console.log('[HubWorld] StartPlane created');

        const portalDir = new THREE.Vector3(0, 50, 4).normalize();
        const portalPt = PC.clone().addScaledVector(portalDir, PR + 0.05);
        const portal = new PortalZone(
            scene, PC, portalPt, '✦ Travel', 0xaaddff,
            () => this._onPortal('hub')
        );
        this._portals.push(portal);
    }

    update(dt, playerPos, time) {
        const TIMESTEP = 1 / 60;
        this._football?.update(TIMESTEP);
        if (playerPos) {
            this._grass?.update(time, playerPos, true, []);
            this._spawnerZone?.update(playerPos);
            this._follower?.update(time, playerPos, dt ?? 0.016);
            this._antenna?.update(dt ?? 0.016);
            this._socialZone?.update(dt ?? 0.016, playerPos, time);
            this._startPlane?.update(dt ?? 0.016, playerPos);
            for (const p of this._portals) p.update(playerPos, time);
        }
    }

    dispose() {
        this._portals.forEach(p => p.dispose());
        this._portals = [];
        // Grass: not BaseWorld-tracked, remove manually
        if (this._grass?.mesh) {
            this.scene.remove(this._grass.mesh);
            this._grass.mesh.geometry?.dispose();
            this._grass.mesh.material?.dispose();
        }
        // SpawnerZone ring
        if (this._spawnerZone?.ringMesh) {
            this.scene.remove(this._spawnerZone.ringMesh);
            this._spawnerZone.ringMesh.geometry?.dispose();
            this._spawnerZone.ringMesh.material?.dispose();
        }
        // Football
        this._football?.dispose();
        // Follower sphere
        if (this._follower?.mesh) {
            this.scene.remove(this._follower.mesh);
            this._follower.mesh.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
        }
        // Antenna
        this._antenna?.dispose();
        // Social Zone
        this._socialZone?.dispose();
        // Start Plane
        this._startPlane?.dispose();
        super.dispose();
    }
}
