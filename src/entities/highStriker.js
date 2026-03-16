// highStriker.js — Fête foraine: zone d'activation + jauge oscillante + frappe
import * as THREE from 'three';

const PC = new THREE.Vector3(0, -50, 0);
const PR = 50;

const TOWER_H  = 8.0;
const TOWER_R  = 0.09;
const PUCK_R   = 0.30;
const PUCK_H   = 0.13;
const ZONE_R   = 3.2;   // rayon de la zone d'activation
const GRAVITY  = 26;
const BASE_ω   = Math.PI * 1.4;

// Seuils de couleur pour les repères visuels de la jauge
const LEVELS = [
    { min: 0.00, color: '#888888' },
    { min: 0.18, color: '#66cc44' },
    { min: 0.38, color: '#44aaff' },
    { min: 0.57, color: '#ffcc00' },
    { min: 0.75, color: '#ff8800' },
    { min: 0.90, color: '#ff3333' },
];

const CONFETTI_COUNT = 150;
const CONFETTI_PALETTE = [
    new THREE.Color(0xff3366), new THREE.Color(0xffcc00),
    new THREE.Color(0x33ccff), new THREE.Color(0x66ff66),
    new THREE.Color(0xff9900), new THREE.Color(0xcc44ff),
];

export class HighStriker {
    constructor(scene, position, RAPIER, world) {
        this._scene  = scene;
        this._RAPIER = RAPIER;
        this._world  = world;

        this._normal     = position.clone().sub(PC).normalize();
        this._surfacePos = PC.clone().add(this._normal.clone().multiplyScalar(PR));
        this._baseQuat   = new THREE.Quaternion()
            .setFromUnitVectors(new THREE.Vector3(0, 1, 0), this._normal);

        // État : idle → inZone → ready → striking → result → cooldown
        this._state       = 'idle';
        this._gaugeTime   = 0;
        this._gaugeVal    = 0;
        this._puckY       = 0.3;
        this._puckVel     = 0;
        this._resultTimer = 0;
        this._coolTimer   = 0;
        this._hammerSwing = undefined;
        this._resultLevel = null;

        // Suivi touche Entrée (pattern SpawnerZone)
        this._enterDown     = false;
        this._enterConsumed = false;
        this._onEnterDown = (e) => { if (e.code === 'Enter') this._enterDown = true; };
        this._onEnterUp   = (e) => { if (e.code === 'Enter') { this._enterDown = false; this._enterConsumed = false; } };
        window.addEventListener('keydown', this._onEnterDown);
        window.addEventListener('keyup',   this._onEnterUp);

        // Capture Space uniquement pendant la phase ready
        this._onSpaceDown = (e) => {
            if (e.code === 'Space' && this._state === 'ready') {
                e.stopImmediatePropagation();
                this._strike();
            }
        };
        window.addEventListener('keydown', this._onSpaceDown, true);

        this._buildMesh();
        this._buildUI();
        this._buildPhysics();
        this._setupConfetti();
    }

    // ── Mesh ────────────────────────────────────────────────────────────────

