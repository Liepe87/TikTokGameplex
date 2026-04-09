const fs = require("fs");
const path = require("path");

/**
 * Scans games/ for subdirectories containing an index.js that exports
 * { meta, createInstance }. Games are the building blocks the launcher
 * offers to the host.
 */
class GameRegistry {
    constructor(gamesDir) {
        this.gamesDir = gamesDir;
        this.games = new Map(); // gameId -> { meta, createInstance, rootDir }
    }

    load() {
        const entries = fs.readdirSync(this.gamesDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const rootDir = path.join(this.gamesDir, entry.name);
            const indexPath = path.join(rootDir, "index.js");
            if (!fs.existsSync(indexPath)) continue;

            try {
                const mod = require(indexPath);
                if (!mod.meta || !mod.meta.id || typeof mod.createInstance !== "function") {
                    console.warn(`[registry] ${entry.name}: missing meta.id or createInstance — skipping`);
                    continue;
                }
                this.games.set(mod.meta.id, { ...mod, rootDir });
                console.log(`[registry] loaded game: ${mod.meta.id} (${mod.meta.name})`);
            } catch (err) {
                console.error(`[registry] failed to load ${entry.name}: ${err.message}`);
            }
        }
        return this;
    }

    has(gameId) {
        return this.games.has(gameId);
    }

    get(gameId) {
        return this.games.get(gameId);
    }

    list() {
        return Array.from(this.games.values()).map(g => g.meta);
    }
}

module.exports = GameRegistry;
