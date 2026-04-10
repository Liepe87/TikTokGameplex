const socket = io();

const grid = document.getElementById("game-grid");
const activeName = document.getElementById("active-name");
const btnDeselect = document.getElementById("btn-deselect");

let lineup = [];
let activeGameId = null;

socket.on("launcherState", state => {
    lineup = state.lineup || [];
    activeGameId = state.activeGameId || null;
    render();
});

function render() {
    // Status bar
    if (activeGameId) {
        const active = lineup.find(g => g.id === activeGameId);
        activeName.textContent = active ? active.name : activeGameId;
        btnDeselect.disabled = false;
    } else {
        activeName.textContent = "— none —";
        btnDeselect.disabled = true;
    }

    // Game grid
    if (!lineup.length) {
        grid.innerHTML = `<div class="empty-state">No games registered.</div>`;
        return;
    }

    grid.innerHTML = "";
    for (const game of lineup) {
        const card = document.createElement("div");
        card.className = "game-card" + (game.id === activeGameId ? " active" : "");
        card.innerHTML = `
            <div class="game-body">
                <div class="game-name">${escapeHtml(game.name)}</div>
                <div class="game-desc">${escapeHtml(game.description || "")}</div>
            </div>
        `;
        card.addEventListener("click", () => selectGame(game.id));
        grid.appendChild(card);
    }
}

async function selectGame(gameId) {
    const res = await fetch("/launcher/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId }),
    });
    if (res.ok) {
        // Jump to that game's host panel.
        window.location.href = `/host/${gameId}`;
    } else {
        const err = await res.json().catch(() => ({}));
        alert(`Failed to select game: ${err.error || res.statusText}`);
    }
}

btnDeselect.addEventListener("click", async () => {
    if (!confirm("Return to lobby? The active game will be reset.")) return;
    await fetch("/launcher/deselect", { method: "POST" });
});

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
}
