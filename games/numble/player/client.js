/**
 * Numble player client — runs inside the launcher's player shell.
 * Connects to the /numble Socket.IO namespace and drives the UI fragment.
 */
(function() {
    if (window.__numbleCleanup) {
        try { window.__numbleCleanup(); } catch (e) {}
    }

    const socket = io("/numble");
    let timerInterval = null;
    let countdownInterval = null;
    let revealInterval = null;

    function showScreen(id) {
        document.querySelectorAll(".numble-root .screen").forEach(s => s.classList.remove("active"));
        const el = document.getElementById(id);
        if (el) el.classList.add("active");
    }

    socket.on("gameReset", () => {
        stopTimer();
        clearInterval(countdownInterval);
        clearInterval(revealInterval);
        showScreen("numble-screen-waiting");
    });

    socket.on("gamePaused",  () => { stopTimer(); showToast("\u23F8 Game paused"); });
    socket.on("gameResumed", () => { showToast("\u25B6 Game resumed"); });

    socket.on("giftReceived", ({ username, maxRounds, roundsPlayed }) => {
        const remaining = maxRounds - roundsPlayed;
        showToast("\uD83C\uDF81 " + username + " sent a gift! +1 round (" + remaining + " left)");
    });

    socket.on("roundStart", ({ time, roundsPlayed, maxRounds }) => {
        document.getElementById("numble-round-num").innerText   = roundsPlayed;
        document.getElementById("numble-round-total").innerText = maxRounds;
        document.getElementById("numble-guess-count").innerText = "0";
        document.getElementById("numble-number-display").innerText = "?";
        document.getElementById("numble-number-display").classList.remove("reveal");
        document.getElementById("numble-guess-feed").innerHTML = "";
        showScreen("numble-screen-game");
        startTimer("numble-timer", time);
    });

    socket.on("guessReceived", ({ username, guessCount }) => {
        document.getElementById("numble-guess-count").innerText = guessCount;
        const feed = document.getElementById("numble-guess-feed");
        const item = document.createElement("div");
        item.className = "guess-item";
        item.innerText = username + " locked in!";
        feed.prepend(item);
        while (feed.children.length > 4) feed.removeChild(feed.lastChild);
    });

    socket.on("roundEnd", ({ target, results, totalGuesses }) => {
        stopTimer();

        // Animate number reveal: cycle random numbers then settle on target.
        var display = document.getElementById("numble-target-display");
        var cycles = 0;
        var maxCycles = 15;
        clearInterval(revealInterval);
        display.classList.remove("reveal");
        showScreen("numble-screen-results");

        revealInterval = setInterval(function() {
            display.innerText = Math.floor(Math.random() * 101);
            cycles++;
            if (cycles >= maxCycles) {
                clearInterval(revealInterval);
                display.innerText = target;
                display.classList.add("reveal");
                // Force animation restart.
                display.style.animation = "none";
                void display.offsetWidth;
                display.style.animation = "";
            }
        }, 80);

        document.getElementById("numble-results-subtitle").innerText = "The target was\u2026";
        document.getElementById("numble-results-total").innerText =
            totalGuesses + " player" + (totalGuesses !== 1 ? "s" : "") + " guessed";

        var medals = ["\uD83E\uDD47","\uD83E\uDD48","\uD83E\uDD49"];
        var ul = document.getElementById("numble-results-list");
        ul.innerHTML = "";
        if (!results.length) {
            ul.innerHTML = '<li style="color:var(--muted);justify-content:center;">No guesses this round</li>';
            return;
        }
        results.forEach(function(r, i) {
            var li = document.createElement("li");
            if (r.distance === 0) li.classList.add("exact");
            var distLabel = r.distance === 0
                ? '<span class="res-dist exact-label">EXACT!</span>'
                : '<span class="res-dist">off by ' + r.distance + '</span>';
            li.innerHTML =
                '<span class="res-rank">' + (medals[i] || (i + 1)) + '</span>' +
                '<span class="res-name">' + escapeHtml(r.username) + '</span>' +
                '<span class="res-guess">' + r.guess + '</span>' +
                distLabel;
            ul.appendChild(li);
        });
    });

    socket.on("leaderboard", ({ board, roundsPlayed, maxRounds }) => {
        stopTimer();
        buildList("numble-lb-list", board);
        document.getElementById("numble-lb-progress").innerText =
            "Round " + roundsPlayed + " of " + maxRounds + " complete";

        var secs = 6;
        document.getElementById("numble-lb-countdown").innerText = secs;
        clearInterval(countdownInterval);
        countdownInterval = setInterval(function() {
            secs--;
            var el = document.getElementById("numble-lb-countdown");
            if (el) el.innerText = secs;
            if (secs <= 0) clearInterval(countdownInterval);
        }, 1000);

        showScreen("numble-screen-leaderboard");
    });

    socket.on("gameOver", function(board) {
        stopTimer();
        clearInterval(countdownInterval);
        buildList("numble-gameover-list", board);
        showScreen("numble-screen-gameover");
    });

    function showToast(msg) {
        var toast = document.createElement("div");
        toast.className = "numble-toast";
        toast.innerText = msg;
        document.body.appendChild(toast);
        setTimeout(function() { toast.classList.add("show"); }, 10);
        setTimeout(function() {
            toast.classList.remove("show");
            setTimeout(function() { toast.remove(); }, 400);
        }, 4000);
    }

    function buildList(listId, board) {
        var medals = ["\uD83E\uDD47","\uD83E\uDD48","\uD83E\uDD49"];
        var ul = document.getElementById(listId);
        if (!ul) return;
        ul.innerHTML = "";
        if (!board.length) {
            ul.innerHTML = '<li style="color:var(--muted);justify-content:center;">No scores yet</li>';
            return;
        }
        board.forEach(function(p, i) {
            var li = document.createElement("li");
            if (i === 0) li.classList.add("winner");
            li.innerHTML =
                '<span class="lb-rank">' + (medals[i] || (i + 1)) + '</span>' +
                '<span class="lb-name">' + escapeHtml(p.username) + '</span>' +
                '<span class="lb-score">' + p.score + '</span>';
            ul.appendChild(li);
        });
    }

    function startTimer(elId, ms) {
        stopTimer();
        var el = document.getElementById(elId);
        if (!el) return;
        var remaining = ms;
        function tick() {
            var secs = Math.ceil(remaining / 1000);
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

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, function(c) {
            return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
        });
    }

    window.__numbleCleanup = function() {
        stopTimer();
        clearInterval(countdownInterval);
        clearInterval(revealInterval);
        try { socket.disconnect(); } catch (e) {}
    };
})();
