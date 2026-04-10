/**
 * StoryChain player client — runs inside the launcher's player shell.
 * Connects to the /storychain Socket.IO namespace and drives the UI fragment.
 */
(function() {
    if (window.__storychainCleanup) {
        try { window.__storychainCleanup(); } catch (e) {}
    }

    var socket = io("/storychain");
    var timerInterval = null;
    var story = [];

    function showScreen(id) {
        document.querySelectorAll(".sc-root .screen").forEach(function(s) { s.classList.remove("active"); });
        var el = document.getElementById(id);
        if (el) el.classList.add("active");
    }

    // ── Full state (on connect + after changes) ──────────────────────────────

    socket.on("hostState", function(state) {
        story = state.story || [];
        renderStory(false);
        updateWordCount();

        if (!state.started) {
            stopTimer();
            showScreen("sc-screen-waiting");
            return;
        }

        showScreen("sc-screen-game");

        if (state.currentPlayer) {
            setTurnInfo(state.currentPlayer, true);
        } else if (state.poolSize === 0) {
            setTurnInfo(null, false);
        } else {
            setTurnInfo(null, true);
        }
    });

    // ── Lifecycle events ─────────────────────────────────────────────────────

    socket.on("gameReset", function() {
        story = [];
        stopTimer();
        renderStory(false);
        updateWordCount();
        showScreen("sc-screen-waiting");
    });

    socket.on("gamePaused",  function() { stopTimer(); showToast("\u23F8 Game paused"); });
    socket.on("gameResumed", function() { showToast("\u25B6 Game resumed"); });

    socket.on("giftReceived", function(data) {
        showToast("\uD83C\uDF81 " + data.username + " sent a gift! They\u2019re next up!");
    });

    // ── Turn events ──────────────────────────────────────────────────────────

    socket.on("turnStart", function(data) {
        setTurnInfo(data.player, true);
        startTimer("sc-turn-timer", data.turnTime);
    });

    socket.on("wordAdded", function(data) {
        story.push({ word: data.word, author: data.author });
        renderStory(true);
        updateWordCount();
        addToFeed(data.author + ": " + data.word, "word");
        setTurnInfo(null, true);
        stopTimer();
    });

    socket.on("turnSkipped", function(data) {
        addToFeed(data.player + " was skipped", "skipped");
    });

    socket.on("playerJoined", function(data) {
        addToFeed(data.username + " joined (" + data.poolSize + " players)", "joined");
    });

    socket.on("waitingForPlayers", function() {
        setTurnInfo(null, false);
        stopTimer();
    });

    // ── Rendering helpers ────────────────────────────────────────────────────

    function renderStory(animate) {
        var el = document.getElementById("sc-story-text");
        if (!story.length) {
            el.innerHTML = '<span class="placeholder">The story will appear here\u2026</span>';
            return;
        }
        el.innerHTML = story.map(function(s, i) {
            var isLast = animate && i === story.length - 1;
            return isLast
                ? '<span class="latest-word">' + escapeHtml(s.word) + '</span>'
                : escapeHtml(s.word);
        }).join(" ");
        el.scrollTop = el.scrollHeight;
    }

    function updateWordCount() {
        var el = document.getElementById("sc-word-count");
        el.innerText = story.length + " word" + (story.length !== 1 ? "s" : "");
    }

    function setTurnInfo(player, hasPlayers) {
        var playerEl = document.getElementById("sc-turn-player");
        var hintEl   = document.getElementById("sc-turn-hint");
        if (player) {
            playerEl.innerHTML = '<b>' + escapeHtml(player) + '</b>, type a word!';
            hintEl.innerText = "Type your word in the chat";
        } else if (!hasPlayers) {
            playerEl.innerText = "Waiting for players\u2026";
            hintEl.innerText = "Type anything in chat to join!";
        } else {
            playerEl.innerText = "Next player incoming\u2026";
            hintEl.innerText = "";
        }
    }

    function addToFeed(text, type) {
        var feed = document.getElementById("sc-feed");
        var item = document.createElement("div");
        item.className = "feed-item" + (type ? " " + type : "");
        item.innerText = text;
        feed.prepend(item);
        while (feed.children.length > 5) feed.removeChild(feed.lastChild);
    }

    // ── Timer ────────────────────────────────────────────────────────────────

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
        var el = document.getElementById("sc-turn-timer");
        if (el) { el.innerText = "\u2013"; el.className = "timer"; }
    }

    // ── Utilities ────────────────────────────────────────────────────────────

    function showToast(msg) {
        var toast = document.createElement("div");
        toast.className = "sc-toast";
        toast.innerText = msg;
        document.body.appendChild(toast);
        setTimeout(function() { toast.classList.add("show"); }, 10);
        setTimeout(function() {
            toast.classList.remove("show");
            setTimeout(function() { toast.remove(); }, 400);
        }, 4000);
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, function(c) {
            return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
        });
    }

    window.__storychainCleanup = function() {
        stopTimer();
        try { socket.disconnect(); } catch (e) {}
    };
})();
