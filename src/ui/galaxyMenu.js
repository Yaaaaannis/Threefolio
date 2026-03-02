// galaxyMenu.js — Mario Galaxy-style world selection overlay.
// One portal ring → open this menu → click a planet to travel.

const WORLDS = {
    hub: { label: 'Hub', color1: '#a8f0a0', color2: '#33aa33', color3: '#1a5c1a', shadow: '#44ff44' },
    desert: { label: 'Desert', color1: '#f5c069', color2: '#c47a2b', color3: '#5c3010', shadow: '#ffaa44' },
    ice: { label: 'Ice', color1: '#e8f8ff', color2: '#66ccee', color3: '#1155aa', shadow: '#88ddff' },
    lava: { label: 'Lava', color1: '#ff9966', color2: '#cc2200', color3: '#3a0000', shadow: '#ff4400' },
};

const ALL_KEYS = ['hub', 'desert', 'ice', 'lava'];

export class GalaxyMenu {
    /** @param {(key: string) => void} travelTo */
    constructor(travelTo) {
        this._travelTo = travelTo;
        this._el = null;
        this._isOpen = false;
        this._currentKey = 'hub';
        this._keyHandler = null;
        this._inject();
    }

    // ── Public API ────────────────────────────────────────────────────────

    open(currentKey) {
        this._currentKey = currentKey;
        this._isOpen = true;
        this._render(currentKey);
        this._el.classList.remove('gm-hidden');
        this._el.classList.add('gm-visible');

        this._keyHandler = (e) => { if (e.code === 'Escape') this.close(); };
        window.addEventListener('keydown', this._keyHandler);
    }

    close() {
        if (!this._isOpen) return;
        this._isOpen = false;
        this._el.classList.add('gm-hidden');
        this._el.classList.remove('gm-visible');
        if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
    }

    get isOpen() { return this._isOpen; }

    // ── DOM Build ─────────────────────────────────────────────────────────

    _inject() {
        // CSS
        const style = document.createElement('style');
        style.textContent = `
            @import url('https://fonts.googleapis.com/css2?family=Fredoka+One&display=swap');

            .gm-overlay {
                position: fixed; inset: 0; z-index: 9000;
                display: flex; flex-direction: column;
                align-items: center; justify-content: center;
                background: radial-gradient(ellipse at 30% 40%, #1a0840 0%, #06031a 60%, #000008 100%);
                font-family: 'Fredoka One', 'Arial Rounded MT Bold', sans-serif;
                transition: opacity 0.4s ease;
                pointer-events: auto;
            }
            .gm-hidden { opacity: 0; pointer-events: none !important; }
            .gm-visible { opacity: 1; }

            /* Stars */
            .gm-stars { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
            .gm-star {
                position: absolute; border-radius: 50%; background: #fff;
                animation: gm-twinkle var(--dur, 2s) ease-in-out infinite alternate;
                animation-delay: var(--delay, 0s); opacity: var(--op, 0.6);
            }
            @keyframes gm-twinkle { from { opacity: var(--op, 0.6); transform: scale(1); } to { opacity: 0.1; transform: scale(0.5); } }

            /* Title */
            .gm-title {
                font-size: 2.2rem; color: #ffe066; text-shadow: 0 0 20px #ffaa00, 0 0 40px #ff8800;
                margin-bottom: 2.5rem; letter-spacing: 0.05em; z-index: 1;
            }

            /* Destinations row */
            .gm-destinations {
                display: flex; gap: 3.5rem; align-items: flex-end;
                margin-bottom: 4rem; z-index: 1;
            }

            /* Each planet item */
            .gm-planet-item {
                display: flex; flex-direction: column; align-items: center; gap: 0.7rem;
                cursor: pointer;
                animation: gm-float var(--fdur, 3s) ease-in-out infinite alternate;
                animation-delay: var(--fdelay, 0s);
                transition: transform 0.2s;
            }
            .gm-planet-item:hover { transform: scale(1.12) translateY(-5px); }
            .gm-planet-item:hover .gm-sphere { filter: brightness(1.3); }

            @keyframes gm-float {
                from { transform: translateY(0px); }
                to   { transform: translateY(-14px); }
            }

            /* Sphere */
            .gm-sphere {
                width: 130px; height: 130px; border-radius: 50%;
                background: var(--grad);
                box-shadow: 0 0 25px var(--glow), inset -15px -10px 30px rgba(0,0,0,0.5), inset 10px 8px 20px rgba(255,255,255,0.15);
                transition: filter 0.2s, box-shadow 0.2s;
                position: relative;
            }
            /* Specular highlight */
            .gm-sphere::before {
                content: ''; position: absolute;
                width: 35%; height: 30%; border-radius: 50%;
                background: radial-gradient(circle, rgba(255,255,255,0.7) 0%, transparent 80%);
                top: 15%; left: 20%;
            }
            /* Ring around sphere */
            .gm-sphere::after {
                content: ''; position: absolute;
                width: 160%; height: 30%; border-radius: 50%;
                border: 3px solid rgba(255,255,255,0.18);
                top: 35%; left: -30%;
                transform: rotateX(75deg);
                pointer-events: none;
            }

            .gm-planet-label {
                font-size: 1.1rem; color: #e0e8ff;
                text-shadow: 0 0 12px rgba(150,180,255,0.9);
                text-align: center;
            }

            /* Divider */
            .gm-divider {
                width: 60%; max-width: 500px; height: 2px;
                background: linear-gradient(to right, transparent, rgba(150,180,255,0.5), transparent);
                margin-bottom: 2.5rem; z-index: 1;
            }

            /* Current world */
            .gm-current {
                display: flex; flex-direction: column; align-items: center; gap: 0.8rem; z-index: 1;
            }
            .gm-current-label {
                font-size: 0.9rem; color: rgba(200,220,255,0.7); letter-spacing: 0.12em; text-transform: uppercase;
            }
            .gm-current .gm-sphere { width: 100px; height: 100px; }
            .gm-current-name { font-size: 1.6rem; color: #fff; text-shadow: 0 0 16px rgba(200,220,255,0.8); }

            /* ESC hint */
            .gm-esc {
                position: absolute; bottom: 1.5rem; right: 2rem;
                font-size: 0.85rem; color: rgba(200,220,255,0.45);
                font-family: monospace;
            }
        `;
        document.head.appendChild(style);

        // Container
        const el = document.createElement('div');
        el.className = 'gm-overlay gm-hidden';
        el.innerHTML = `<div class="gm-stars"></div>`;
        document.body.appendChild(el);
        this._el = el;

        // Generate stars
        const starsEl = el.querySelector('.gm-stars');
        for (let i = 0; i < 180; i++) {
            const s = document.createElement('div');
            s.className = 'gm-star';
            s.style.setProperty('--dur', (1.5 + Math.random() * 3) + 's');
            s.style.setProperty('--delay', (Math.random() * 4) + 's');
            s.style.setProperty('--op', (0.3 + Math.random() * 0.7).toFixed(2));
            s.style.left = (Math.random() * 100) + '%';
            s.style.top = (Math.random() * 100) + '%';
            const size = (Math.random() * 2.5 + 0.5).toFixed(1) + 'px';
            s.style.width = size;
            s.style.height = size;
            starsEl.appendChild(s);
        }

        // Click outside planet items closes
        el.addEventListener('click', (e) => {
            if (e.target === el) this.close();
        });
    }

