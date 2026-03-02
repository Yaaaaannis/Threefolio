// scene.js — Three.js scene setup, isometric camera, lighting

import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

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

        // HDRI Environment
        new RGBELoader()
            .setPath('/textures/')
            .load('qwantani_moonrise_puresky_1k.hdr', (texture) => {
                texture.mapping = THREE.EquirectangularReflectionMapping;
                this.scene.background = texture;
                this.scene.environment = texture;
            });

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

        // Resize
        window.addEventListener('resize', () => this._onResize());

        // Camera Modes
        this.cameraMode = 'player'; // 'player' or 'topdown'
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
        const fillLight = new THREE.DirectionalLight(0xd0e8ff, 0.4);
        fillLight.position.set(-5, 3, -8);
        this.scene.add(fillLight);

        // Point light above player (moves with player)
        this.playerLight = new THREE.PointLight(0xffedcc, 1.2, 12);
        this.playerLight.position.set(0, 4, 0);
        this.scene.add(this.playerLight);
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
    }

    _onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }
}
