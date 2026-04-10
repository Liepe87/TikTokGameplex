const GameModule = require("../../shared/GameModule");

const DEFAULT_ROUND_TIME    = 15000;
const DEFAULT_MAX_ROUNDS    = 10;
const RESULTS_LINGER        = 7000;
const LEADERBOARD_LINGER    = 6000;
const MAX_SCORERS           = 10;

class NumbleGame extends GameModule {
    constructor(nsp) {
        super(nsp);
        this.players = {};
        this.currentRound = null;

        // State
        this.started  = false;
        this.paused   = false;
        this.autoplay = false;

        // Config
        this.roundTime    = DEFAULT_ROUND_TIME;
        this.maxRounds    = DEFAULT_MAX_ROUNDS;
        this.roundsPlayed = 0;

        // Timers
        this.roundTimer     = null;
        this.nextRoundTimer = null;

        // Pause tracking
        this.roundEndsAt    = null;
        this.roundRemaining = null;

        // Keep late joiners in sync with host state.
        this._onConnect = socket => {
            socket.emit("hostState", this._hostStatePayload());
        };
        this.nsp.on("connection", this._onConnect);
    }

    // ── GameModule contract ───────────────────────────────────────────────────

    handleChat(username, message) {
        if (!this.started || this.paused) return;
        if (!this.players[username]) this.players[username] = { score: 0 };
        if (this.currentRound?.active) {
            this.handleGuess(username, message);
        }
    }

    handleGift(username) {
        if (!this.started) return;
        if (!this.players[username]) this.players[username] = { score: 0 };
        this.maxRounds++;
        this.nsp.emit("giftReceived", {
            username,
            maxRounds:    this.maxRounds,
            roundsPlayed: this.roundsPlayed,
        });
        this.emitHostState();
    }

    teardown() {
        clearTimeout(this.roundTimer);
        clearTimeout(this.nextRoundTimer);
        this.roundTimer     = null;
        this.nextRoundTimer = null;
        this.nsp.off("connection", this._onConnect);
        this.nsp.emit("gameReset");
    }

    getHostState() {
        return this._hostStatePayload();
    }

    // ── Host controls ─────────────────────────────────────────────────────────

    hostStart({ maxRounds, roundTime, autoplay } = {}) {
        if (this.started) return;
        this.maxRounds    = Math.max(1, parseInt(maxRounds) || DEFAULT_MAX_ROUNDS);
        this.roundTime    = Math.max(5000, parseInt(roundTime) || DEFAULT_ROUND_TIME);
        this.autoplay     = !!autoplay;
        this.roundsPlayed = 0;
        this.paused       = false;
        this.players      = {};
        this.started      = true;
        this.emitHostState();
        this.nextRoundTimer = setTimeout(() => this.startRound(), 500);
    }

    hostReset() {
        clearTimeout(this.roundTimer);
        clearTimeout(this.nextRoundTimer);
        this.roundTimer     = null;
        this.nextRoundTimer = null;
        this.started        = false;
        this.paused         = false;
        this.currentRound   = null;
        this.roundsPlayed   = 0;
        this.players        = {};
        this.nsp.emit("gameReset");
        this.emitHostState();
    }

    hostPause() {
        if (!this.started || this.paused) return;
        this.paused = true;

        if (this.roundTimer && this.currentRound?.active) {
            this.roundRemaining = Math.max(0, this.roundEndsAt - Date.now());
            clearTimeout(this.roundTimer);
            this.roundTimer = null;
        }

        this.nsp.emit("gamePaused");
        this.emitHostState();
    }

    hostResume() {
        if (!this.started || !this.paused) return;
        this.paused = false;

        if (this.currentRound?.active && this.roundRemaining != null) {
            this.roundEndsAt = Date.now() + this.roundRemaining;
            this.roundTimer  = setTimeout(() => this.endRound(), this.roundRemaining);
            this.roundRemaining = null;
        }

        this.nsp.emit("gameResumed");
        this.emitHostState();
    }

