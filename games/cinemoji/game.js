const fs = require("fs");
const path = require("path");
const levenshtein = require("fast-levenshtein");
const GameModule = require("../../shared/GameModule");

const PUZZLES_PATH = path.join(__dirname, "puzzles.json");

const DEFAULT_ROUND_TIME    = 30000;
const DEFAULT_MAX_ROUNDS    = 10;
const LEADERBOARD_LINGER    = 6000;
const POST_ROUND_LINGER     = 5000;
const MAX_WINNERS_PER_ROUND = 10;

function normalize(text) {
    return String(text)
        .toUpperCase()
        .replace(/[^A-Z0-9 ]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^(THE|A|AN) /, "");
}

class CinemojiGame extends GameModule {
    constructor(nsp) {
        super(nsp);
        this.players = {};
        this.puzzles = this.loadPuzzles();
        this.usedPuzzleIndices = [];
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
        this.roundEndsAt   = null;
        this.roundRemaining = null;

        // Keep late joiners in sync with host state.
        this._onConnect = socket => {
            socket.emit("hostState", this._hostStatePayload());
        };
        this.nsp.on("connection", this._onConnect);
    }

    loadPuzzles() {
        try {
            const raw = fs.readFileSync(PUZZLES_PATH, "utf-8");
            const data = JSON.parse(raw);
            return data
                .filter(p => p && p.emojis && p.answer)
                .map(p => ({
                    emojis:  p.emojis,
                    display: p.answer,
                    answer:  normalize(p.answer),
                    aliases: (p.aliases || []).map(normalize).filter(Boolean),
                }));
        } catch (err) {
            console.error(`[cinemoji] failed to load puzzles: ${err.message}`);
            return [];
        }
    }

    randomPuzzle() {
        if (this.puzzles.length === 0) return null;
        if (this.usedPuzzleIndices.length >= this.puzzles.length) {
            this.usedPuzzleIndices = [];
        }
        const available = this.puzzles
            .map((_, i) => i)
            .filter(i => !this.usedPuzzleIndices.includes(i));
        const idx = available[Math.floor(Math.random() * available.length)];
        this.usedPuzzleIndices.push(idx);
        return this.puzzles[idx];
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
        this.usedPuzzleIndices = [];
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
        this.usedPuzzleIndices = [];
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
            puzzleCount:  this.puzzles.length,
            scores:       this.getBoard(),
        };
    }

    emitHostState() {
        this.nsp.emit("hostState", this._hostStatePayload());
    }

    // ── Rounds ────────────────────────────────────────────────────────────────

    startRound() {
        const puzzle = this.randomPuzzle();
        if (!puzzle) {
            console.error("[cinemoji] no puzzles available");
            this.gameOver();
            return;
        }

        this.roundsPlayed++;
        this.currentRound = { puzzle, winners: [], active: true };

        this.nsp.emit("roundStart", {
            emojis:       puzzle.emojis,
            time:         this.roundTime,
            roundsPlayed: this.roundsPlayed,
            maxRounds:    this.maxRounds,
        });

        this.roundEndsAt = Date.now() + this.roundTime;
        this.roundTimer  = setTimeout(() => this.endRound(), this.roundTime);
        this.emitHostState();
    }

    handleGuess(username, guess) {
        if (!this.currentRound?.active) return;
        if (this.currentRound.winners.includes(username)) return;

        const normalized = normalize(guess);
        if (!normalized) return;

        const puzzle = this.currentRound.puzzle;
        const candidates = [puzzle.answer, ...puzzle.aliases];

        const correct = candidates.some(answer => {
            if (!answer) return false;
            const tolerance = answer.length <= 4 ? 0 : 2;
            return levenshtein.get(normalized, answer) <= tolerance;
        });

        if (!correct) return;

        this.currentRound.winners.push(username);
        const position = this.currentRound.winners.length;
        this.nsp.emit("correctGuess", { username, position });
        this.emitHostState();
        if (position >= MAX_WINNERS_PER_ROUND) this.endRound();
    }

    endRound() {
        if (!this.currentRound?.active) return;
        clearTimeout(this.roundTimer);
        this.roundTimer = null;
        this.currentRound.active = false;

        this.awardPoints();

        this.nsp.emit("roundEnd", {
            answer:  this.currentRound.puzzle.display,
            winners: this.currentRound.winners,
        });

        this.emitHostState();

        if (this.roundsPlayed >= this.maxRounds) {
            this.nextRoundTimer = setTimeout(() => this.gameOver(), POST_ROUND_LINGER);
        } else {
            this.nextRoundTimer = setTimeout(() => this.showLeaderboard(), POST_ROUND_LINGER);
        }
    }

    awardPoints() {
        this.currentRound.winners.forEach((username, index) => {
            const points = MAX_WINNERS_PER_ROUND - index;
            if (points > 0 && this.players[username]) {
                this.players[username].score += points;
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

module.exports = CinemojiGame;
