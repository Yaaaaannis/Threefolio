// debugGui.js — lil-gui debug panel for post-processing & scene tweaks.
// Only visible in dev (import this from main.js; remove for production).

import GUI from 'lil-gui';
import * as THREE from 'three';

export class DebugGui {
    /**
     * @param {import('./scene.js').SceneSetup} sceneSetup
     */
    constructor(sceneSetup) {
        this._sceneSetup = sceneSetup;

        this._gui = new GUI({ title: '🎛 Debug', width: 280 });
        this._gui.domElement.style.position = 'fixed';
        this._gui.domElement.style.top = '10px';
        this._gui.domElement.style.right = '10px';
        this._gui.domElement.style.zIndex = '99999';

        this._state = {
            // Bloom
            bloomEnabled: true,
            bloomStrength: 0.3,
            bloomRadius: 0.45,
            bloomThreshold: 0.82,

            // Tone mapping
            exposure: 0.35,

            // Fog
            fogEnabled: false,
            fogColor: '#c8d8f0',
            fogDensity: 0.018,

            // Ambient light
            ambientIntensity: sceneSetup.ambientLight?.intensity ?? 0.7,

            // Lamp
            lampColor: '#d1d100',
            lampSpawnCount: 10,
            lampSpawnRange: 30,
            lampEmissiveIntensity: 38.5,
        };

        this._buildBloomFolder();
        this._buildRenderFolder();
        this._buildFogFolder();
        this._buildLightsFolder();
        this._buildLampFolder();
    }

    // ── Bloom ──────────────────────────────────────────────────────────────

    _buildBloomFolder() {
        const f = this._gui.addFolder('🌸 Bloom');
        f.open();

        f.add(this._state, 'bloomEnabled').name('Enabled').onChange(v => {
            if (v) {
                this._sceneSetup.setupPostProcessing({
                    strength: this._state.bloomStrength,
                    radius: this._state.bloomRadius,
                    threshold: this._state.bloomThreshold,
                });
            } else {
                this._sceneSetup.teardownPostProcessing();
            }
        });

        f.add(this._state, 'bloomStrength', 0, 3, 0.01).name('Strength').onChange(v => {
            const n = this._sceneSetup.bloomNode;
            if (n) n.strength.value = v;
        });

        f.add(this._state, 'bloomRadius', 0, 1, 0.01).name('Radius').onChange(v => {
            const n = this._sceneSetup.bloomNode;
            if (n) n.radius.value = v;
        });

        f.add(this._state, 'bloomThreshold', 0, 1, 0.01).name('Threshold').onChange(v => {
            const n = this._sceneSetup.bloomNode;
            if (n) n.threshold.value = v;
        });
    }

    // ── Render / tone mapping ──────────────────────────────────────────────

    _buildRenderFolder() {
        const f = this._gui.addFolder('🎥 Renderer');

        f.add(this._state, 'exposure', 0, 4, 0.05).name('Exposure').onChange(v => {
            this._sceneSetup.renderer.toneMappingExposure = v;
        });
    }

    // ── Fog ───────────────────────────────────────────────────────────────

    _buildFogFolder() {
        const f = this._gui.addFolder('🌫 Fog');

        f.add(this._state, 'fogEnabled').name('Enabled').onChange(v => {
            if (!v) {
                this._sceneSetup.scene.fog = null;
            } else {
                this._sceneSetup.scene.fog = new THREE.FogExp2(
                    new THREE.Color(this._state.fogColor).getHex(),
                    this._state.fogDensity
                );
            }
        });

        f.addColor(this._state, 'fogColor').name('Color').onChange(v => {
            if (this._sceneSetup.scene.fog) {
                this._sceneSetup.scene.fog.color.set(v);
            }
        });

        f.add(this._state, 'fogDensity', 0, 0.2, 0.001).name('Density').onChange(v => {
            if (this._sceneSetup.scene.fog) {
                this._sceneSetup.scene.fog.density = v;
            }
        });
    }

    // ── Lights ────────────────────────────────────────────────────────────

    _buildLightsFolder() {
        const sc = this._sceneSetup;
        const f = this._gui.addFolder('💡 Lights');

        if (sc.ambientLight) {
            f.add(this._state, 'ambientIntensity', 0, 3, 0.05).name('Ambient Intensity').onChange(v => {
                sc.ambientLight.intensity = v;
            });

            // Ambient color (as hex string for lil-gui color picker)
            const ambientColorState = { color: '#' + sc.ambientLight.color.getHexString() };
            f.addColor(ambientColorState, 'color').name('Ambient Color').onChange(v => {
                sc.ambientLight.color.set(v);
            });
        }

        if (sc.dirLight) {
            const dirState = {
                intensity: sc.dirLight.intensity,
                color: '#' + sc.dirLight.color.getHexString(),
            };
            f.add(dirState, 'intensity', 0, 5, 0.05).name('Sun Intensity').onChange(v => {
                sc.dirLight.intensity = v;
            });
            f.addColor(dirState, 'color').name('Sun Color').onChange(v => {
                sc.dirLight.color.set(v);
            });
        }
    }

    // ── Lamp ──────────────────────────────────────────────────────────────

    _buildLampFolder() {
        const f = this._gui.addFolder('🔦 Lamp (Emissive Only)');
        f.open();

        f.addColor(this._state, 'lampColor').name('Color').onChange(v => {
            if (this._sceneSetup.lamp) {
                this._sceneSetup.lamp.updateLights(undefined, undefined, v, undefined);
            }
        });

        f.add(this._state, 'lampEmissiveIntensity', 0, 100, 0.5).name('Emissive Intensity').onChange(v => {
            if (this._sceneSetup.lamp) {
                this._sceneSetup.lamp.updateLights(undefined, undefined, undefined, v);
            }
        });

        f.add(this._state, 'lampSpawnCount', 1, 100, 1).name('Spawn Count');
        f.add(this._state, 'lampSpawnRange', 5, 50, 1).name('Spawn Range');

        const spawnObj = {
            spawn: () => {
                if (this._sceneSetup.lamp) {
                    this._sceneSetup.lamp.spawnRandom(this._state.lampSpawnCount, this._state.lampSpawnRange);
                }
            },
            clear: () => {
                if (this._sceneSetup.lamp) {
                    this._sceneSetup.lamp.clearAll();
                }
            }
        };

        f.add(spawnObj, 'spawn').name('🚀 Spawn Random');
        f.add(spawnObj, 'clear').name('🗑 Clear All');
    }

    dispose() {
        this._gui.destroy();
    }
}
