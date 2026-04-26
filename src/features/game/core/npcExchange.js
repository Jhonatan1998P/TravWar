export const NPC_EXCHANGE_MIN_COOLDOWN_MS = 15 * 60 * 1000;
export const NPC_EXCHANGE_MAX_COOLDOWN_MS = 30 * 60 * 1000;

export function getRandomNpcExchangeCooldownMs() {
    const range = NPC_EXCHANGE_MAX_COOLDOWN_MS - NPC_EXCHANGE_MIN_COOLDOWN_MS;
    return NPC_EXCHANGE_MIN_COOLDOWN_MS + Math.floor(Math.random() * (range + 1));
}

export function createNpcExchangeState(now = Date.now()) {
    return {
        nextAvailableAt: now + getRandomNpcExchangeCooldownMs(),
        lastExchangeAt: null,
    };
}
