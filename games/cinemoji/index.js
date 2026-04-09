const CinemojiGame = require("./game");

module.exports = {
    meta: {
        id:          "cinemoji",
        name:        "Cinemoji",
        description: "Guess the movie from a string of emojis. First fingers to type the title win the round.",
    },
    createInstance: (nsp) => new CinemojiGame(nsp),
};
