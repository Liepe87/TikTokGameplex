const fs = require("fs");
const path = require("path");
const levenshtein = require("fast-levenshtein");
const GameModule = require("../../shared/GameModule");

const IMAGE_DIR        = path.join(__dirname, "images");
const IMAGE_URL_PREFIX = "/games/swys/images";

const DEFAULT_ROUND_TIME   = 20000;
const DEFAULT_BONUS_TIME   = 20000;
const DEFAULT_BONUS_ROUNDS = 5;

function normalize(text) {
    return text
        .toUpperCase()
        .replace(/[^A-Z0-9 ]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function answerFromFilename(file) {
    return normalize(path.parse(file).name.replace(/_/g, " "));
}

class SwysGame extends GameModule {
    constructor(nsp) {
        super(nsp);
        this.players = {};
        this.puzzles = this.loadPuzzles();
        this.usedPuzzleIndices = [];
        this.currentRound = null;
        this.bonus = null;

        // State
        this.started  = false;
        this.paused   = false;
        this.autoplay = false;

        // Config
        this.roundTime      = DEFAULT_ROUND_TIME;
        this.bonusTime      = DEFAULT_BONUS_TIME;
        this.maxBonusRounds = DEFAULT_BONUS_ROUNDS;
        this.bonusRoundsPlayed = 0;
        this.giftBonus      = true;
        this.minGiftValue   = 0;

        // Timers
        this.roundTimer      = null;
        this.bonusGuessTimer = null;
        this.pendingTransition = null; // { fn, timer, endsAt, remaining }

        // Pause tracking
        this.roundEndsAt = null;
        this.bonusEndsAt = null;

        // New-connection hook — keep late joiners in sync with host state.
        this._onConnect = socket => {
            socket.emit("hostState", this._hostStatePayload());
        };
        this.nsp.on("connection", this._onConnect);
    }

    loadPuzzles() {
        return fs.readdirSync(IMAGE_DIR).map(file => ({
            file,
            answer: answerFromFilename(file)
        }));
    }

    randomPuzzle() {
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
        this.handleChatGuess(username, message);
    }

    _scheduleTransition(fn, delay) {
        if (this.pendingTransition) clearTimeout(this.pendingTransition.timer);
        const t = {
            fn,
            endsAt: Date.now() + delay,
        };
        t.timer = setTimeout(() => { this.pendingTransition = null; fn(); }, delay);
        this.pendingTransition = t;
    }

    _clearTransition() {
        if (this.pendingTransition) {
            clearTimeout(this.pendingTransition.timer);
            this.pendingTransition = null;
        }
    }

    teardown() {
        clearTimeout(this.roundTimer);
        clearTimeout(this.bonusGuessTimer);
        this._clearTransition();
        this.roundTimer = null;
        this.bonusGuessTimer = null;
        this.nsp.off("connection", this._onConnect);
        // Notify any attached player display that things are going away.
        this.nsp.emit("gameReset");
    }

    getHostState() {
        return this._hostStatePayload();
    }

    // ── Host controls ─────────────────────────────────────────────────────────

    hostStart({ maxBonusRounds, roundTime, autoplay, giftBonus, minGiftValue } = {}) {
        if (this.started) return;
        this.maxBonusRounds    = Math.max(1, parseInt(maxBonusRounds) || DEFAULT_BONUS_ROUNDS);
        this.roundTime         = Math.max(5000, parseInt(roundTime) || DEFAULT_ROUND_TIME);
        this.autoplay          = !!autoplay;
        if (giftBonus     != null) this.giftBonus    = !!giftBonus;
        if (minGiftValue  != null) this.minGiftValue = Math.max(0, parseInt(minGiftValue) || 0);
        this.bonusRoundsPlayed = 0;
        this.paused            = false;
        this.players           = {};
        this.usedPuzzleIndices = [];
        this.started           = true;
        this.emitHostState();
        this._scheduleTransition(() => this.startRound(), 500);
    }

    hostReset() {
        clearTimeout(this.roundTimer);
        clearTimeout(this.bonusGuessTimer);
        this._clearTransition();
        this.started           = false;
        this.paused            = false;
        this.currentRound      = null;
        this.bonus             = null;
        this.bonusRoundsPlayed = 0;
        this.players           = {};
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
        if (this.bonusGuessTimer && this.bonus?.guessOpen) {
            this.bonusRemaining = Math.max(0, this.bonusEndsAt - Date.now());
            clearTimeout(this.bonusGuessTimer);
            this.bonusGuessTimer = null;
        }
        if (this.pendingTransition) {
            this.pendingTransition.remaining = Math.max(0, this.pendingTransition.endsAt - Date.now());
            clearTimeout(this.pendingTransition.timer);
            this.pendingTransition.timer = null;
        }

        this.nsp.emit("gamePaused");
        this.emitHostState();
    }

    hostResume() {
        if (!this.started || !this.paused) return;
        this.paused = false;

        let resumeRoundMs = null;
        let resumeBonusMs = null;

        if (this.currentRound?.active && this.roundRemaining != null) {
            resumeRoundMs = this.roundRemaining;
            this.roundEndsAt = Date.now() + this.roundRemaining;
            this.roundTimer  = setTimeout(() => this.endRound(), this.roundRemaining);
            this.roundRemaining = null;
        }
        if (this.bonus?.guessOpen && this.bonusRemaining != null) {
            resumeBonusMs = this.bonusRemaining;
            this.bonusEndsAt     = Date.now() + this.bonusRemaining;
            this.bonusGuessTimer = setTimeout(() => this._bonusExpire(), this.bonusRemaining);
            this.bonusRemaining  = null;
        }
        if (this.pendingTransition && this.pendingTransition.remaining != null) {
            const t = this.pendingTransition;
            t.endsAt = Date.now() + t.remaining;
            t.timer = setTimeout(() => { this.pendingTransition = null; t.fn(); }, t.remaining);
            t.remaining = null;
        }

        this.nsp.emit("gameResumed", {
            roundTimeRemaining: resumeRoundMs,
            bonusTimeRemaining: resumeBonusMs,
        });
        this.emitHostState();
    }

    hostConfig({ roundTime, maxBonusRounds, autoplay, giftBonus, minGiftValue } = {}) {
        if (roundTime      != null) this.roundTime      = Math.max(5000, parseInt(roundTime) || DEFAULT_ROUND_TIME);
        if (maxBonusRounds != null) this.maxBonusRounds = Math.max(1, parseInt(maxBonusRounds) || DEFAULT_BONUS_ROUNDS);
        if (autoplay       != null) this.autoplay       = !!autoplay;
        if (giftBonus      != null) this.giftBonus      = !!giftBonus;
        if (minGiftValue   != null) this.minGiftValue   = Math.max(0, parseInt(minGiftValue) || 0);
        this.emitHostState();
    }

    // ── Host state ────────────────────────────────────────────────────────────

    _hostStatePayload() {
        return {
            started:           this.started,
            paused:            this.paused,
            autoplay:          this.autoplay,
            giftBonus:         this.giftBonus,
            minGiftValue:      this.minGiftValue,
            roundTime:         this.roundTime,
            maxBonusRounds:    this.maxBonusRounds,
            bonusRoundsPlayed: this.bonusRoundsPlayed,
            scores:            this.getBoard(),
        };
    }

    emitHostState() {
        this.nsp.emit("hostState", this._hostStatePayload());
    }

    // ── Gifts ─────────────────────────────────────────────────────────────────

    handleGift(username, coins) {
        if (!this.started) return;
        if (!this.players[username]) this.players[username] = { score: 0 };
        if (this.giftBonus && (coins || 0) >= this.minGiftValue) {
            this.maxBonusRounds++;
        }
        this.nsp.emit("giftReceived", {
            username,
            coins:             coins || 0,
            maxBonusRounds:    this.maxBonusRounds,
            bonusRoundsPlayed: this.bonusRoundsPlayed,
        });
        this.emitHostState();
    }

    // ── Chat guess ────────────────────────────────────────────────────────────

    handleChatGuess(username, message) {
        if (!this.started || this.paused) return;
        if (!this.players[username]) this.players[username] = { score: 0 };

        if (this.bonus?.guessOpen && this.bonus.playerId === username) {
            this.handleBonusGuess(username, message);
        } else if (this.currentRound?.active) {
            this.handleGuess(username, message);
        }
    }

    // ── Main rounds ───────────────────────────────────────────────────────────

    startRound() {
        const puzzle = this.randomPuzzle();
        this.currentRound = { puzzle, winners: [], active: true };

        this.nsp.emit("roundStart", {
            image:        `${IMAGE_URL_PREFIX}/${puzzle.file}`,
            time:         this.roundTime,
            bonusWaiting: !!this.bonus,
        });

        this.roundEndsAt = Date.now() + this.roundTime;
        this.roundTimer  = setTimeout(() => this.endRound(), this.roundTime);
    }

    handleGuess(username, guess) {
        if (!this.currentRound?.active) return;
        if (this.currentRound.winners.includes(username)) return;

        guess = normalize(guess);
        const dist = levenshtein.get(guess, this.currentRound.puzzle.answer);

        if (dist <= 2) {
            this.currentRound.winners.push(username);
            const position = this.currentRound.winners.length;
            this.nsp.emit("correctGuess", { username, position });
            this.emitHostState();
            if (position >= 10) this.endRound();
        }
    }

    endRound() {
        if (!this.currentRound?.active) return;
        clearTimeout(this.roundTimer);
        this.currentRound.active = false;

        this.awardPoints();

        this.nsp.emit("roundEnd", {
            answer:  this.currentRound.puzzle.answer,
            winners: this.currentRound.winners,
        });

        this.emitHostState();

        if (this.currentRound.winners.length > 0) {
            this._scheduleTransition(() => this.startBonusTurn(this.currentRound.winners[0]), 4000);
        } else {
            this._scheduleTransition(() => this.showLeaderboard(), 4000);
        }
    }

    awardPoints() {
        this.currentRound.winners.forEach((username, index) => {
            const points = 10 - index;
            if (points > 0 && this.players[username]) {
                this.players[username].score += points;
            }
        });
    }

    // ── Bonus rounds ──────────────────────────────────────────────────────────

    startBonusTurn(username) {
        if (!this.bonus) {
            this.bonus = {
                puzzle:    this.randomPuzzle(),
                tileOrder: [0,1,2,3,4,5,6,7,8].sort(() => Math.random() - 0.5),
                revealed:  [],
                playerId:  null,
                guessOpen: false,
            };
        }

        this.bonus.playerId  = username;
        this.bonus.guessOpen = false;

        const nextTile = this.bonus.tileOrder[this.bonus.revealed.length];
        this.bonus.revealed.push(nextTile);
        this.bonus.guessOpen = true;

        const tilesLeft   = 9 - this.bonus.revealed.length;
        const bonusPoints = (tilesLeft + 1) * 5;

        this.nsp.emit("bonusTurn", {
            player:    username,
            image:     `${IMAGE_URL_PREFIX}/${this.bonus.puzzle.file}`,
            revealed:  [...this.bonus.revealed],
            bonusPoints,
            guessTime: this.bonusTime,
        });

        this.bonusEndsAt     = Date.now() + this.bonusTime;
        this.bonusGuessTimer = setTimeout(() => this._bonusExpire(), this.bonusTime);
    }

    _bonusExpire() {
        if (!this.bonus) return;
        this.bonus.guessOpen = false;
        this.nsp.emit("bonusGuessExpired");

        if (this.bonus.revealed.length >= 9) {
            this.retireBonus(null, 0, this.bonus.puzzle.answer);
        } else {
            this._scheduleTransition(() => this.showLeaderboard(), 2000);
        }
    }

    handleBonusGuess(username, guess) {
        if (!this.bonus?.guessOpen) return;
        if (username !== this.bonus.playerId) return;

        guess = normalize(guess);
        const answer = this.bonus.puzzle.answer;
        const dist   = levenshtein.get(guess, answer);

        if (dist <= 2) {
            clearTimeout(this.bonusGuessTimer);
            this.bonus.guessOpen = false;

            const tilesLeft   = 9 - this.bonus.revealed.length;
            const bonusPoints = (tilesLeft + 1) * 5;

            if (this.players[username]) this.players[username].score += bonusPoints;

            this.retireBonus(username, bonusPoints, answer);
        } else {
            this.nsp.emit("bonusWrongGuess", { username });
        }
    }

    retireBonus(winner, bonusPoints, answer) {
        this.bonus = null;
        this.bonusRoundsPlayed++;

        this.nsp.emit("bonusEnd", {
            answer,
            winner:            winner || null,
            bonusPoints:       winner ? bonusPoints : 0,
            bonusRoundsPlayed: this.bonusRoundsPlayed,
            maxBonusRounds:    this.maxBonusRounds,
        });

        this.emitHostState();

        const delay = winner ? 3000 : 2000;
        if (this.bonusRoundsPlayed >= this.maxBonusRounds) {
            this._scheduleTransition(() => this.gameOver(), delay);
        } else {
            this._scheduleTransition(() => this.showLeaderboard(), delay);
        }
    }

    // ── Leaderboard / game over ───────────────────────────────────────────────

    showLeaderboard() {
        this.nsp.emit("leaderboard", {
            board:             this.getBoard(),
            bonusRoundsPlayed: this.bonusRoundsPlayed,
            maxBonusRounds:    this.maxBonusRounds,
        });
        this._scheduleTransition(() => this.startRound(), 8000);
    }

    gameOver() {
        this.started = false;
        this.nsp.emit("gameOver", this.getBoard());

        if (this.autoplay) {
            this._scheduleTransition(() => {
                this.hostStart({
                    maxBonusRounds: this.maxBonusRounds,
                    roundTime:      this.roundTime,
                    autoplay:       true,
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

module.exports = SwysGame;
