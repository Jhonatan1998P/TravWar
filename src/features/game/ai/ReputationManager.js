class ReputationManager {
    #diplomacyState;
    #DECAY_AMOUNT = 0.05;

    constructor(diplomacyState) {
        this.#diplomacyState = diplomacyState;
    }

    getReputation(player1, player2) {
        const key = this.#getRelationKey(player1, player2);
        return this.#diplomacyState.relations[key]?.reputation || 0;
    }

    recordAction(actorId, targetId, actionType, impact) {
        if (actorId === targetId) return;

        const key = this.#getRelationKey(actorId, targetId);
        if (!this.#diplomacyState.relations[key]) {
            this.#diplomacyState.relations[key] = { reputation: 0 };
        }

        this.#diplomacyState.relations[key].reputation += impact;
    }

    #getRelationKey(player1, player2) {
        return [player1, player2].sort().join('-');
    }

    decayReputations() {
        for (const key in this.#diplomacyState.relations) {
            const relation = this.#diplomacyState.relations[key];
            if (relation.reputation > 0) {
                relation.reputation = Math.max(0, relation.reputation - this.#DECAY_AMOUNT);
            } else if (relation.reputation < 0) {
                relation.reputation = Math.min(0, relation.reputation + this.#DECAY_AMOUNT);
            }
        }
    }
}

export default ReputationManager;