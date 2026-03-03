// player.js — Player mesh, top-down controller, Rapier physics

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const SPEED = 7;          // units/s
const JUMP_FORCE = 6;     // increased for higher gravity
const KEYS = {
    ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false,
    Space: false, KeyE: false, Enter: false, KeyF: false
};

window.addEventListener('keydown', e => { if (e.code in KEYS) { KEYS[e.code] = true; } });
window.addEventListener('keyup', e => { if (e.code in KEYS) { KEYS[e.code] = false; } });

export class Player {
    /**
     * @param {THREE.Scene} scene
     * @param {import('@dimforge/rapier3d-compat')} RAPIER
     * @param {import('@dimforge/rapier3d-compat').World} world
     */
    constructor(scene, RAPIER, world) {
        this.RAPIER = RAPIER;
        this.world = world;
        this.scene = scene;
        this.gravityMultiplier = 1.0;
        this.mesh = new THREE.Group();
        scene.add(this.mesh);

        // --- Loader setup ---
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

        const loader = new GLTFLoader();
        loader.setDRACOLoader(dracoLoader);

        this.mixer = null;
        this.animations = {};
        this.currentAction = null;

        loader.load('/models/soldierdraco.glb', (gltf) => {
            const model = gltf.scene;
            model.scale.set(1.2, 1.2, 1.2);
            model.position.y = -0.4; // Align with ball bottom

            // Shadows
            model.traverse(node => {
                if (node.isMesh) {
                    node.castShadow = true;
                    node.receiveShadow = true;
                }
            });

            this.mesh.add(model);

            // Mixer & Animations
            this.mixer = new THREE.AnimationMixer(model);
            console.log('Soldier animations:', gltf.animations.map(a => a.name));
            gltf.animations.forEach(clip => {
                this.animations[clip.name] = this.mixer.clipAction(clip);
            });

            // Set initial state
            const mainClip = this.animations['Armature|mixamo.com|Layer0'];
            if (mainClip) {
                this.currentAction = mainClip;
                this.currentAction.play();
            } else if (this.animations['Idle']) {
                this.currentAction = this.animations['Idle'];
                this.currentAction.play();
            }
        });

        // --- Rapier rigid body ---
        const rbDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(0, 1.5, 0)
            .setLinearDamping(1.5)
            .lockRotations(); // no tumbling
        this.rigidBody = world.createRigidBody(rbDesc);

        // Ball collider (radius = 0.4)
        const colDesc = RAPIER.ColliderDesc.ball(0.4).setRestitution(0);
        world.createCollider(colDesc, this.rigidBody);

        this.currentHeading = 0;

        this.prevPosition = new THREE.Vector3();
        this.speed = 0;
        this._onGround = false;
        this._jumpCooldown = 0;

        // Wall jump state
        this._touchingWall = false;
        this._wallNormal = new THREE.Vector3();
        this._wallJumpCooldown = 0;
        const WALL_JUMP_FORCE = 5;
        this._WALL_JUMP_FORCE = WALL_JUMP_FORCE;

        // Prevent jump while Space is held continuously
        this._spaceReady = true;  // true means Space has been released since last jump
        this._punchCooldown = 0;
        this._punchAnimation = 0;

        // Possession state
        this.isFrozen = false;
    }

