/**
 * Tracks which game is currently active, instantiates it on select,
 * tears it down on deselect, and routes host calls to the right place.
 *
 * Broadcasts "launcherState" on the default Socket.IO namespace so the
 * player shell and host lobby can stay in sync.
 */
class LauncherState {
    constructor(io, registry) {
        this.io = io;                // default namespace (/)
        this.registry = registry;
        this.activeGameId = null;
        this.activeGame = null;      // GameModule instance
    }

    getPublicState() {
        return {
            activeGameId: this.activeGameId,
            lineup: this.registry.list(),
        };
    }

    broadcastState() {
        this.io.emit("launcherState", this.getPublicState());
    }

    /** Host picks a game from the lobby. Tears down any prior game first. */
    selectGame(gameId) {
        if (!this.registry.has(gameId)) {
            throw new Error(`unknown game: ${gameId}`);
        }
        if (this.activeGameId === gameId) return;

        if (this.activeGame) {
            try { this.activeGame.teardown(); } catch (err) {
                console.error(`[launcher] teardown failed for ${this.activeGameId}: ${err.message}`);
            }
        }

        const entry = this.registry.get(gameId);
        // Each game gets its own namespace so its events are isolated.
        const nsp = this.io.of(`/${gameId}`);
        this.activeGame = entry.createInstance(nsp);
        this.activeGameId = gameId;

        console.log(`[launcher] active game: ${gameId}`);
        this.broadcastState();
    }

    /** Host returns to the lobby. */
    deselectGame() {
        if (!this.activeGame) return;
        try { this.activeGame.teardown(); } catch (err) {
            console.error(`[launcher] teardown failed: ${err.message}`);
        }
        this.activeGame = null;
        this.activeGameId = null;
        console.log(`[launcher] returned to lobby`);
        this.broadcastState();
    }

    /** Route a host command to the active game if its gameId matches. */
    forwardHostCall(gameId, method, ...args) {
        if (this.activeGameId !== gameId) {
            throw new Error(`game '${gameId}' is not active (active: ${this.activeGameId || "none"})`);
        }
        if (typeof this.activeGame[method] !== "function") {
            throw new Error(`game '${gameId}' has no method '${method}'`);
        }
        return this.activeGame[method](...args);
    }

    // ── TikTok Live input routing ─────────────────────────────────────────────

    handleChat(username, message) {
        if (this.activeGame) this.activeGame.handleChat(username, message);
    }

    handleGift(username) {
        if (this.activeGame) this.activeGame.handleGift(username);
    }
}

module.exports = LauncherState;
