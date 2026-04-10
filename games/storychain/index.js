const StoryChainGame = require("./game");

module.exports = {
    meta: {
        id:          "storychain",
        name:        "StoryChain",
        description: "Build a story together, one word at a time. Get picked, type a word, pass it on!",
    },
    createInstance: (nsp) => new StoryChainGame(nsp),
};
