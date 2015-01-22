const Factoids = require("./factoids");
const format = require('util').format;
const Promise = require('bluebird');

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

        const adminPlugin = client.getRole("admin");

        console.log(require('util').inspect(adminPlugin));

        var requiresAdmin, isAdmin;
        if (adminPlugin) {
            requiresAdmin = adminPlugin.requiresAdmin;
            isAdmin = adminPlugin.isAdmin;
        } else {
            isAdmin = function () { return Promise.resolve(false); }
        }

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
                return value;
            }
            
            client.note("factoids", "No key found.");

            if (respondWhenNoKey) {
                return format("No such factoid '%s' found.", key);
            } else {
                return /* no response */;
            }
        }

        const handlers = {
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
                // args is [key, description]
                const args = splitAt(command.args.join(" "), "=");
                const key = trim(args[0]);
                const description = function (input) {
                    const trimmed = trim(input);
                    const lowered = trimmed.toLowerCase();

                    if (trimmed.length === 0) {
                        return {message: ""};
                    }

                    if (startsWith(lowered, actPrefix)) {
                        return {
                            intent: "act",
                            message: trimmed.slice(actPrefix.length),
                            editor: command.hostmask,
                            isAdmin: isAdmin
                        };
                    } else if (startsWith(lowered, replyPrefix)) {
                        return {
                            intent: "say",
                            message: trimmed.slice(replyPrefix.length),
                            editor: command.hostmask,
                            isAdmin: isAdmin
                        };
                    } else if (startsWith(lowered, aliasPrefix)) {
                        return {
                            intent: "alias",
                            message: trimmed.slice(aliasPrefix.length),
                            editor: command.hostmask,
                            isAdmin: isAdmin
                        };
                    } else {
                        return {
                            intent: "say",
                            message: format("%s is %s", key, trimmed),
                            editor: command.hostmask,
                            isAdmin: isAdmin
                        };
                    }
                }(args[1]);

                if (key === "") {
                    return "Invalid format. No key specified.";
                }

                if (description.message === "") {
                    return "Invalid format. Missing either '=' or factoid description.";
                }

                return factoids.set(key, description).then(function (success) {
                    if (success) {
                        client.note("FactoidsPlugin", format("Factoid: '%s' => [%s] %s", key, description.intent, description.message));
                        return format("Learned factoid '%s'", key);
                    } else {
                        return format("Cannot (re)learn factoid '%s'! Factoid is locked.", key);
                    }
                }).catch(function (err) {
                    client.say(command.channel, "Error: Internal Error.");
                    throw err;
                });
            },

            "!forget": function (command) {
                if (command.args.length === 0) {
                    return "No factoid specified.";
                }

                const key = command.args.join(" ");
                client.note("factoids", format("forgetting: %s", key));

                if (!factoids.get(key)) {
                    return format("Factoid '%s' does not exist.", key);
                }

                return factoids.delete(key, command.hostmask, isAdmin).then(function (res) {
                    const success = res[0];
                    const failReason = res[1];
                    if (success) {
                        return format("Forgotten factoid '%s'", key);
                    } else if (failReason === "frozen") {
                        return format("Cannot forget factoid '%s'. Factoid is locked.", key);
                    } else {
                        return format("Factoid by the key '%s' does not exist.", key);
                    }
                });
            }
        };

        const helpfiles = {
            "factoid": [
                "{{!}}factoid factoid-name",
                "",
                "Look up a factoid."
            ],

            "learn": [
                "{{!}}learn factoid-name = faction-description",
                "",
                "Adds a factoid to the factoids database.",
                "Can also change a factoid.",
                "",
                "Use <reply> to leave out the '{{factoid-name}} is' prefix.",
                "Use <act> to make the bot respond as an action."
            ],

            "forget": [
                "{{!}}forget factoid-name"
            ]
        };

        if (requiresAdmin) {
            handlers["!lock"] = requiresAdmin(function (command) {
                const factoid = command.args.join(" ").toLowerCase()
                factoids.freeze(factoid);
                return format("Locked factoid '%s'.", factoid);
            });

            helpfiles["lock"] = [
                "{{!}}lock factoid-name",
                "",
                "Locks a factoid so only an admin can edit it.",
                "Requires admin privileges.",
                "Use {{!}}unlock to undo this."
            ];

            handlers["!unlock"] = requiresAdmin(function (command) {
                const factoid = command.args.join(" ").toLowerCase()
                factoids.unfreeze(factoid);
                return format("Locked factoid '%s'.", factoid);
            });

            helpfiles["unlock"] = [
                "{{!}}unlock factoid-name",
                "",
                "Unlocks a locked factoid so that anybody can edit it.",
                "Requires admin privileges."
            ];
        }

        return {
            handlers: handlers,
            help: helpfiles,
            commands: Object.keys(handlers).map(function (command) { return command.slice(1); })
        };
    }
};