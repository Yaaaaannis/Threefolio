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
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;

        // Scene
        this.scene = new THREE.Scene();

        // HDRI Environment
        new RGBELoader()
            .setPath('/textures/')
            .load('sunny_park.hdr', (texture) => {
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
     * Update camera and player light to follow player.
     * @param {THREE.Vector3} playerPos
     * @param {number} energy
     * @param {number} dt
     */
    update(playerPos, energy, dt) {
        // Smooth camera follow
        this._camTarget.lerp(playerPos, 0.08);
        this.camera.position.copy(this._camTarget).add(this._camOffset);
        this.camera.lookAt(this._camTarget);

        // Player light follows player
        this.playerLight.position.set(playerPos.x, playerPos.y + 3.5, playerPos.z);
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
