// mobileControls.js — Virtual joystick + action buttons for mobile/touch

/**
 * Detects touch devices and shows a virtual joystick + buttons.
 * Fires synthetic keydown/keyup events that the player.js KEYS system picks up.
 */

const DEADZONE = 0.25; // normalised (0-1) threshold before triggering a direction

function fireKey(code, down) {
    const type = down ? 'keydown' : 'keyup';
    window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
}

function isTouchDevice() {
    return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}

export function initMobileControls() {
    if (!isTouchDevice()) return;

    // ── Inject styles ────────────────────────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
        #mobile-controls {
            position: fixed;
            bottom: 0; left: 0; right: 0;
            height: 220px;
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            padding: 24px 32px;
            z-index: 100;
            pointer-events: none;
            user-select: none;
            -webkit-user-select: none;
        }

        /* Joystick zone */
        #joystick-zone {
            pointer-events: all;
            width: 130px;
            height: 130px;
            border-radius: 50%;
            background: rgba(255,255,255,0.08);
            border: 2px solid rgba(255,255,255,0.18);
            backdrop-filter: blur(4px);
            position: relative;
            touch-action: none;
        }
        #joystick-knob {
            position: absolute;
            width: 54px;
            height: 54px;
            border-radius: 50%;
            background: rgba(255,255,255,0.55);
            border: 2px solid rgba(255,255,255,0.9);
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            transition: none;
            pointer-events: none;
            box-shadow: 0 2px 12px rgba(0,0,0,0.35);
        }

        /* Action buttons */
        #btn-group {
            pointer-events: all;
            display: flex;
            flex-direction: column;
            gap: 16px;
            align-items: center;
        }
        .action-btn {
            pointer-events: all;
            touch-action: none;
            width: 72px;
            height: 72px;
            border-radius: 50%;
            border: 2px solid rgba(255,255,255,0.6);
            backdrop-filter: blur(4px);
            font-family: monospace;
            font-size: 0.7rem;
            letter-spacing: 0.08em;
            color: rgba(255,255,255,0.9);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            transition: transform 0.08s, background 0.08s;
            -webkit-tap-highlight-color: transparent;
        }
        #btn-jump {
            background: rgba(80, 180, 255, 0.25);
            border-color: rgba(80, 180, 255, 0.7);
        }
        #btn-jump.pressed {
            background: rgba(80, 180, 255, 0.55);
            transform: scale(0.92);
        }
        #btn-punch {
            background: rgba(255, 100, 80, 0.25);
            border-color: rgba(255, 100, 80, 0.7);
        }
        #btn-punch.pressed {
            background: rgba(255, 100, 80, 0.55);
            transform: scale(0.92);
        }
    `;
    document.head.appendChild(style);

    // ── Build DOM ────────────────────────────────────────────────────────────
    const root = document.createElement('div');
    root.id = 'mobile-controls';

    const joystickZone = document.createElement('div');
    joystickZone.id = 'joystick-zone';

    const knob = document.createElement('div');
    knob.id = 'joystick-knob';
    joystickZone.appendChild(knob);

    const btnGroup = document.createElement('div');
    btnGroup.id = 'btn-group';

    const btnJump = document.createElement('div');
    btnJump.id = 'btn-jump';
    btnJump.className = 'action-btn';
    btnJump.textContent = 'JUMP';

    const btnPunch = document.createElement('div');
    btnPunch.id = 'btn-punch';
    btnPunch.className = 'action-btn';
    btnPunch.textContent = 'PUNCH';

    btnGroup.append(btnJump, btnPunch);
    root.append(joystickZone, btnGroup);
    document.body.appendChild(root);

    // ── Joystick logic ───────────────────────────────────────────────────────
    const RADIUS = 65; // half of joystick zone width
    let joyOrigin = null;
    let activeKeys = new Set();

    function setKey(code, active) {
        if (active && !activeKeys.has(code)) {
            activeKeys.add(code);
            fireKey(code, true);
        } else if (!active && activeKeys.has(code)) {
            activeKeys.delete(code);
            fireKey(code, false);
        }
    }

    function releaseAllDirections() {
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].forEach(k => setKey(k, false));
    }

    function updateJoystick(touchX, touchY) {
        const dx = touchX - joyOrigin.x;
        const dy = touchY - joyOrigin.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = RADIUS * 0.85;
        const clamp = Math.min(dist, maxDist);
        const angle = Math.atan2(dy, dx);

        // Move knob visually
        const kx = Math.cos(angle) * clamp;
        const ky = Math.sin(angle) * clamp;
        knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;

        // Normalised axes (-1 to 1)
        const nx = clamp > 0 ? (Math.cos(angle) * clamp) / maxDist : 0;
        const ny = clamp > 0 ? (Math.sin(angle) * clamp) / maxDist : 0;

        setKey('ArrowRight', nx > DEADZONE);
        setKey('ArrowLeft', nx < -DEADZONE);
        setKey('ArrowDown', ny > DEADZONE);
        setKey('ArrowUp', ny < -DEADZONE);
    }

    joystickZone.addEventListener('touchstart', e => {
        e.preventDefault();
        const t = e.changedTouches[0];
        const rect = joystickZone.getBoundingClientRect();
        joyOrigin = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
        updateJoystick(t.clientX, t.clientY);
    }, { passive: false });

    joystickZone.addEventListener('touchmove', e => {
        e.preventDefault();
        if (!joyOrigin) return;
        const t = e.changedTouches[0];
        updateJoystick(t.clientX, t.clientY);
    }, { passive: false });

    joystickZone.addEventListener('touchend', e => {
        e.preventDefault();
        joyOrigin = null;
        knob.style.transform = 'translate(-50%, -50%)';
        releaseAllDirections();
    }, { passive: false });

    // ── Button logic ─────────────────────────────────────────────────────────
    function setupBtn(el, code) {
        el.addEventListener('touchstart', e => {
            e.preventDefault();
            el.classList.add('pressed');
            fireKey(code, true);
        }, { passive: false });

        const release = e => {
            e.preventDefault();
            el.classList.remove('pressed');
            fireKey(code, false);
        };
        el.addEventListener('touchend', release, { passive: false });
        el.addEventListener('touchcancel', release, { passive: false });
    }

    setupBtn(btnJump, 'Space');
    setupBtn(btnPunch, 'KeyF');
}
