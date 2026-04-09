const SwysGame = require("./game");

module.exports = {
    meta: {
        id:          "swys",
        name:        "Say What You See",
        description: "Guess the catchphrase from the picture. Fastest fingers win, top scorer plays the bonus round.",
        thumbnail:   "/games/swys/images/spill_the_beans.jpg",
    },
    createInstance: (nsp) => new SwysGame(nsp),
};
