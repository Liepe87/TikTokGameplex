const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const GameRegistry = require("./launcher/gameRegistry");
const LauncherState = require("./launcher/launcherState");
const { connectTikTok } = require("./launcher/tiktok");

// ── TikTok username ───────────────────────────────────────────────────────────
// Put your TikTok username here (without the @)
const TIKTOK_USERNAME = "your_tiktok_username";

// ── App + Socket.IO ───────────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

// ── Load games and wire up the launcher ──────────────────────────────────────

const registry = new GameRegistry(path.join(__dirname, "games")).load();
const launcher = new LauncherState(io, registry);

// Send current launcher state to any client that connects to the default
// namespace (host lobby + player shell).
io.on("connection", socket => {
    socket.emit("launcherState", launcher.getPublicState());
});

// ── TikTok Live ───────────────────────────────────────────────────────────────

connectTikTok(TIKTOK_USERNAME, launcher);

// ── Static assets ─────────────────────────────────────────────────────────────

// Top-level launcher UI (player shell, host lobby, client scripts).
app.use(express.static(path.join(__dirname, "public")));

// Per-game static assets at /games/:gameId/*
// Only expose games that are registered.
app.use("/games/:gameId", (req, res, next) => {
    const entry = registry.get(req.params.gameId);
    if (!entry) return res.status(404).send("unknown game");
    express.static(entry.rootDir)(req, res, next);
});

// ── Localhost-only gate for host routes ───────────────────────────────────────

function localOnly(req, res, next) {
    const ip = req.socket.remoteAddress;
    const ok = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
    if (!ok) return res.status(403).send("Forbidden");
    next();
}

// ── Player shell ──────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "player.html"));
});

// ── Host lobby ────────────────────────────────────────────────────────────────

app.get("/host", localOnly, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "host-lobby.html"));
});

// Lobby data — list of registered games + currently active one.
app.get("/launcher/state", localOnly, (req, res) => {
    res.json(launcher.getPublicState());
});

// Select / deselect active game
app.post("/launcher/select", localOnly, (req, res) => {
    const { gameId } = req.body || {};
    try {
        launcher.selectGame(gameId);
        res.json({ ok: true, activeGameId: launcher.activeGameId });
    } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

app.post("/launcher/deselect", localOnly, (req, res) => {
    launcher.deselectGame();
    res.json({ ok: true });
});

// ── Per-game host panel page ──────────────────────────────────────────────────

app.get("/host/:gameId", localOnly, (req, res) => {
    const entry = registry.get(req.params.gameId);
    if (!entry) return res.status(404).send("unknown game");
    const hostHtml = path.join(entry.rootDir, "host", "host.html");
    res.sendFile(hostHtml);
});

// ── Per-game host controls ────────────────────────────────────────────────────
// Forwarded to the active game if gameId matches.
//
// If the host hits a host endpoint before picking the game, auto-select it
// first so the flow "visit /host/swys → press start" just works.

function ensureActive(gameId) {
    if (launcher.activeGameId !== gameId) launcher.selectGame(gameId);
}

app.post("/host/:gameId/start", localOnly, (req, res) => {
    try {
        ensureActive(req.params.gameId);
        launcher.forwardHostCall(req.params.gameId, "hostStart", req.body);
        res.json({ ok: true });
    } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

app.post("/host/:gameId/reset", localOnly, (req, res) => {
    try {
        ensureActive(req.params.gameId);
        launcher.forwardHostCall(req.params.gameId, "hostReset");
        res.json({ ok: true });
    } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

app.post("/host/:gameId/pause", localOnly, (req, res) => {
    try {
        launcher.forwardHostCall(req.params.gameId, "hostPause");
        res.json({ ok: true });
    } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

app.post("/host/:gameId/resume", localOnly, (req, res) => {
    try {
        launcher.forwardHostCall(req.params.gameId, "hostResume");
        res.json({ ok: true });
    } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

app.post("/host/:gameId/config", localOnly, (req, res) => {
    try {
        launcher.forwardHostCall(req.params.gameId, "hostConfig", req.body);
        res.json({ ok: true });
    } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

app.post("/host/:gameId/action", localOnly, (req, res) => {
    try {
        ensureActive(req.params.gameId);
        launcher.forwardHostCall(req.params.gameId, "hostAction", req.body);
        res.json({ ok: true });
    } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

// ── Simulation endpoints (localhost only) ─────────────────────────────────────

app.post("/chat", localOnly, (req, res) => {
    const { username, message } = req.body || {};
    if (username && message) launcher.handleChat(username, message);
    res.json({ ok: true });
});

app.post("/chat/bulk", localOnly, (req, res) => {
    const { messages } = req.body || {};
    if (Array.isArray(messages)) {
        for (const { username, message } of messages) {
            if (username && message) launcher.handleChat(username, message);
        }
    }
    res.json({ ok: true });
});

app.post("/gift", localOnly, (req, res) => {
    const { username, coins } = req.body || {};
    if (username) launcher.handleGift(username, parseInt(coins) || 0);
    res.json({ ok: true });
});

// ── Start server ──────────────────────────────────────────────────────────────

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Gameplex running — open http://localhost:${PORT}`);
    console.log(`Host panel:        http://localhost:${PORT}/host`);
    console.log(`Games loaded:      ${registry.list().map(g => g.id).join(", ") || "(none)"}`);
});
