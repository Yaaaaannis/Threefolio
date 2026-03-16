// scene.js — Three.js scene setup, isometric camera, lighting

import * as THREE from 'three';
import { WebGPURenderer, PostProcessing, MeshBasicNodeMaterial } from 'three/webgpu';
import { pass, uniform, positionLocal, vec3, mix, smoothstep } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const ISO_ANGLE = Math.PI / 4;      // 45° tilt from horizontal
const CAM_DISTANCE = 18;
const CAM_HEIGHT = 16;

export class SceneSetup {
    constructor(canvas) {
        // WebGPU Renderer
        this.renderer = new WebGPURenderer({ canvas, antialias: true, forceWebGL: false });

        // Mobile performance: limit pixel ratio further on touch devices
        const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));

        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;

        // Scene
        this.scene = new THREE.Scene();

        // Camera — top-biased isometric perspective
        this.camera = new THREE.PerspectiveCamera(
            45,
            window.innerWidth / window.innerHeight,
            0.1,
            200
        );
        this._camOffset = new THREE.Vector3(
            CAM_DISTANCE * Math.sin(ISO_ANGLE),
            CAM_HEIGHT,
            CAM_DISTANCE * Math.cos(ISO_ANGLE)
        );
        this.camera.position.copy(this._camOffset);
        this.camera.lookAt(0, 0, 0);

        this._camTarget = new THREE.Vector3();

        // Lights
        this._setupLights();

        // Procedural sky (no HDRI file needed)
        this._buildSky();

        // Resize
        window.addEventListener('resize', () => this._onResize());

        // Camera Modes
        this.cameraMode = 'player'; // 'player' or 'topdown'

        // Day/Night Cycle
        this.timeOfDay = 1.0; // 1 = Day, 0 = Night
        this.targetTimeOfDay = 1.0;

        // Post-processing pipeline (bloom, etc.) — null when inactive
        this._postProcessing = null;

        /** @type {import('../entities/lamp.js').Lamp | null} */
        this.lamp = null;

        /** @type {import('../entities/chimney.js').Chimney | null} */
        this.chimney = null;
    }

    _buildSky() {
        // Gradient sky sphere — BackSide so camera sees it from inside
        this._uSkyDay     = uniform(1.0);

        // Day & night colors — all uniforms so the GUI can tweak them live
        this._uDayZenith    = uniform(new THREE.Color('#ccd4db'));
        this._uDayHorizon   = uniform(new THREE.Color('#1d6490'));
        this._uNightZenith  = uniform(new THREE.Color('#0d1a3d'));
        this._uNightHorizon = uniform(new THREE.Color('#1a3d6e'));
        this._uSkyGradient  = uniform(0.27);

        const t      = positionLocal.normalize().y.mul(0.5).add(0.5); // 0=bottom, 1=top
        const zenith  = mix(this._uNightZenith,  this._uDayZenith,  this._uSkyDay);
        const horizon = mix(this._uNightHorizon, this._uDayHorizon, this._uSkyDay);

        const mat = new MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
        mat.colorNode = mix(horizon, zenith, smoothstep(this._uSkyGradient, 1.0, t));

        const mesh = new THREE.Mesh(new THREE.SphereGeometry(160, 32, 24), mat);
        mesh.renderOrder = -1;
        mesh.frustumCulled = false;
        this.scene.add(mesh);
    }

    _setupLights() {
        // Ambient
        this.ambientLight = new THREE.AmbientLight(0xfff8f0, 0.7);
        this.scene.add(this.ambientLight);

        // Main directional (sun-like, from above-side)
        this.dirLight = new THREE.DirectionalLight(0xfffbe6, 1.5);
        this.dirLight.position.set(8, 20, 10);
        this.dirLight.castShadow = true;
        this.dirLight.shadow.mapSize.set(2048, 2048);
        this.dirLight.shadow.camera.near = 0.5;
        this.dirLight.shadow.camera.far = 80;
        this.dirLight.shadow.camera.left = -20;
        this.dirLight.shadow.camera.right = 20;
        this.dirLight.shadow.camera.top = 20;
        this.dirLight.shadow.camera.bottom = -20;
        this.dirLight.shadow.bias = -0.001;
        this.scene.add(this.dirLight);

        // Soft fill from below-opposite
        this.fillLight = new THREE.DirectionalLight(0xd0e8ff, 0.4);
        this.fillLight.position.set(-5, 3, -8);
        this.scene.add(this.fillLight);

        // Point light above player (moves with player)
        this.playerLight = new THREE.PointLight(0xffedcc, 1.2, 12);
        this.playerLight.position.set(0, 4, 0);
        this.scene.add(this.playerLight);

        // Day vs Night configuration
        this.dayColors = {
            ambient: new THREE.Color(0xfff8f0),
            dir: new THREE.Color(0xfffbe6),
            fill: new THREE.Color(0xd0e8ff),
            ambientInt: 0.7,
            dirInt: 1.5,
            fillInt: 0.4,
            exposure: 1.1
        };
        this.nightColors = {
            ambient: new THREE.Color(0x202b3a), // deep moonlight ambient
            dir: new THREE.Color(0x5a7abf), // pale blue moon
            fill: new THREE.Color(0x0a101d), // very dark shadows
            ambientInt: 0.15,
            dirInt: 0.4,
            fillInt: 0.05,
            exposure: 0.3                     // dim HDR background
        };
    }

    /** Set target time (1.0 = day, 0.0 = night) */
    setTimeOfDay(timeVal) {
        this.targetTimeOfDay = Math.max(0, Math.min(1, timeVal));
    }

    /**
     * @param {'player'|'topdown'} mode
     */
    setCameraMode(mode) {
        this.cameraMode = mode;
    }

    /**
     * Update camera and player light to follow a target.
     * @param {THREE.Vector3} targetPos
     * @param {number} energy
     * @param {number} dt
     */
    update(targetPos, energy, dt) {
        // Smooth camera follow
        this._camTarget.lerp(targetPos, 0.08);

        // Spherical surface normal at camera target
        const planetCenter = new THREE.Vector3(0, -50, 0); // Match ROOM PLANET_CENTER
        const upNormal = new THREE.Vector3().subVectors(this._camTarget, planetCenter).normalize();

        // Align camera Up vector to surface normal
        this.camera.up.copy(upNormal);

        // Calculate offset rotated to match surface normal
        const surfaceQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), upNormal);

        if (this.cameraMode === 'player') {
            const rotatedOffset = this._camOffset.clone().applyQuaternion(surfaceQuat);
            this.camera.position.copy(this._camTarget).add(rotatedOffset);
            this.camera.lookAt(this._camTarget);
        } else if (this.cameraMode === 'topdown') {
            // Place camera directly above target (along surface normal)
            const topDownOffset = upNormal.clone().multiplyScalar(30); // High up
            this.camera.position.copy(this._camTarget).add(topDownOffset);

            // Look "straight down" relative to the normal
            const lookTarget = this._camTarget.clone();
            // Offset look target slightly to avoid singularities with Up vector
            const forwardTangent = new THREE.Vector3(0, 0, -1).applyQuaternion(surfaceQuat);
            lookTarget.add(forwardTangent.multiplyScalar(0.01));

            this.camera.lookAt(lookTarget);
        }

        // Light follows target
        this.playerLight.position.set(targetPos.x, targetPos.y + 3.5, targetPos.z);

        // Lerp Day/Night
        if (Math.abs(this.targetTimeOfDay - this.timeOfDay) > 0.001) {
            this.timeOfDay += (this.targetTimeOfDay - this.timeOfDay) * Math.min(1, dt * 1.5);

            this.ambientLight.color.lerpColors(this.nightColors.ambient, this.dayColors.ambient, this.timeOfDay);
            this.dirLight.color.lerpColors(this.nightColors.dir, this.dayColors.dir, this.timeOfDay);
            this.fillLight.color.lerpColors(this.nightColors.fill, this.dayColors.fill, this.timeOfDay);

            this.ambientLight.intensity = THREE.MathUtils.lerp(this.nightColors.ambientInt, this.dayColors.ambientInt, this.timeOfDay);
            this.dirLight.intensity = THREE.MathUtils.lerp(this.nightColors.dirInt, this.dayColors.dirInt, this.timeOfDay);
            this.fillLight.intensity = THREE.MathUtils.lerp(this.nightColors.fillInt, this.dayColors.fillInt, this.timeOfDay);

            this.renderer.toneMappingExposure = THREE.MathUtils.lerp(this.nightColors.exposure, this.dayColors.exposure, this.timeOfDay);
            this._uSkyDay.value = this.timeOfDay;
        }
    }

    _onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    render() {
        if (this._postProcessing) {
            this._postProcessing.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    /**
     * Enable the bloom post-processing pipeline.
     * @param {{ strength?: number, radius?: number, threshold?: number }} opts
     */
    setupPostProcessing({ strength = 0.35, radius = 0.4, threshold = 0.85 } = {}) {
        if (this._postProcessing) return;
        const pp = new PostProcessing(this.renderer);
        const scenePass = pass(this.scene, this.camera);
        const scenePassColor = scenePass.getTextureNode('output');
        const bloomPass = bloom(scenePassColor, strength, radius, threshold);
        pp.outputNode = scenePassColor.add(bloomPass);
        this._postProcessing = pp;
        this._bloomNode = bloomPass; // keep ref for live GUI editing
    }

    /** Live-editable BloomNode (null when post-processing is off). */
    get bloomNode() { return this._bloomNode; }

    /** Disable the bloom post-processing pipeline and return to direct rendering. */
    teardownPostProcessing() {
        if (!this._postProcessing) return;
        this._postProcessing = null;
        this._bloomNode = null;
    }
}
