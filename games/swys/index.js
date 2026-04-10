const SwysGame = require("./game");

module.exports = {
    meta: {
        id:          "swys",
        name:        "Say What You See",
        description: "Guess the catchphrase from the picture. Fastest fingers win, top scorer plays the bonus round.",
    },
    createInstance: (nsp) => new SwysGame(nsp),
};
