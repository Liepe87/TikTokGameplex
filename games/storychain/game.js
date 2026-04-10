const GameModule = require("../../shared/GameModule");

const DEFAULT_TURN_TIME = 15000;

class StoryChainGame extends GameModule {
    constructor(nsp) {
        super(nsp);
        this.pool = new Set();
        this.story = [];
        this.currentPlayer = null;
        this.previousPlayer = null;
        this.priorityQueue = [];

        // State
        this.started = false;
        this.paused  = false;

        // Config
        this.turnTime = DEFAULT_TURN_TIME;

        // Timers
        this.turnTimer     = null;
        this.nextTurnTimer = null;

        // Pause tracking
        this.turnEndsAt    = null;
        this.turnRemaining = null;

        // Keep late joiners in sync.
        this._onConnect = socket => {
            socket.emit("hostState", this._hostStatePayload());
        };
        this.nsp.on("connection", this._onConnect);
    }

    // ── GameModule contract ───────────────────────────────────────────────────

    handleChat(username, message) {
        const isNew = !this.pool.has(username);
        this.pool.add(username);

        if (isNew) {
            this.nsp.emit("playerJoined", { username, poolSize: this.pool.size });
            this.emitHostState();
        }

        if (!this.started || this.paused) return;

        if (username === this.currentPlayer) {
            const word = this.extractWord(message);
            if (word) this.addWord(username, word);
        } else if (!this.currentPlayer && this.pool.size > 0) {
            // No one selected yet — first chatter triggers selection.
            this.selectNextPlayer();
        }
    }

    handleGift(username) {
        if (!this.started) return;
        this.pool.add(username);
        this.priorityQueue.push(username);
        this.nsp.emit("giftReceived", { username });
        this.emitHostState();
    }

    teardown() {
        clearTimeout(this.turnTimer);
        clearTimeout(this.nextTurnTimer);
        this.turnTimer     = null;
        this.nextTurnTimer = null;
        this.nsp.off("connection", this._onConnect);
        this.nsp.emit("gameReset");
    }

    getHostState() {
        return this._hostStatePayload();
    }

    // ── Host controls ─────────────────────────────────────────────────────────

    hostStart({ turnTime } = {}) {
        if (this.started) return;
        this.turnTime        = Math.max(5000, parseInt(turnTime) || DEFAULT_TURN_TIME);
        this.started         = true;
        this.paused          = false;
        this.story           = [];
        this.currentPlayer   = null;
        this.previousPlayer  = null;
        this.priorityQueue   = [];
        this.emitHostState();

        if (this.pool.size > 0) {
            this.nextTurnTimer = setTimeout(() => this.selectNextPlayer(), 500);
        }
        // else: first viewer to chat triggers selection
    }

    hostReset() {
        clearTimeout(this.turnTimer);
        clearTimeout(this.nextTurnTimer);
        this.turnTimer      = null;
        this.nextTurnTimer  = null;
        this.started        = false;
        this.paused         = false;
        this.story          = [];
        this.currentPlayer  = null;
        this.previousPlayer = null;
        this.priorityQueue  = [];
        // Keep the pool so players don't need to re-join.
        this.nsp.emit("gameReset");
        this.emitHostState();
    }

    hostPause() {
        if (!this.started || this.paused) return;
        this.paused = true;

        if (this.turnTimer && this.currentPlayer) {
            this.turnRemaining = Math.max(0, this.turnEndsAt - Date.now());
            clearTimeout(this.turnTimer);
            this.turnTimer = null;
        }
        clearTimeout(this.nextTurnTimer);
        this.nextTurnTimer = null;

        this.nsp.emit("gamePaused");
        this.emitHostState();
    }

