const Factoids = require("./factoids");
const format = require('util').format;

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

        const factoids = Factoids(database, client.debug.bind(client, "factoids"));

        // Privmsg -> Bool
        function isFactoidRequest(privmsg) {
            return privmsg.message.indexOf(factoidTrigger) === 0;
        }

        // String -> String
        function getFactoidRequest(message) {
            return message.slice(factoidTrigger.length).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
        }

        return {
            handlers: {
                privmsg: function (privmsg) {
                    if (isFactoidRequest(privmsg)) {
                        client.note("factoids", "getting factoid: " + privmsg.message);
                        return factoids.get(getFactoidRequest(privmsg.message), false);
                    }
                },

                "!factoid": function (command) {
                    if (command.args.length === 0) {
                        return "No factoid specified.";
                    }

                    client.note("factoids", "getting factoid: " + command.args.join(" "));
                    return factoids.get(command.args.join(" "), command.channel, true);
                },

                "!learn": function (command) {
                    // args is [factoid, description]
                    const args = splitAt(command.args.join(" "), "=");
                    const key = args[0].replace(/^\s+|\s+$/g, "");
                    const value = args[1].replace(/^\s+|\s+$/g, "");

                    if (key === "") {
                        return "Invalid format. Missing key.";
                    }

                    if (value === "") {
                        return "Invalid format. Missing '=' or factoid description.";
                    }

                    client.note("factoids", format("learning that %s = %s", key, value));
                    factoids.set(key, value);

                    return format("Learned factoid '%s'", key);
                },

                "!forget": function (command) {
                    if (command.args.length === 0) {
                        return "No factoid specified.";
                    }

                    const key = command.args.join(" ");
                    client.note("factoids", format("forgetting: %s", key));

                    if (!factoids.get(key)) {
                        return format("Factoid by the name '%s' does not exist.", key)
                    }
                    factoids.delete(command.args.join(" "));

                    return format("Forgotten factoid by name of '%s'", key);
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

            commands: ["factoid", "learn, forget"]
        };
    }
}