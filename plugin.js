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
            return message.slice(factoidTrigger.length).replace(/^\s+|\s$/g, "").replace(/\s+/g, " ");
        }

        return {
            handlers: {
                privmsg: function (privmsg) {
                    if (isFactoidRequest(privmsg)) {
                        client.note("factoids", "getting factoid: " + privmsg.message);
                        return factoids.get(getFactoidRequest(privmsg.message));
                    }
                },

                "!factoid": function (command) {
                    client.note("factoids", "getting factoid: " + command.args.join(" "));
                    return factoids.get(command.args.join(" "), command.channel);
                },

                "!learn": function (command) {
                    // args is [factoid, description]
                    var args = splitAt(command.args.join(" "), "=");
                    args[0] = args[0].replace(/^\s+|\s$/g, "");
                    args[1] = args[1].replace(/^\s+|\s$/g, "");

                    client.note("factoids", "learning that " + args[0] + " = " + args[1]);
                    factoids.set(args[0], args[1]);

                    return "Learned!";
                },

                "!forget": function (command) {
                    client.note("factoids", "forgetting: " + command.args.join(" "));
                    factoids.delete(command.args.join(" "));

                    return "Forgotten!"
                }
            },

            help: {
                "factoids": [
                    "Commands: !factoid, !learn, !forget",
                    "",
                    "A factoid system is a user-addable dictionary.",
                    "You can lookup facts, teach new facts to me,",
                    "and make me forget certain facts.",
                    "",
                    "You can look up factoids with either !factoid <factoid name>",
                    "or you can use",
                    factoidTrigger + " <factoid name>",
                    "",
                    "A factoid name cannot contain an equals sign (=)."
                ],
                "factoid": [
                    "!factoid factoid-name",
                    "",
                    "Looks up a factoid."
                ],

                "learn": [
                    "!learn factoid-name = faction-description",
                    "",
                    "Add a factoid to the system."
                ],

                "forget": [
                    "!forget factoid-name",
                    "",
                    "Remove a factoid from the system."
                ]
            },

            commands: ["learn, forget"]
        };
    }
}