    hostResume() {
        if (!this.started || !this.paused) return;
        this.paused = false;

        if (this.currentPlayer && this.turnRemaining != null) {
            this.turnEndsAt = Date.now() + this.turnRemaining;
            this.turnTimer  = setTimeout(() => this.skipCurrentPlayer(), this.turnRemaining);
            this.turnRemaining = null;
        } else if (!this.currentPlayer && this.pool.size > 0) {
            this.selectNextPlayer();
        }

        this.nsp.emit("gameResumed");
        this.emitHostState();
    }

    hostConfig({ turnTime } = {}) {
        if (turnTime != null) this.turnTime = Math.max(5000, parseInt(turnTime) || DEFAULT_TURN_TIME);
        this.emitHostState();
    }

    hostAction({ type, player } = {}) {
        if (!this.started) return;

        if (type === "skip") {
            if (this.currentPlayer) this.skipCurrentPlayer();
        } else if (type === "selectPlayer") {
            if (!player) return;
            this.pool.add(player);
            clearTimeout(this.turnTimer);
            clearTimeout(this.nextTurnTimer);
            this.turnTimer     = null;
            this.nextTurnTimer = null;
            this.selectNextPlayer(player);
        }
    }

    // ── Host state ────────────────────────────────────────────────────────────

    _hostStatePayload() {
        return {
            started:       this.started,
            paused:        this.paused,
            turnTime:      this.turnTime,
            currentPlayer: this.currentPlayer,
            story:         this.story,
            storyText:     this.getStoryText(),
            wordCount:     this.story.length,
            pool:          [...this.pool],
            poolSize:      this.pool.size,
            priorityQueue: [...this.priorityQueue],
        };
    }

    emitHostState() {
        this.nsp.emit("hostState", this._hostStatePayload());
    }

    // ── Game logic ────────────────────────────────────────────────────────────

    extractWord(message) {
        const word = message.trim().split(/\s+/)[0];
        if (!word || word.length > 45) return null;
        return word;
    }

    addWord(username, word) {
        clearTimeout(this.turnTimer);
        this.turnTimer     = null;
        this.previousPlayer = username;
        this.currentPlayer  = null;
        this.story.push({ word, author: username });

        this.nsp.emit("wordAdded", {
            word,
            author:    username,
            wordCount: this.story.length,
        });
        this.emitHostState();

        this.nextTurnTimer = setTimeout(() => {
            if (this.started && !this.paused) this.selectNextPlayer();
        }, 1500);
    }

    selectNextPlayer(specificPlayer) {
        if (!this.started || this.paused) return;

        let next;
        if (specificPlayer) {
            this.pool.add(specificPlayer);
            next = specificPlayer;
        } else if (this.priorityQueue.length > 0) {
            next = this.priorityQueue.shift();
        } else {
            const avoid = this.currentPlayer || this.previousPlayer;
            const candidates = [...this.pool].filter(p => p !== avoid);
            if (candidates.length === 0 && this.pool.size > 0) {
                candidates.push(...this.pool);
            }
            if (candidates.length === 0) {
                this.currentPlayer  = null;
                this.previousPlayer = null;
                this.nsp.emit("waitingForPlayers");
                this.emitHostState();
                return;
            }
            next = candidates[Math.floor(Math.random() * candidates.length)];
        }

        this.currentPlayer  = next;
        this.previousPlayer = null;
        this.turnEndsAt     = Date.now() + this.turnTime;
        this.turnTimer      = setTimeout(() => this.skipCurrentPlayer(), this.turnTime);

        this.nsp.emit("turnStart", {
            player:    next,
            turnTime:  this.turnTime,
            wordCount: this.story.length,
        });
        this.emitHostState();
    }

    skipCurrentPlayer() {
        clearTimeout(this.turnTimer);
        this.turnTimer = null;
        const skipped = this.currentPlayer;

        this.nsp.emit("turnSkipped", { player: skipped });
        // currentPlayer still set so selectNextPlayer avoids re-picking them.
        this.selectNextPlayer();
    }

    getStoryText() {
        return this.story.map(s => s.word).join(" ");
    }
}

module.exports = StoryChainGame;
