const { WebcastPushConnection } = require("tiktok-live-connector");

/**
 * Thin wrapper around tiktok-live-connector that forwards chat and gift
 * events into the launcher. One connection is reused across games — the
 * launcher decides which game (if any) actually sees the events.
 *
 * If the connection fails, the launcher keeps running so the host can
 * simulate events via the /chat and /gift endpoints.
 */
function connectTikTok(username, launcher) {
    const tiktok = new WebcastPushConnection(username);

    tiktok.connect()
        .then(() => console.log(`[tiktok] connected to @${username}`))
        .catch(err => {
            console.warn(`[tiktok] connection failed: ${err.message}`);
            console.warn(`[tiktok] server will still run — use POST /chat and POST /gift to simulate.`);
        });

    tiktok.on("chat", data => {
        launcher.handleChat(data.nickname, data.comment);
    });

    tiktok.on("gift", data => {
        // Filter streak gifts so we only count them once at the end.
        if (data.giftType === 1 && !data.repeatEnd) return;
        const coins = (data.diamondCount || 0) * (data.repeatCount || 1);
        launcher.handleGift(data.nickname, coins);
    });

    tiktok.on("disconnected", () => {
        console.warn("[tiktok] disconnected. reconnecting in 5s…");
        setTimeout(() => tiktok.connect().catch(() => {}), 5000);
    });

    return tiktok;
}

module.exports = { connectTikTok };
