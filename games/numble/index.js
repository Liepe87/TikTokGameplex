const NumbleGame = require("./game");

module.exports = {
    meta: {
        id:          "numble",
        name:        "Numble",
        description: "Guess a number between 0 and 100. Closest to the target wins the most points!",
    },
    createInstance: (nsp) => new NumbleGame(nsp),
};
