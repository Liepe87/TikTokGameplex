/**
 * Player display shell.
 *
 * - Connects to the default Socket.IO namespace to track launcher state.
 * - When no game is active, shows the lineup of available games.
 * - When a game becomes active, fetches that game's player HTML fragment,
 *   injects it into #game-view, and loads its client script (which is
 *   expected to connect to its own namespace like "/swys").
 * - On game change, tears down the previous game's DOM + script.
 */

const socket = io();

const idleView = document.getElementById("idle-view");
const gameView = document.getElementById("game-view");
const lineupGrid = document.getElementById("lineup-grid");

let currentGameId = null;
let currentGameScript = null; // <script> element for the active game

socket.on("launcherState", state => {
    renderLineup(state.lineup || []);
    const nextGameId = state.activeGameId || null;
    if (nextGameId !== currentGameId) {
        switchGame(nextGameId, state.lineup || []);
    }
});

function renderLineup(lineup) {
    if (!lineup.length) {
        lineupGrid.innerHTML = `<p style="color:var(--muted);text-align:center;grid-column:1/-1;">No games loaded yet.</p>`;
        return;
    }
    lineupGrid.innerHTML = "";
    for (const game of lineup) {
        const card = document.createElement("div");
        card.className = "lineup-card";
        card.innerHTML = `
            <div class="lineup-body">
                <div class="lineup-name">${escapeHtml(game.name)}</div>
                <div class="lineup-desc">${escapeHtml(game.description || "")}</div>
            </div>
        `;
        lineupGrid.appendChild(card);
    }
}

async function switchGame(nextGameId, lineup) {
    // Tear down any existing game view + script.
    if (currentGameScript) {
        currentGameScript.remove();
        currentGameScript = null;
    }
    gameView.innerHTML = "";

    currentGameId = nextGameId;

    if (!nextGameId) {
        // Back to idle.
        gameView.classList.add("hidden");
        idleView.classList.remove("hidden");
        return;
    }

    // Load the game's player HTML fragment and client script.
    try {
        const htmlRes = await fetch(`/games/${nextGameId}/player/player.html`);
        if (!htmlRes.ok) throw new Error(`HTTP ${htmlRes.status}`);
        const html = await htmlRes.text();
        gameView.innerHTML = html;

        const script = document.createElement("script");
        script.src = `/games/${nextGameId}/player/client.js`;
        script.dataset.gameId = nextGameId;
        document.body.appendChild(script);
        currentGameScript = script;

        idleView.classList.add("hidden");
        gameView.classList.remove("hidden");
    } catch (err) {
        console.error(`[shell] failed to load game ${nextGameId}: ${err.message}`);
        gameView.innerHTML = `<p style="color:var(--muted);text-align:center;padding:40px;">Failed to load game: ${escapeHtml(err.message)}</p>`;
        gameView.classList.remove("hidden");
        idleView.classList.add("hidden");
    }
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
}
