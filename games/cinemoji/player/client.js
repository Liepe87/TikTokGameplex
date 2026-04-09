/**
 * Cinemoji player client — runs inside the launcher's player shell.
 * Connects to the /cinemoji Socket.IO namespace and drives the UI fragment.
 *
 * Written to be idempotent-ish: if the shell loads this script more than
 * once during its lifetime (e.g. host swaps games back), previous timers
 * are stopped before new ones start.
 */
(function() {
    // Clean up any prior instance (in case this script is reloaded).
    if (window.__cinemojiCleanup) {
        try { window.__cinemojiCleanup(); } catch (e) {}
    }

    const socket = io("/cinemoji");
    let timerInterval = null;
    let countdownInterval = null;

    function showScreen(id) {
        document.querySelectorAll(".cinemoji-root .screen").forEach(s => s.classList.remove("active"));
        const el = document.getElementById(id);
        if (el) el.classList.add("active");
    }

    socket.on("gameReset", () => {
        stopTimer();
        clearInterval(countdownInterval);
        showScreen("cine-screen-waiting");
    });

    socket.on("gamePaused",  () => { stopTimer(); showToast("⏸ Game paused"); });
    socket.on("gameResumed", () => { showToast("▶ Game resumed"); });

    socket.on("giftReceived", ({ username, maxRounds, roundsPlayed }) => {
        const remaining = maxRounds - roundsPlayed;
        showToast(`🎁 ${username} sent a gift! +1 round (${remaining} left)`);
    });

    socket.on("roundStart", ({ emojis, time, roundsPlayed, maxRounds }) => {
        document.getElementById("cine-round-num").innerText   = roundsPlayed;
        document.getElementById("cine-round-total").innerText = maxRounds;
        document.getElementById("cine-emoji-display").innerText = emojis;
        // Re-trigger the pop animation by forcing a reflow.
        const stage = document.getElementById("cine-emoji-display");
        stage.style.animation = "none";
        void stage.offsetWidth;
        stage.style.animation = "";
        document.getElementById("cine-correct-count").innerText = "0 / 10 correct";
        document.getElementById("cine-round-answer").innerText  = "";
        document.getElementById("cine-guess-feed").innerHTML    = "";
        showScreen("cine-screen-game");
        startTimer("cine-timer", time);
    });

    socket.on("correctGuess", ({ username, position }) => {
        document.getElementById("cine-correct-count").innerText = `${position} / 10 correct`;
        const feed = document.getElementById("cine-guess-feed");
        const item = document.createElement("div");
        item.className = "guess-item";
        item.innerText = `#${position} ${username}`;
        feed.prepend(item);
        while (feed.children.length > 4) feed.removeChild(feed.lastChild);
    });

    socket.on("roundEnd", ({ answer }) => {
        stopTimer();
        document.getElementById("cine-round-answer").innerText = `Answer: ${answer}`;
    });

    socket.on("leaderboard", ({ board, roundsPlayed, maxRounds }) => {
        stopTimer();
        buildList("cine-lb-list", board);
        document.getElementById("cine-lb-progress").innerText =
            `Round ${roundsPlayed} of ${maxRounds} complete`;

        let secs = 6;
        document.getElementById("cine-lb-countdown").innerText = secs;
        clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
            secs--;
            const el = document.getElementById("cine-lb-countdown");
            if (el) el.innerText = secs;
            if (secs <= 0) clearInterval(countdownInterval);
        }, 1000);

        showScreen("cine-screen-leaderboard");
    });

    socket.on("gameOver", board => {
        stopTimer();
        clearInterval(countdownInterval);
        buildList("cine-gameover-list", board);
        showScreen("cine-screen-gameover");
    });

    function showToast(msg) {
        const toast = document.createElement("div");
        toast.className = "cinemoji-toast";
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
        if (!board.length) {
            ul.innerHTML = `<li style="color:var(--muted);justify-content:center;">No scores yet</li>`;
            return;
        }
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

    window.__cinemojiCleanup = () => {
        stopTimer();
        clearInterval(countdownInterval);
        try { socket.disconnect(); } catch (e) {}
    };
})();