    /**
     * @param {number} dt
     */
    update(dt, camera) {
        this._jumpCooldown = Math.max(0, this._jumpCooldown - dt);

        const pos = this.rigidBody.translation();
        const vel = this.rigidBody.linvel();

        const planetCenter = new THREE.Vector3(0, -50, 0); // Must match ROOM PLANET_CENTER
        const pos3 = new THREE.Vector3(pos.x, pos.y, pos.z);
        const upNormal = new THREE.Vector3().subVectors(pos3, planetCenter).normalize();

        // Apply spherical gravity (-20 units/s^2), scaled by multiplier
        const gravityForce = upNormal.clone().multiplyScalar(-20 * this.gravityMultiplier * dt);
        this.rigidBody.applyImpulse({ x: gravityForce.x, y: gravityForce.y, z: gravityForce.z }, true);

        // Robust grounded check using short raycast towards planet center
        const rayOriginPos = pos3.clone().sub(upNormal.clone().multiplyScalar(0.35)); // Start just inside the ball
        const rayDir = { x: -upNormal.x, y: -upNormal.y, z: -upNormal.z };
        this._onGround = false;

        const ray = new this.RAPIER.Ray(rayOriginPos, rayDir);
        const hit = this.world.castRay(ray, 0.15, true);

        const vel3 = new THREE.Vector3(vel.x, vel.y, vel.z);
        const upVel = vel3.dot(upNormal);

        if (hit !== null && Math.abs(upVel) < 1.0) {
            this._onGround = true;
        }

        // Build move direction in local tangent plane
        let dx = 0, dz = 0;
        if (!this.isFrozen) {
            if (KEYS.ArrowUp) dz -= 1;
            if (KEYS.ArrowDown) dz += 1;
            if (KEYS.ArrowLeft) dx -= 1;
            if (KEYS.ArrowRight) dx += 1;
        }

        let len = Math.sqrt(dx * dx + dz * dz);
        if (len > 0) { dx /= len; dz /= len; }

        // Camera-relative movement axes projected onto the surface tangent plane
        // This makes controls consistent regardless of where you are on the sphere
        const camForwardWorld = new THREE.Vector3();
        camera.getWorldDirection(camForwardWorld);

        // Project camera forward onto tangent plane (remove the upNormal component)
        const camForwardTangent = camForwardWorld.clone()
            .sub(upNormal.clone().multiplyScalar(camForwardWorld.dot(upNormal)))
            .normalize();
        if (camForwardTangent.lengthSq() < 0.001) camForwardTangent.set(1, 0, 0); // Pole fallback

        // Camera right = forward × up (in right-handed system, this gives screen-right)
        const camRightTangent = new THREE.Vector3().crossVectors(camForwardTangent, upNormal).normalize();

        // Map arrow keys to camera-relative directions:
        // ArrowUp   → move toward the forward horizon (away from camera)
        // ArrowDown → move toward camera
        // ArrowLeft/Right → move along camera right
        const moveDir = new THREE.Vector3()
            .addScaledVector(camRightTangent, dx)    // ArrowRight (dx=1) → screen right
            .addScaledVector(camForwardTangent, -dz); // ArrowUp (dz=-1) → -(-1)=+1 → into screen

        if (moveDir.lengthSq() > 0) moveDir.normalize();

        const targetVel = moveDir.clone().multiplyScalar(SPEED);
        const currentTangentVel = vel3.clone().sub(upNormal.clone().multiplyScalar(vel3.dot(upNormal)));

        // Apply horizontal impulse
        const velDiff = targetVel.clone().sub(currentTangentVel);
        const imp = velDiff.multiplyScalar(0.45);
        this.rigidBody.applyImpulse({ x: imp.x, y: imp.y, z: imp.z }, true);

        // Wall jump is temporarily disabled for spherical world refactor

        // Track if Space was released since last jump
        if (!KEYS.Space) this._spaceReady = true;

        // Regular jump
        if (!this.isFrozen && KEYS.Space && this._spaceReady && this._onGround && this._jumpCooldown === 0) {
            const jumpImp = upNormal.clone().multiplyScalar(JUMP_FORCE);
            this.rigidBody.applyImpulse({ x: jumpImp.x, y: jumpImp.y, z: jumpImp.z }, true);
            this._jumpCooldown = 0.35;
            this._spaceReady = false;
        }

        // Handle Punch (KeyF)
        if (!this.isFrozen && KEYS.KeyF && this._punchCooldown <= 0) {
            this._punchCooldown = 0.5; // Half second cooldown
            this._punchAnimation = 0.15; // Animation duration

            // Calculate a point just in front of the player (where the fist is)
            const facingAngle = this.mesh.rotation.y;
            const forwardDir = new THREE.Vector3(Math.sin(facingAngle), 0, Math.cos(facingAngle));

            const punchOrigin = new THREE.Vector3().copy(pos).add(forwardDir.clone().multiplyScalar(0.6));
            punchOrigin.y += 0.5; // Roughly chest height

            // Check for hits using a short shape cast (sphere)
            const shapeRot = { x: 0, y: 0, z: 0, w: 1 };
            const shapeVel = { x: forwardDir.x, y: 0, z: forwardDir.z };
            const shape = new this.RAPIER.Ball(0.4); // 0.4 radius hit area

            // Filter: only hit dynamic bodies (the cubes)
            // Interaction groups: we could set up specific bits, but for now we'll just check if it's dynamic after hit
            // IMPORTANT: Never hit the player itself!
            const hit = this.world.castShape(
                punchOrigin, shapeRot, shapeVel, shape,
                0.5, // Target distance
                0.1, // Max Toi (very short cast)
                true, // Stop at penetration
                undefined, undefined, undefined,
                this.rigidBody // Exclude the player's own rigid body!
            );

            if (hit !== null) {
                const hitCollider = this.world.getCollider(hit.colliderHandle);
                const hitBody = hitCollider.parent();

                if (hitBody && hitBody.isDynamic()) {
                    // Calculate hit point for particle emission
                    const hitPos = hitBody.translation();

                    // Apply extremely heavy impulse away from player, significantly upwards
                    const impulseAmount = 20.0;
                    const impulse = {
                        x: forwardDir.x * impulseAmount,
                        y: 0, // High Pop up
                        z: forwardDir.z * impulseAmount
                    };

                    hitBody.applyImpulse(impulse, true); // Use center impulse to avoid weird torque/point-reaction bugs

                    // Trigger particles exactly at the center of the hit object
                    if (this.particleSystem && this.timeGetter) {
                        // Pass null for normal to trigger the new spherical explosion
                        this.particleSystem.emit(
                            new THREE.Vector3(hitPos.x, hitPos.y, hitPos.z),
                            null,
                            150, // Massive amount of particles 
                            this.timeGetter()
                        );
                    }
                }
            }
        }

        // Handle Punch (KeyF)
        if (!this.isFrozen && KEYS.KeyF && this._punchCooldown <= 0) {
            this._punchCooldown = 0.5; // Half second cooldown

            // Calculate a point just in front of the player
            const facingAngle = this.mesh.rotation.y;
            const forwardDir = new THREE.Vector3(Math.sin(facingAngle), 0, Math.cos(facingAngle));

            const punchOrigin = new THREE.Vector3().copy(pos).add(forwardDir.clone().multiplyScalar(0.6));
            punchOrigin.y += 0.5; // Roughly chest height

            // Check for hits using a short shape cast (sphere)
            const shapeRot = { x: 0, y: 0, z: 0, w: 1 };
            const shapeVel = { x: forwardDir.x, y: 0, z: forwardDir.z };
            const shape = new this.RAPIER.Ball(0.4); // 0.4 radius hit area

            const hit = this.world.castShape(
                punchOrigin, shapeRot, shapeVel, shape,
                0.5, // Target distance
                0.1, // Max Toi (very short cast)
                true, // Stop at penetration
                undefined, undefined, undefined,
                this.rigidBody // Exclude the player's own rigid body!
            );

            if (hit !== null) {
                const hitCollider = this.world.getCollider(hit.colliderHandle);
                const hitBody = hitCollider.parent();

                if (hitBody && hitBody.isDynamic()) {
                    const hitPos = hitBody.translation();
                    const impulseAmount = 20.0;
                    const impulse = {
                        x: forwardDir.x * impulseAmount,
                        y: 0,
                        z: forwardDir.z * impulseAmount
                    };

                    hitBody.applyImpulse(impulse, true);

                    if (this.particleSystem && this.timeGetter) {
                        this.particleSystem.emit(
                            new THREE.Vector3(hitPos.x, hitPos.y, hitPos.z),
                            null,
                            150,
                            this.timeGetter()
                        );
                    }
                }
            }
        }

        // Update punch cooldown (no mesh animation needed)
        if (this._punchCooldown > 0) {
            this._punchCooldown -= dt;
        }

        // Update animations
        if (this.mixer) {
            this.mixer.update(dt);

            const mainClip = this.animations['Armature|mixamo.com|Layer0'];
            if (mainClip) {
                // If the model has only one clip (like a Run/Idle blend or just one action)
                // we scale the timeScale based on whether we are moving
                const isMoving = len > 0.1;
                const targetTimeScale = isMoving ? 1.0 : 0.0;

                // Smoothly interpolate timeScale to avoid jerky transitions
                mainClip.setEffectiveTimeScale(THREE.MathUtils.lerp(mainClip.getEffectiveTimeScale(), targetTimeScale, 0.1));

                if (!mainClip.isRunning()) mainClip.play();
            } else {
                // Fallback for Idle/Run state machine if they exist
                const isMoving = len > 0.1;
                const targetAction = isMoving ? this.animations['Run'] : this.animations['Idle'];

                if (targetAction && this.currentAction !== targetAction) {
                    const prevAction = this.currentAction;
                    this.currentAction = targetAction;

                    if (prevAction) prevAction.fadeOut(0.2);
                    this.currentAction.reset().fadeIn(0.2).play();
                }
            }
        }

        // Manual ghost spawn triggering
        this.wantsToSpawnGhost = false;
        if (!this.isFrozen && KEYS.KeyE) {
            this.wantsToSpawnGhost = true;
            KEYS.KeyE = false; // "Consume" the keypress so it only triggers once per press
        }

        // Sync mesh position
        const newPos = this.rigidBody.translation();
        this.mesh.position.set(newPos.x, newPos.y, newPos.z);

        // Rotate mesh to align with planet normal (reuse upNormal from top of update)
        // Base quaternion to stand upright relative to the surface
        const uprightQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), upNormal);

        // Calculate heading: face the direction of movement
        if (len > 0) {
            // Use camRightTangent and camForwardTangent as the reference frame for heading
            const camForwardWorld2 = new THREE.Vector3();
            camera.getWorldDirection(camForwardWorld2);
            const camFwd = camForwardWorld2.clone()
                .sub(upNormal.clone().multiplyScalar(camForwardWorld2.dot(upNormal)))
                .normalize();
            if (camFwd.lengthSq() < 0.001) camFwd.set(1, 0, 0);
            const camRight2 = new THREE.Vector3().crossVectors(camFwd, upNormal).normalize();

            // Angle of moveDir relative to camera forward, around local up axis
            const moveAngle = Math.atan2(moveDir.dot(camRight2), moveDir.dot(camFwd));

            // Smooth heading interpolation with wrapping
            let diff = moveAngle - this.currentHeading;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            this.currentHeading += diff * 0.15;
            while (this.currentHeading < -Math.PI) this.currentHeading += Math.PI * 2;
            while (this.currentHeading > Math.PI) this.currentHeading -= Math.PI * 2;
        }

        // Apply heading rotation around local Y axis
        const headingQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.currentHeading);

        // Final rotation = uprightQuat * headingQuat
        this.mesh.quaternion.copy(uprightQuat).multiply(headingQuat);

        // Compute speed for state manager
        const prev = this.prevPosition;
        const dist = Math.sqrt(
            (newPos.x - prev.x) ** 2 + (newPos.y - prev.y) ** 2 + (newPos.z - prev.z) ** 2
        );
        this.speed = dist / Math.max(dt, 0.001);
        this.prevPosition.set(newPos.x, newPos.y, newPos.z);
    }

    getPosition() {
        const t = this.rigidBody.translation();
        return new THREE.Vector3(t.x, t.y, t.z);
    }
}
