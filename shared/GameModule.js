/**
 * Base class / contract for all games loaded by the launcher.
 *
 * Each game receives its own Socket.IO namespace and is expected to
 * broadcast all player-facing events on it. The launcher routes chat
 * and gift events from TikTok Live into the active game's handleChat
 * and handleGift methods.
 *
 * Subclasses may override only the methods they need — the defaults
 * are no-ops so a minimal game can implement very little.
 */
class GameModule {
    constructor(nsp) {
        /** @type {import("socket.io").Namespace} */
        this.nsp = nsp;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /** Called by the host to start a game. `config` comes from the host panel. */
    hostStart(config = {}) {}

    /** Fully reset the game to a pre-start state. */
    hostReset() {}

    /** Freeze the game (timers, guesses). */
    hostPause() {}

    /** Resume a previously paused game. */
    hostResume() {}

    /** Apply a runtime configuration change without restarting. */
    hostConfig(config = {}) {}

    /** Handle a game-specific host action (e.g. skip, select player). */
    hostAction(params = {}) {}

    /** End the current game (e.g. finish a story, end a round). */
    hostEnd() {}

    /**
     * Clean up anything that would leak across game switches:
     * timers, intervals, socket listeners on the namespace, etc.
     * Called by the launcher when the host picks a different game.
     */
    teardown() {}

    // ── Inputs from TikTok Live ───────────────────────────────────────────────

    handleChat(username, message) {}

    handleGift(username, coins) {}

    // ── State snapshots ───────────────────────────────────────────────────────

    /**
     * Return a serializable snapshot of game state for the host panel.
     * This is what gets sent on the "hostState" socket event.
     */
    getHostState() {
        return {};
    }
}

module.exports = GameModule;
