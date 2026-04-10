/**
 * Test Panel — drop-in testing widget for Gameplex host panels.
 *
 * Usage: add <div id="test-panel"></div> to the host page, then load this
 * script with a data-game attribute set to the game ID:
 *
 *   <script src="/test-panel.js" data-game="numble"></script>
 *
 * Provides:
 *  1. Chat simulator   — send a single fake chat message
 *  2. Burst test       — fire N users x N messages in rapid succession
 *  3. Auto-player      — bots that send game-appropriate messages on a timer
 */
(function () {
    const scriptTag = document.currentScript;
    const GAME_ID   = scriptTag?.getAttribute("data-game") || "unknown";

    const container = document.getElementById("test-panel");
    if (!container) return;

    // ── Name pool for random usernames ───────────────────────────────────────

    const NAME_POOL = [
        "ace","blaze","cleo","dash","echo","fern","grit","haze","ivy","jett",
        "koda","luna","mars","nova","onyx","pax","quill","raze","sage","trix",
        "umbra","vex","wren","xeno","yuki","zara","bolt","chip","dusk","flint",
    ];

    function randomUsername() {
        const name = NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)];
        const num  = Math.floor(Math.random() * 900) + 100;
        return `${name}_${num}`;
    }

    // ── Game-aware message generators ────────────────────────────────────────

    const WORDS = [
        "the","moon","cat","happy","blue","river","fire","dream","cloud","star",
        "forest","shadow","light","wind","stone","magic","golden","silver","quick",
        "brave","lost","dark","wild","frozen","bright","storm","ocean","sky","tiny",
    ];

    const MOVIE_GUESSES = [
        "Titanic","Frozen","Jaws","Up","Avatar","Inception","Alien","Cars",
        "Bambi","Shrek","Moana","Coco","Mulan","Rocky","Grease","Speed",
        "Psycho","Brave","Bolt","Ratatouille","Gladiator","Memento","Her",
    ];

    const generators = {
        numble() {
            return String(Math.floor(Math.random() * 101));
        },
        storychain() {
            return WORDS[Math.floor(Math.random() * WORDS.length)];
        },
        cinemoji() {
            return MOVIE_GUESSES[Math.floor(Math.random() * MOVIE_GUESSES.length)];
        },
        swys() {
            // Random two-word guess
            const a = WORDS[Math.floor(Math.random() * WORDS.length)];
            const b = WORDS[Math.floor(Math.random() * WORDS.length)];
            return `${a} ${b}`;
        },
    };

    function generateMessage() {
        const gen = generators[GAME_ID];
        return gen ? gen() : "test";
    }

    // ── HTTP helpers ─────────────────────────────────────────────────────────

    async function sendChat(username, message) {
        await fetch("/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, message }),
        });
    }

    async function sendBulk(items) {
        await fetch("/chat/bulk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: items }),
        });
    }

    // ── Logging ──────────────────────────────────────────────────────────────

    let logEl;
    const MAX_LOG_LINES = 80;

    function log(text) {
        if (!logEl) return;
        const line = document.createElement("div");
        line.textContent = text;
        logEl.appendChild(line);
        while (logEl.childElementCount > MAX_LOG_LINES) {
            logEl.removeChild(logEl.firstChild);
        }
        logEl.scrollTop = logEl.scrollHeight;
    }

    // ── Auto-player state ────────────────────────────────────────────────────

    let autoTimer   = null;
    let autoBots    = [];

    function startAutoPlay(botCount, intervalMs) {
        stopAutoPlay();
        autoBots = Array.from({ length: botCount }, () => randomUsername());
        log(`Auto-play started: ${botCount} bot(s), every ${intervalMs}ms`);

        autoTimer = setInterval(() => {
            const bot = autoBots[Math.floor(Math.random() * autoBots.length)];
            const msg = generateMessage();
            sendChat(bot, msg);
            log(`${bot} \u2192 "${msg}"`);
        }, intervalMs);
    }

    function stopAutoPlay() {
        if (autoTimer) {
            clearInterval(autoTimer);
            autoTimer = null;
            log("Auto-play stopped");
        }
        autoBots = [];
    }

    // ── Render ────────────────────────────────────────────────────────────────

    container.className = "card full";
    container.innerHTML = `
        <h2>Test Panel</h2>

        <!-- Chat Simulator -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;">
            <div style="flex:1;min-width:120px;">
                <label>Username</label>
                <input type="text" id="tp-username" value="${randomUsername()}" style="width:100%;padding:10px 14px;border-radius:10px;border:2px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:var(--text);font-family:'Nunito',sans-serif;font-size:1rem;font-weight:700;outline:none;">
            </div>
            <div style="flex:2;min-width:160px;">
                <label>Message</label>
                <input type="text" id="tp-message" placeholder="Type a test message\u2026" style="width:100%;padding:10px 14px;border-radius:10px;border:2px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:var(--text);font-family:'Nunito',sans-serif;font-size:1rem;font-weight:700;outline:none;">
            </div>
            <button class="btn btn-apply" id="tp-send" style="width:auto;padding:10px 20px;">Send</button>
        </div>

        <!-- Burst Test -->
        <div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:end;">
            <div style="min-width:90px;">
                <label>Users</label>
                <input type="number" id="tp-burst-users" value="10" min="1" max="200" style="width:100%;padding:10px 14px;border-radius:10px;border:2px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:var(--text);font-family:'Nunito',sans-serif;font-size:1rem;font-weight:700;outline:none;">
            </div>
            <div style="min-width:90px;">
                <label>Msgs / user</label>
                <input type="number" id="tp-burst-msgs" value="1" min="1" max="20" style="width:100%;padding:10px 14px;border-radius:10px;border:2px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:var(--text);font-family:'Nunito',sans-serif;font-size:1rem;font-weight:700;outline:none;">
            </div>
            <div style="min-width:100px;">
                <label>Interval (ms)</label>
                <input type="number" id="tp-burst-interval" value="100" min="0" max="5000" step="50" style="width:100%;padding:10px 14px;border-radius:10px;border:2px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:var(--text);font-family:'Nunito',sans-serif;font-size:1rem;font-weight:700;outline:none;">
            </div>
            <button class="btn btn-start" id="tp-burst" style="width:auto;padding:10px 20px;">Fire Burst</button>
        </div>

        <!-- Auto-player -->
        <div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:end;">
            <div style="min-width:80px;">
                <label>Bots</label>
                <input type="number" id="tp-auto-bots" value="5" min="1" max="50" style="width:100%;padding:10px 14px;border-radius:10px;border:2px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:var(--text);font-family:'Nunito',sans-serif;font-size:1rem;font-weight:700;outline:none;">
            </div>
            <div style="min-width:110px;">
                <label>Interval (ms)</label>
                <input type="number" id="tp-auto-interval" value="2000" min="200" max="30000" step="100" style="width:100%;padding:10px 14px;border-radius:10px;border:2px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:var(--text);font-family:'Nunito',sans-serif;font-size:1rem;font-weight:700;outline:none;">
            </div>
            <button class="btn btn-start" id="tp-auto-start" style="width:auto;padding:10px 20px;">Start Auto-play</button>
            <button class="btn btn-reset" id="tp-auto-stop" style="width:auto;padding:10px 20px;" disabled>Stop</button>
        </div>

        <!-- Log -->
        <div id="tp-log" style="background:var(--surface);border-radius:10px;padding:12px;max-height:180px;overflow-y:auto;font-family:monospace;font-size:0.82rem;color:var(--muted);line-height:1.6;"></div>
    `;

    logEl = document.getElementById("tp-log");

    // ── Event handlers ───────────────────────────────────────────────────────

    // Single chat send
    document.getElementById("tp-send").addEventListener("click", () => {
        const username = document.getElementById("tp-username").value.trim() || randomUsername();
        const message  = document.getElementById("tp-message").value.trim() || generateMessage();
        sendChat(username, message);
        log(`${username} \u2192 "${message}"`);
    });

    document.getElementById("tp-message").addEventListener("keydown", (e) => {
        if (e.key === "Enter") document.getElementById("tp-send").click();
    });

    // Burst test
    document.getElementById("tp-burst").addEventListener("click", async () => {
        const userCount = Math.min(200, Math.max(1, parseInt(document.getElementById("tp-burst-users").value) || 10));
        const msgsEach  = Math.min(20, Math.max(1, parseInt(document.getElementById("tp-burst-msgs").value) || 1));
        const interval  = Math.max(0, parseInt(document.getElementById("tp-burst-interval").value) || 100);

        const users = Array.from({ length: userCount }, () => randomUsername());
        const total = userCount * msgsEach;
        log(`Burst: ${userCount} user(s) x ${msgsEach} msg(s) = ${total} total, ${interval}ms apart`);

        const btn = document.getElementById("tp-burst");
        btn.disabled = true;

        let sent = 0;
        for (let m = 0; m < msgsEach; m++) {
            // Build a batch for this wave
            const batch = users.map(u => ({ username: u, message: generateMessage() }));

            if (interval === 0) {
                // Fire entire wave at once via bulk endpoint
                sendBulk(batch);
                sent += batch.length;
                log(`  wave ${m + 1}: ${batch.length} messages (bulk)`);
            } else {
                // Stagger within the wave
                for (const item of batch) {
                    sendChat(item.username, item.message);
                    sent++;
                    if (interval > 0) await sleep(interval);
                }
                log(`  wave ${m + 1} complete (${sent}/${total})`);
            }
        }

        log(`Burst complete: ${sent} messages sent`);
        btn.disabled = false;
    });

    // Auto-player
    document.getElementById("tp-auto-start").addEventListener("click", () => {
        const bots     = Math.min(50, Math.max(1, parseInt(document.getElementById("tp-auto-bots").value) || 5));
        const interval = Math.max(200, parseInt(document.getElementById("tp-auto-interval").value) || 2000);
        startAutoPlay(bots, interval);
        document.getElementById("tp-auto-start").disabled = true;
        document.getElementById("tp-auto-stop").disabled  = false;
    });

    document.getElementById("tp-auto-stop").addEventListener("click", () => {
        stopAutoPlay();
        document.getElementById("tp-auto-start").disabled = false;
        document.getElementById("tp-auto-stop").disabled  = true;
    });

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
})();
