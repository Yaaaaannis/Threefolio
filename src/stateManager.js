// stateManager.js — Behavioral variables shared across systems

export const state = {
    // Player behavioral metrics
    movementIntensity: 0,
    idleTimer: 0,
    totalDistanceTravelled: 0,
    maxHeightReached: 0,

    // Derived room energy [-1, 1]
    roomEnergy: 0,

    // Game phase
    phase: 'playing', // 'playing' | 'ending' | 'ended'

    // Elapsed time in seconds
    elapsedTime: 0,
};

const INTENSITY_THRESHOLD = 0.5; // units/s to count as "moving"

/**
 * Called every frame.
 * @param {number} speed - current player speed (units/s)
 * @param {number} dt - delta time (seconds)
 * @param {number} height - current player Y position
 */
export function updateState(speed, dt, height) {
    state.elapsedTime += dt;

    if (speed > INTENSITY_THRESHOLD) {
        state.movementIntensity += dt * 2;
        state.idleTimer = Math.max(0, state.idleTimer - dt);
        state.totalDistanceTravelled += speed * dt;
    } else {
        state.idleTimer += dt;
        state.movementIntensity = Math.max(0, state.movementIntensity - dt * 0.5);
    }

    if (height > state.maxHeightReached) {
        state.maxHeightReached = height;
    }

    // Room energy in [-1, 1]
    const raw = state.movementIntensity - state.idleTimer;
    state.roomEnergy = Math.max(-1, Math.min(1, raw * 0.1));
}