    _buildMesh() {
        this._group = new THREE.Group();

        const darkMat   = new THREE.MeshToonMaterial({ color: 0x2e1205 });
        const redMat    = new THREE.MeshToonMaterial({ color: 0xcc2200 });
        const yellowMat = new THREE.MeshToonMaterial({ color: 0xffcc00 });
        this._bellMat   = new THREE.MeshToonMaterial({
            color: 0xffd700,
            emissive: new THREE.Color(0xffaa00),
            emissiveIntensity: 0,
        });

        // Socle
        const base = new THREE.Mesh(
            new THREE.CylinderGeometry(1.0, 1.25, 0.38, 12), darkMat);
        base.castShadow = base.receiveShadow = true;

        // Poteau
        const pole = new THREE.Mesh(
            new THREE.CylinderGeometry(TOWER_R, TOWER_R, TOWER_H, 10), darkMat);
        pole.position.y = TOWER_H / 2;
        pole.castShadow = true;

        // Rainure colorée
        const track = new THREE.Mesh(
            new THREE.CylinderGeometry(TOWER_R + 0.045, TOWER_R + 0.045, TOWER_H - 0.3, 10), redMat);
        track.position.y = TOWER_H / 2;

        // Repères de niveau
        LEVELS.forEach(lv => {
            const y = lv.min * TOWER_H;
            if (y < 0.25) return;
            const tick = new THREE.Mesh(
                new THREE.CylinderGeometry(TOWER_R + 0.22, TOWER_R + 0.22, 0.045, 10),
                new THREE.MeshToonMaterial({ color: new THREE.Color(lv.color) })
            );
            tick.position.y = y;
            this._group.add(tick);
        });

        // Puck
        this._puckMesh = new THREE.Mesh(
            new THREE.CylinderGeometry(PUCK_R, PUCK_R * 0.85, PUCK_H, 14), yellowMat);
        this._puckMesh.position.y = 0.3;
        this._puckMesh.castShadow = true;

        // Cloche
        this._bellMesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.38, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.58),
            this._bellMat);
        this._bellMesh.rotation.x = Math.PI;
        this._bellMesh.position.y = TOWER_H + 0.22;
        this._bellMesh.castShadow = true;

        const hanger = new THREE.Mesh(
            new THREE.CylinderGeometry(0.04, 0.04, 0.28, 6), darkMat);
        hanger.position.y = TOWER_H + 0.58;

        // Marteau décoratif
        this._hammerGroup = new THREE.Group();
        const handle = new THREE.Mesh(
            new THREE.CylinderGeometry(0.065, 0.075, 2.3, 8), darkMat);
        handle.position.y = 1.15;
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.62, 0.33), redMat);
        head.position.y = 2.28;
        this._hammerGroup.add(handle, head);
        this._hammerGroup.position.set(-1.15, 0, 0.1);
        this._hammerGroup.rotation.z = -0.32;

        // ── Zone ring (flat, alignée à la surface via le group) ──────────────
        // rotation.x = -PI/2 car RingGeometry est dans XY, on le couche dans XZ (local Y = normal)
        this._ringMat = new THREE.MeshStandardMaterial({
            color: 0xffcc00,
            emissive: new THREE.Color(0x332200),
            emissiveIntensity: 0,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
        });
        const ringMesh = new THREE.Mesh(
            new THREE.RingGeometry(ZONE_R - 0.28, ZONE_R, 48),
            this._ringMat);
        ringMesh.rotation.x = -Math.PI / 2;
        ringMesh.position.y = 0.08;
        this._group.add(ringMesh);

        this._group.add(base, pole, track, this._puckMesh,
            this._bellMesh, hanger, this._hammerGroup);

        this._group.position.copy(this._surfacePos);
        this._group.quaternion.copy(this._baseQuat);
        this._scene.add(this._group);
    }

    // ── UI ──────────────────────────────────────────────────────────────────

    _buildUI() {
        // Hint "ENTRÉE pour jouer"
        this._hintEl = document.createElement('div');
        this._hintEl.style.cssText = `
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%);
            display: none;
            font-family: 'Fredoka One', monospace;
            font-size: 20px;
            color: white;
            text-shadow: 2px 2px 5px rgba(0,0,0,0.85);
            pointer-events: none;
            z-index: 9997;
        `;
        this._hintEl.innerHTML = '🔔 <strong>ENTRÉE</strong> pour jouer';
        document.body.appendChild(this._hintEl);

        // Jauge verticale (visible seulement en état ready)
        this._gaugeEl = document.createElement('div');
        this._gaugeEl.style.cssText = `
            position: fixed;
            bottom: 60px;
            right: 60px;
            display: none;
            flex-direction: row;
            align-items: flex-end;
            gap: 14px;
            pointer-events: none;
            font-family: 'Fredoka One', monospace;
            z-index: 9998;
        `;

        const threshHtml = LEVELS.slice(1).map(lv => `
            <div style="
                position:absolute; left:0; right:0;
                bottom:${lv.min * 100}%;
                height:2px;
                background:rgba(255,255,255,0.45);
            "></div>
        `).join('');

        this._gaugeEl.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
                <div id="hs-bar" style="
                    width:38px; height:220px;
                    background:rgba(0,0,0,0.55);
                    border:2px solid rgba(255,255,255,0.75);
                    border-radius:19px;
                    overflow:hidden;
                    position:relative;
                    display:flex;
                    align-items:flex-end;
                ">
                    <div id="hs-fill" style="
                        width:100%; height:0%;
                        background:linear-gradient(0deg,
                            #555 0%, #66cc44 28%, #ffcc00 60%,
                            #ff8800 82%, #ff2200 100%);
                        border-radius:16px;
                    "></div>
                    ${threshHtml}
                </div>
                <div style="color:white;font-size:16px;
                            text-shadow:2px 2px 4px rgba(0,0,0,0.9);
                            text-align:center">
                    <strong>ESPACE</strong><br>pour frapper
                </div>
            </div>
        `;

        document.body.appendChild(this._gaugeEl);
        this._fillEl = this._gaugeEl.querySelector('#hs-fill');
    }

    // ── Physics ─────────────────────────────────────────────────────────────

    _buildPhysics() {
        if (!this._RAPIER || !this._world) return;
        const { x, y, z } = this._surfacePos;
        const { x: qx, y: qy, z: qz, w: qw } = this._baseQuat;
        const rb = this._world.createRigidBody(
            this._RAPIER.RigidBodyDesc.fixed()
                .setTranslation(x, y, z)
                .setRotation({ x: qx, y: qy, z: qz, w: qw })
        );
        this._world.createCollider(
            this._RAPIER.ColliderDesc.cylinder(0.19, 1.05), rb);
        this._rb = rb;
    }

    // ── Game logic ───────────────────────────────────────────────────────────

    _strike() {
        this._state   = 'striking';
        this._puckVel = this._gaugeVal * 26;
        this._resultLevel = [...LEVELS].reverse().find(l => this._gaugeVal >= l.min) || LEVELS[0];
        this._hammerSwing = 0;
        this._gaugeEl.style.display = 'none';

        if (this._gaugeVal >= 0.9) this._triggerConfetti();
    }

    _showResult() {
        if (!this._resultEl) {
            this._resultEl = document.createElement('div');
            this._resultEl.style.cssText = `
                position: fixed;
                top: 38%;
                left: 50%;
                transform: translate(-50%, -50%) scale(0);
                font-family: 'Fredoka One', monospace;
                font-size: 72px;
                text-align: center;
                text-shadow: 3px 3px 0 rgba(0,0,0,0.6);
                transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1);
                pointer-events: none;
                z-index: 9999;
            `;
            document.body.appendChild(this._resultEl);
        }
        this._resultEl.style.color   = this._resultLevel.color;
        this._resultEl.textContent   = Math.round(this._gaugeVal * 100) + '%';
        this._resultEl.style.display = 'block';
        requestAnimationFrame(() => {
            this._resultEl.style.transform = 'translate(-50%, -50%) scale(1)';
        });
    }

    _hideResult() {
        if (this._resultEl)
            this._resultEl.style.transform = 'translate(-50%, -50%) scale(0)';
    }

    // ── Confetti ─────────────────────────────────────────────────────────────

    _setupConfetti() {
        const geo = new THREE.BoxGeometry(0.22, 0.44, 0.05);
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.1 });
        this._confettiMesh = new THREE.InstancedMesh(geo, mat, CONFETTI_COUNT);
        this._confettiMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this._confettiMesh.frustumCulled = false;

        this._confettiMesh.instanceColor = new THREE.InstancedBufferAttribute(
            new Float32Array(CONFETTI_COUNT * 3), 3);
        for (let i = 0; i < CONFETTI_COUNT; i++)
            this._confettiMesh.setColorAt(i, CONFETTI_PALETTE[i % CONFETTI_PALETTE.length]);
        this._confettiMesh.instanceColor.needsUpdate = true;

        this._cPos = new Float32Array(CONFETTI_COUNT * 3);
        this._cVel = new Float32Array(CONFETTI_COUNT * 3);
        this._cDummy = new THREE.Object3D();
        this._confettiActive = false;
        this._confettiTime   = 0;

        // Cacher initialement
        this._cDummy.scale.set(0, 0, 0);
        this._cDummy.updateMatrix();
        for (let i = 0; i < CONFETTI_COUNT; i++)
            this._confettiMesh.setMatrixAt(i, this._cDummy.matrix);
        this._confettiMesh.instanceMatrix.needsUpdate = true;

        this._scene.add(this._confettiMesh);
    }

    _triggerConfetti() {
        // Burst depuis le haut de la tour (position cloche)
        const bellPos = this._surfacePos.clone()
            .add(this._normal.clone().multiplyScalar(TOWER_H));

        for (let i = 0; i < CONFETTI_COUNT; i++) {
            this._cPos[i*3]   = bellPos.x + (Math.random() - 0.5) * 1.5;
            this._cPos[i*3+1] = bellPos.y + (Math.random() - 0.5) * 1.5;
            this._cPos[i*3+2] = bellPos.z + (Math.random() - 0.5) * 1.5;

            const speed = 4 + Math.random() * 9;
            const theta = Math.random() * Math.PI * 2;
            const phi   = (Math.random() - 0.3) * Math.PI;
            this._cVel[i*3]   = speed * (Math.sin(phi) * Math.cos(theta) + this._normal.x * 0.5);
            this._cVel[i*3+1] = speed * (Math.sin(phi) * Math.sin(theta) + this._normal.y * 0.5);
            this._cVel[i*3+2] = speed * (Math.cos(phi)                   + this._normal.z * 0.5);
        }
        this._confettiActive = true;
        this._confettiTime   = 0;
    }

    _updateConfetti(dt) {
        if (!this._confettiActive) return;

        this._confettiTime += dt;
        const DURATION = 4.0;
        const lifePct  = Math.min(1, this._confettiTime / DURATION);
        const gx = -this._normal.x * 9.8 * dt;
        const gy = -this._normal.y * 9.8 * dt;
        const gz = -this._normal.z * 9.8 * dt;

        for (let i = 0; i < CONFETTI_COUNT; i++) {
            this._cVel[i*3]   += gx;
            this._cVel[i*3+1] += gy;
            this._cVel[i*3+2] += gz;
            this._cPos[i*3]   += this._cVel[i*3]   * dt;
            this._cPos[i*3+1] += this._cVel[i*3+1] * dt;
            this._cPos[i*3+2] += this._cVel[i*3+2] * dt;

            this._cDummy.position.set(this._cPos[i*3], this._cPos[i*3+1], this._cPos[i*3+2]);
            this._cDummy.scale.setScalar(1 - lifePct);
            this._cDummy.rotation.set(
                this._confettiTime * 8  + i * 1.3,
                this._confettiTime * 6  + i * 0.9,
                this._confettiTime * 10 + i * 1.7
            );
            this._cDummy.updateMatrix();
            this._confettiMesh.setMatrixAt(i, this._cDummy.matrix);
        }
        this._confettiMesh.instanceMatrix.needsUpdate = true;

        if (this._confettiTime > DURATION) {
            this._cDummy.scale.set(0, 0, 0);
            this._cDummy.updateMatrix();
            for (let i = 0; i < CONFETTI_COUNT; i++)
                this._confettiMesh.setMatrixAt(i, this._cDummy.matrix);
            this._confettiMesh.instanceMatrix.needsUpdate = true;
            this._confettiActive = false;
        }
    }

    // ── Update ───────────────────────────────────────────────────────────────

    update(dt, player) {
        if (!player) return;

        const pPos = new THREE.Vector3().copy(player.rigidBody.translation());
        const near = pPos.distanceTo(this._surfacePos) < ZONE_R + 0.5;

        // ── Transitions ──────────────────────────────────────────────────────

        if (this._state === 'idle' && near) {
            this._state = 'inZone';
            this._hintEl.style.display = 'block';
        }

        if (this._state === 'inZone') {
            if (!near) {
                // Quitte la zone
                this._state = 'idle';
                this._hintEl.style.display = 'none';
                this._enterConsumed = false;
            } else if (this._enterDown && !this._enterConsumed) {
                // Lance le jeu
                this._enterConsumed = true;
                this._state      = 'ready';
                this._gaugeTime  = 0;
                this._puckY      = 0.3;
                this._hintEl.style.display  = 'none';
                this._gaugeEl.style.display = 'flex';
            }
        }

        if (this._state === 'ready' && !near) {
            // Annule si le joueur sort pendant la jauge
            this._state = 'idle';
            this._gaugeEl.style.display = 'none';
        }

        // ── Ring visuel ───────────────────────────────────────────────────────
        const inZoneOrReady = this._state === 'inZone' || this._state === 'ready';
        if (inZoneOrReady) {
            const pulse = Math.sin(Date.now() * 0.006) * 0.5 + 0.5;
            this._ringMat.color.setHex(0xffff44);
            this._ringMat.emissiveIntensity = 0.3 + pulse * 0.4;
        } else {
            this._ringMat.color.setHex(0xffcc00);
            this._ringMat.emissiveIntensity = 0;
        }

        // ── Jauge oscillante ──────────────────────────────────────────────────
        if (this._state === 'ready') {
            this._gaugeTime += dt;
            const ω = BASE_ω * (1 + this._gaugeTime * 0.05);
            this._gaugeVal = Math.abs(Math.sin(this._gaugeTime * ω));
            this._fillEl.style.height = (this._gaugeVal * 100).toFixed(1) + '%';
        }

        // ── Puck ──────────────────────────────────────────────────────────────
        if (this._state === 'striking') {
            this._puckVel -= GRAVITY * dt;
            this._puckY   += this._puckVel * dt;

            if (this._puckY >= TOWER_H - 0.4) {
                this._puckY = TOWER_H - 0.4;
                this._bellMat.emissiveIntensity = Math.max(
                    this._bellMat.emissiveIntensity, 2.8);
            }
            if (this._puckY <= 0.3) {
                this._puckY   = 0.3;
                this._puckVel = 0;
                this._state   = 'result';
                this._resultTimer = 2.8;
                this._showResult();
            }
        }

        // ── Résultat ──────────────────────────────────────────────────────────
        if (this._state === 'result') {
            this._resultTimer -= dt;
            this._bellMat.emissiveIntensity =
                Math.max(0, this._bellMat.emissiveIntensity - dt * 1.6);
            if (this._resultTimer <= 0) {
                this._hideResult();
                this._state     = 'cooldown';
                this._coolTimer = 0.7;
            }
        }

        if (this._state === 'cooldown') {
            this._coolTimer -= dt;
            if (this._coolTimer <= 0) {
                this._puckY = 0.3;
                this._state = near ? 'inZone' : 'idle';
                if (near) this._hintEl.style.display = 'block';
            }
        }

        // ── Visuals ───────────────────────────────────────────────────────────
        this._puckMesh.position.y = this._puckY;
        this._updateConfetti(dt);

        if (this._hammerSwing !== undefined) {
            this._hammerSwing += dt;
            const t     = Math.min(this._hammerSwing / 0.32, 1);
            const swing = t < 0.5 ? t * 2 : 2 - t * 2;
            this._hammerGroup.rotation.z = -0.32 + swing * 0.95;
            if (t >= 1) this._hammerSwing = undefined;
        }
    }

    // ── Dispose ──────────────────────────────────────────────────────────────

    dispose() {
        window.removeEventListener('keydown', this._onEnterDown);
        window.removeEventListener('keyup',   this._onEnterUp);
        window.removeEventListener('keydown', this._onSpaceDown, true);
        this._scene.remove(this._group);
        this._group.traverse(obj => {
            if (!obj.isMesh) return;
            obj.geometry.dispose();
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach(m => m.dispose());
        });
        this._hintEl?.remove();
        this._gaugeEl?.remove();
        this._resultEl?.remove();
        if (this._confettiMesh) {
            this._scene.remove(this._confettiMesh);
            this._confettiMesh.geometry.dispose();
            this._confettiMesh.material.dispose();
        }
        if (this._rb) this._world.removeRigidBody(this._rb);
    }
}