    hostConfig({ roundTime, maxRounds, autoplay } = {}) {
        if (roundTime != null) this.roundTime = Math.max(5000, parseInt(roundTime) || DEFAULT_ROUND_TIME);
        if (maxRounds != null) this.maxRounds = Math.max(1, parseInt(maxRounds) || DEFAULT_MAX_ROUNDS);
        if (autoplay  != null) this.autoplay  = !!autoplay;
        this.emitHostState();
    }

    // ── Host state ────────────────────────────────────────────────────────────

    _hostStatePayload() {
        return {
            started:      this.started,
            paused:       this.paused,
            autoplay:     this.autoplay,
            roundTime:    this.roundTime,
            maxRounds:    this.maxRounds,
            roundsPlayed: this.roundsPlayed,
            guessCount:   this.currentRound ? Object.keys(this.currentRound.guesses).length : 0,
            scores:       this.getBoard(),
        };
    }

    emitHostState() {
        this.nsp.emit("hostState", this._hostStatePayload());
    }

    // ── Rounds ────────────────────────────────────────────────────────────────

    startRound() {
        this.roundsPlayed++;
        this.currentRound = { guesses: {}, active: true, target: null };

        this.nsp.emit("roundStart", {
            time:         this.roundTime,
            roundsPlayed: this.roundsPlayed,
            maxRounds:    this.maxRounds,
        });

        this.roundEndsAt = Date.now() + this.roundTime;
        this.roundTimer  = setTimeout(() => this.endRound(), this.roundTime);
        this.emitHostState();
    }

    handleGuess(username, message) {
        const trimmed = message.trim();
        if (!/^\d{1,3}$/.test(trimmed)) return;
        const num = parseInt(trimmed, 10);
        if (num > 100) return;

        const isNew = !(username in this.currentRound.guesses);
        this.currentRound.guesses[username] = { value: num, time: Date.now() };

        if (isNew) {
            this.nsp.emit("guessReceived", {
                username,
                guessCount: Object.keys(this.currentRound.guesses).length,
            });
        }
    }

    endRound() {
        if (!this.currentRound?.active) return;
        clearTimeout(this.roundTimer);
        this.roundTimer = null;
        this.currentRound.active = false;

        const target = Math.floor(Math.random() * 101);
        this.currentRound.target = target;

        const results = this.calculateResults(target);
        this.awardPoints(results);

        this.nsp.emit("roundEnd", {
            target,
            results:      results.slice(0, MAX_SCORERS),
            totalGuesses: Object.keys(this.currentRound.guesses).length,
        });

        this.emitHostState();

        if (this.roundsPlayed >= this.maxRounds) {
            this.nextRoundTimer = setTimeout(() => this.gameOver(), RESULTS_LINGER);
        } else {
            this.nextRoundTimer = setTimeout(() => this.showLeaderboard(), RESULTS_LINGER);
        }
    }

    calculateResults(target) {
        return Object.entries(this.currentRound.guesses)
            .map(([username, { value, time }]) => ({
                username,
                guess:    value,
                distance: Math.abs(value - target),
                time,
            }))
            .sort((a, b) => a.distance - b.distance || a.time - b.time);
    }

    awardPoints(results) {
        results.slice(0, MAX_SCORERS).forEach((r, i) => {
            const points = MAX_SCORERS - i + (r.distance === 0 ? 5 : 0);
            if (this.players[r.username]) {
                this.players[r.username].score += points;
            }
        });
    }

    // ── Leaderboard / game over ───────────────────────────────────────────────

    showLeaderboard() {
        this.nsp.emit("leaderboard", {
            board:        this.getBoard(),
            roundsPlayed: this.roundsPlayed,
            maxRounds:    this.maxRounds,
        });
        this.nextRoundTimer = setTimeout(() => this.startRound(), LEADERBOARD_LINGER);
    }

    gameOver() {
        this.started      = false;
        this.currentRound = null;
        this.nsp.emit("gameOver", this.getBoard());

        if (this.autoplay) {
            this.nextRoundTimer = setTimeout(() => {
                this.hostStart({
                    maxRounds: this.maxRounds,
                    roundTime: this.roundTime,
                    autoplay:  true,
                });
            }, 10000);
        }

        this.emitHostState();
    }

    getBoard() {
        return Object.entries(this.players)
            .map(([username, data]) => ({ username, score: data.score }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);
    }
}

module.exports = NumbleGame;