    _makeSphere(key, size = 130) {
        const { color1, color2, color3, shadow } = WORLDS[key];
        const div = document.createElement('div');
        div.className = 'gm-sphere';
        div.style.setProperty('--grad', `radial-gradient(circle at 35% 30%, ${color1}, ${color2} 55%, ${color3})`);
        div.style.setProperty('--glow', shadow + '88');
        div.style.width = size + 'px';
        div.style.height = size + 'px';
        return div;
    }

    _render(currentKey) {
        // Remove old dynamic content
        this._el.querySelectorAll('.gm-title, .gm-destinations, .gm-divider, .gm-current, .gm-esc').forEach(e => e.remove());

        const destinations = ALL_KEYS.filter(k => k !== currentKey);

        // Title
        const title = document.createElement('div');
        title.className = 'gm-title';
        title.textContent = '✦ Choose Your World ✦';
        this._el.appendChild(title);

        // Destination planets
        const destRow = document.createElement('div');
        destRow.className = 'gm-destinations';
        destinations.forEach((key, i) => {
            const item = document.createElement('div');
            item.className = 'gm-planet-item';
            item.style.setProperty('--fdur', (2.5 + i * 0.7) + 's');
            item.style.setProperty('--fdelay', (i * 0.4) + 's');

            const sphere = this._makeSphere(key, 130);
            const label = document.createElement('div');
            label.className = 'gm-planet-label';
            label.textContent = WORLDS[key].label;

            item.appendChild(sphere);
            item.appendChild(label);
            item.addEventListener('click', () => {
                this.close();
                setTimeout(() => this._travelTo(key), 100);
            });
            destRow.appendChild(item);
        });
        this._el.appendChild(destRow);

        // Divider
        const div = document.createElement('div');
        div.className = 'gm-divider';
        this._el.appendChild(div);

        // Current world
        const curr = document.createElement('div');
        curr.className = 'gm-current';
        const currLabel = document.createElement('div');
        currLabel.className = 'gm-current-label';
        currLabel.textContent = 'Currently on';
        const currSphere = this._makeSphere(currentKey, 100);
        const currName = document.createElement('div');
        currName.className = 'gm-current-name';
        currName.textContent = WORLDS[currentKey].label;
        curr.appendChild(currLabel);
        curr.appendChild(currSphere);
        curr.appendChild(currName);
        this._el.appendChild(curr);

        // ESC hint
        const esc = document.createElement('div');
        esc.className = 'gm-esc';
        esc.textContent = '[ ESC ] Close';
        this._el.appendChild(esc);
    }
}
