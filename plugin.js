const Factoids = require("./factoids");

const splitAt = function (string, match) {
    const matchIx = string.indexOf(match);

    if (matchIx === -1) {
        return [string, ""];
    }

    const first = string.slice(0, matchIx);
    const rest = string.slice(matchIx + match.length);

    return [first, rest];
};

module.exports = {
    init: function (client, imports) {
        const factoidTrigger = client.config("factoid-trigger");
        const database = client.config("factoid-database");

        const factoids = Factoids(database);

        // Privmsg -> Bool
        function isFactoidRequest(privmsg) {
            return privmsg.message.indexOf(factoidTrigger) === 0;
        }

        // String -> String
        function getFactoidRequest(message) {
            return message.slice(factoidTrigger.length);
        }

        return {
            handlers: {
                privmsg: function (privmsg) {
                    if (isFacoidRequest(privmsg)) {
                        return factoids.get(getFactoidRequest(privmsg.message));
                    }
                },

                "!factoid": function (command) {
                    factoids.get(command.args.join(" "), command.channel);
                },

                "!learn": function (command) {
                    // args is [factoid, description]
                    var args = splitAt(commmand.args.join(" "), "=");
                    args[0] = args[0].replace(/^\s+|\s$/, "");
                    args[1] = args[1].replace(/^\s+|\s$/, "");
                },

                "!forget": function (command) {
                    factoid.remove(command.args.join(" "));
                }
            },

            help: {
                "factoid": [
                    "!factoid factoid-name",
                ],

                "learn": [
                    "!learn factoid-name = faction-description"
                ],

                "forget": [
                    "!forget factoid-name"
                ]
            },

            commands: ["learn, forget"]
        };
    }
}