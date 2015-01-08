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

const trim = function (string) {
    return string.replace(/^\s+|\s+$/g, "");
};

const startsWith = function (string, prefix) {
    return string.indexOf(prefix) === 0;
};

const replyPrefix = "<reply>";
const actPrefix = "<act>";
const aliasPrefix = "<alias>";

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
        function getFactoidKey(message) {
            return trim(message.slice(factoidTrigger.length).replace(/\s+/g, " "));
        }

        function getFactoid (key, respondWhenNoKey) {
            const value = factoids.get(key);

            if (value) {
                console.log(util.inspect(value));
                return value;
            }
            
            log("factoids", "No key found.");

            if (respondWhenNoKey) {
                return format("No such factoid '%s' found.", key);
            } else {
                return /* no response */;
            }
        }

        return {
            handlers: {
                privmsg: function (privmsg) {
                    if (isFactoidRequest(privmsg)) {
                        client.note("factoids", "getting factoid: " + privmsg.message);
                        return getFactoid(getFactoidKey(privmsg.message), false);
                    }
                },

                "!factoid": function (command) {
                    if (command.args.length === 0) {
                        return "No factoid specified.";
                    }

                    client.note("factoids", "getting factoid: " + command.args.join(" "));
                    return getFactoid(command.args.join(" "), command.channel, true);
                },

                "!learn": function (command) {
                    // args is [factoid, description]
                    const args = splitAt(command.args.join(" "), "=");
                    const key = trim(args[0])
                    const value = function (input) {
                        const trimmed = trim(args[1]);
                        const lowered = trimmed.toLowerCase();

                        if (startsWith(lowered, actPrefix)) {
                            return {
                                intent: "act",
                                message: trimmed.slice(actPrefix.length)
                            };
                        } else if (startsWith(lowered, replyPrefix)) {
                            return {
                                intent: "say",
                                message: trimmed.slice(replyPrefix.length)
                            };
                        } else if (startsWith(lowered, aliasPrefix)) {
                            return {
                                intent: "alias",
                                message: trimmed.slice(aliasPrefix.length)
                            }
                        } else {
                            return {
                                intent: "say",
                                message: format("%s is %s", key, trimmed)
                            };
                        }
                    }(args[1]);

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
                    "!learn factoid-name = faction-description",
                    "",
                    "Adds a factoid to the factoids database.",
                    "Can also change a factoid.",
                    "",
                    "Use <reply> "
                ],

                "forget": [
                    "!forget factoid-name"
                ]
            },

            commands: ["factoid", "learn, forget"]
        };
    }
};