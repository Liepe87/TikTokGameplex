/**
 * SWYS player client — runs inside the launcher's player shell.
 * Connects to the /swys Socket.IO namespace and drives the UI fragment.
 *
 * Written to be idempotent-ish: if the shell loads this script more than
 * once during its lifetime (e.g. host swaps games back), previous timers
 * are stopped before new ones start.
 */
(function() {
    // Clean up any prior instance (in case this script is reloaded).
    if (window.__swysCleanup) {
        try { window.__swysCleanup(); } catch (e) {}
    }

    const socket = io("/swys");
    let timerInterval = null;
    let countdownInterval = null;
    let roundNumber = 0;

    function showScreen(id) {
        document.querySelectorAll(".swys-root .screen").forEach(s => s.classList.remove("active"));
        const el = document.getElementById(id);
        if (el) el.classList.add("active");
    }

    socket.on("gameReset", () => {
        roundNumber = 0;
        showScreen("screen-waiting");
    });

    socket.on("gamePaused",  () => { stopTimer(); showToast("⏸ Game paused"); });
    socket.on("gameResumed", () => { showToast("▶ Game resumed"); });

    socket.on("giftReceived", ({ username, maxBonusRounds, bonusRoundsPlayed }) => {
        const remaining = maxBonusRounds - bonusRoundsPlayed;
        showToast(`🎁 ${username} sent a gift! +1 bonus round (${remaining} remaining)`);
    });

    socket.on("roundStart", ({ image, time }) => {
        roundNumber++;
        document.getElementById("round-num").innerText = roundNumber;
        document.getElementById("puzzle-img").src = image;
        document.getElementById("correct-count").innerText = "0 / 10 correct";
        document.getElementById("round-answer").innerText = "";
        document.getElementById("guess-feed").innerHTML = "";
        showScreen("screen-game");
        startTimer("game-timer", time);
    });

    socket.on("correctGuess", ({ username, position }) => {
        document.getElementById("correct-count").innerText = `${position} / 10 correct`;
        const feed = document.getElementById("guess-feed");
        const item = document.createElement("div");
        item.className = "guess-item";
        item.innerText = `#${position} ${username}`;
        feed.prepend(item);
        while (feed.children.length > 4) feed.removeChild(feed.lastChild);
    });

    socket.on("roundEnd", ({ answer }) => {
        stopTimer();
        document.getElementById("round-answer").innerText = `Answer: ${answer}`;
    });

    socket.on("bonusTurn", ({ player, image, revealed, bonusPoints, guessTime }) => {
        document.getElementById("bonus-player").innerText = player;
        document.getElementById("bonus-img").src = image;
        document.getElementById("bonus-pts").innerText = `+${bonusPoints} pts available`;
        document.getElementById("bonus-feedback").innerText = "";
        renderTiles(revealed);
        showScreen("screen-bonus");
        startTimer("bonus-timer", guessTime);
    });

    socket.on("bonusGuessExpired", () => {
        stopTimer();
        document.getElementById("bonus-feedback").innerText = "Time's up! Next round winner gets a turn…";
        document.getElementById("bonus-pts").innerText = "";
    });

    socket.on("bonusWrongGuess", ({ username }) => {
        document.getElementById("bonus-feedback").innerText = `✗ ${username} — not quite!`;
    });

    socket.on("bonusEnd", ({ answer, winner, bonusPoints }) => {
        stopTimer();
        renderTiles([0,1,2,3,4,5,6,7,8]);
        if (winner) {
            document.getElementById("bonus-feedback").innerText = `🎉 ${winner} got it! +${bonusPoints} pts`;
            document.getElementById("bonus-pts").innerText = "";
        } else {
            document.getElementById("bonus-feedback").innerText = `Nobody got it! Answer: ${answer}`;
            document.getElementById("bonus-pts").innerText = "";
        }
    });

    function renderTiles(revealed) {
        for (let i = 0; i < 9; i++) {
            const t = document.getElementById(`tile-${i}`);
            if (t) t.classList.toggle("removed", revealed.includes(i));
        }
    }

    socket.on("leaderboard", ({ board, bonusRoundsPlayed, maxBonusRounds }) => {
        stopTimer();
        buildList("lb-list", board);
        document.getElementById("lb-progress").innerText =
            `Catchphrase round ${bonusRoundsPlayed} of ${maxBonusRounds}`;

        let secs = 8;
        document.getElementById("lb-countdown").innerText = secs;
        clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
            secs--;
            const el = document.getElementById("lb-countdown");
            if (el) el.innerText = secs;
            if (secs <= 0) clearInterval(countdownInterval);
        }, 1000);

        showScreen("screen-leaderboard");
    });

    socket.on("gameOver", board => {
        stopTimer();
        buildList("gameover-list", board);
        showScreen("screen-gameover");
    });

    function showToast(msg) {
        const toast = document.createElement("div");
        toast.className = "swys-toast";
        toast.innerText = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add("show"), 10);
        setTimeout(() => {
            toast.classList.remove("show");
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    }

    function buildList(listId, board) {
        const medals = ["🥇","🥈","🥉"];
        const ul = document.getElementById(listId);
        if (!ul) return;
        ul.innerHTML = "";
        board.forEach((p, i) => {
            const li = document.createElement("li");
            if (i === 0) li.classList.add("winner");
            li.innerHTML = `
                <span class="lb-rank">${medals[i] || i + 1}</span>
                <span class="lb-name">${p.username}</span>
                <span class="lb-score">${p.score}</span>
            `;
            ul.appendChild(li);
        });
    }

    function startTimer(elId, ms) {
        stopTimer();
        const el = document.getElementById(elId);
        if (!el) return;
        let remaining = ms;
        function tick() {
            const secs = Math.ceil(remaining / 1000);
            el.innerText = secs;
            el.className = "timer" + (secs <= 5 ? " urgent" : "");
            remaining -= 100;
            if (remaining < 0) remaining = 0;
        }
        tick();
        timerInterval = setInterval(tick, 100);
    }

    function stopTimer() {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    window.__swysCleanup = () => {
        stopTimer();
        clearInterval(countdownInterval);
        try { socket.disconnect(); } catch (e) {}
    };
})();
