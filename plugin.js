const Factoids = require("./factoids");
const format = require('util').format;
const Promise = require('bluebird');
const Result = require('./result');
const Ok = Result.Ok;
const Fail = Result.Fail;

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

const endsWith = function (string, postfix) {
    return string.lastIndexOf(postfix) === string.length - postfix.length;
};

module.exports = {
    init: function (client, imports) {
        const commandTrigger = client.config("command-trigger");
        const factoidTrigger = client.config("factoids-trigger");
        const database = client.config("factoids-database");

        const adminPlugin = client.getRole("admin");
        var requiresAdmin, isAdmin;
        if (adminPlugin) {
            requiresAdmin = adminPlugin.requiresAdmin;
            isAdmin = adminPlugin.isAdmin;
        } else {
            isAdmin = function () { return Promise.resolve(false); }
        }

        const factoids = Factoids(database, isAdmin);

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
            
            client.note("PluginFactoids", "No key found.");

            if (respondWhenNoKey) {
                return format("No such factoid '%s' found.", key);
            } else {
                return /* no response */;
            }
        }

        const handlers = {
            privmsg: function (privmsg) {
                if (isFactoidRequest(privmsg)) {
                    client.note("PluginFactoids", "Getting factoid: " + privmsg.message);
                    return getFactoid(getFactoidKey(privmsg.message), false);
                }
            },

            "!factoid": function (command) {
                if (command.args.length === 0) {
                    return "No factoid specified.";
                }

                client.note("PluginFactoids", "Getting factoid: " + command.args.join(" "));
                return getFactoid(command.args.join(" "), command.channel, true);
            },

            "!learn": function (command) {
                // args is [key, description]
                const args = splitAt(command.args.join(" "), "=");
                const fullkey = args[0];
                const modifier = fullkey.slice(-1);
                const key = trim(fullkey.slice(0, -1));
                const description = trim(args[1]);

                function learn (key, description, intent) {
                    description = {
                        intent: intent,
                        message: trim(description),
                        editor: command.hostmask
                    };

                    return factoids.set(key, description)
                    .then(Result.map(function (description) {
                        client.note("FactoidsPlugin", format("Factoid: '%s' => [%s] %s", key, description.intent, description.message));
                        return Ok(format("Learned factoid '%s'", key));
                    }));
                }

                function edit (key, replacement) {
                    replacement = trim(replacement).split("/");

                    if (replacement.length !== 4 || replacement[0] !== "s") {
                        return Promise.resolve(Fail("bad-replace-format"));
                    }

                    const search = replacement[1];
                    const replaceText = replacement[2];
                    const flags = trim(replacement[3]);

                    const regexp = new RegExp(search, flags);

                    return factoids.replace(key, regexp, replaceText, command.hostmask)
                    .then(Result.map(function (description) {
                        client.note("FactoidsPlugin", format("Factoid: '%s' => [%s] %s", key, description.intent, description.message));
                        return Ok(format("Successfully did replacement on '%s'.", key));
                    }));
                }

                return Promise.resolve()
                    .then(function () {
                    if (!fullkey) {
                        return Fail("bad-format-no-key");
                    }

                    if (!description) {
                        return Fail("bad-format-no-desc");
                    }

                    return Ok();
                })
                .then(Result.map(function () {
                    switch (modifier) {
                        case "~": return edit(key, description)
                        case ":": return learn(key, format("%s is %s", key, description), "say");
                        case "!": return learn(key, description, "act");
                        case "+": return edit(key, format("s/$/%s/", description));
                        default: return learn(trim(fullkey), description, "say");
                    }
                }))
                .then(Result.mapFail(function (failureReason) {
                    switch (failureReason) {
                        case "dne":                 return Ok(format("Cannot edit '%s'. Factoid does not exist.", key));
                        case "frozen":              return Ok(format("Cannot edit '%s'. Factoid is locked.", key));
                        case "unchanged":           return Ok(format("Replacement on '%s' had no effect.", key));
                        case "no-message-left":     return Ok(format("Cannot edit '%s'. Would leave factoid empty. Use %sforget instead.", key, commandTrigger));
                        case "bad-replace-format":  return Ok(format("Invalid replacement format. See %shelp learn replace for format.", commandTrigger));
                        case "bad-format-no-key":   return Ok("Invalid format. No key specified.");
                        case "bad-format-no-desc": return Ok("Invalid format. No description specified.");
                        default:
                            client.error("PluginFactoids", format("Unhandled failure reason in !learn: %s", failureReason));
                            return Ok(format("Error: Unhandled failure reason in text replacement ('%s').", failureReason));
                    }
                }))
                .then(Result.ok, function internalError (err) {
                    client.error("PluginFactoids", "Error: " + err.name);
                    client.error(err.stack);
                    client.say(command.channel, "Error: Internal Error.");
                });
            },

            "!forget": function (command) {
                var key;

                return Promise.resolve()
                .then(function () {
                    if (command.args.length === 0) {
                        return Fail("no-args");
                    } else {
                        return Ok();
                    }
                })
                .then(Result.map(function () {
                    key = command.args.join(" ");
                    return factoids.delete(key, command.hostmask);
                }))
                .then(Result.map(function () {
                    client.note("PluginFactoids", format("Factoid forgotten: %s", key));
                    return Ok(format("Forgotten factoid '%s'", key));
                }))
                .then(Result.mapFail(function (reason) {
                    switch (reason) {
                        case "dne":     return Ok(format("Cannot forget factoid '%s'. Factoid does not exist.", key));
                        case "no-args": return Ok(       "Cannot forget factoid. No factoid specified.");
                        case "frozen":  return Ok(format("Cannot forget factoid '%s'. Factoid is locked.", key));
                        default:
                            client.error("PluginFactoids", format("Unhandled failure reason in !forget: %s", failureReason));
                            return Ok(format("Error: Unhandled failure reason in text replacement ('%s').", failureReason));
                    }
                }))
                .then(Result.ok, function internalError (err) {
                    client.error("PluginFactoids", "Error: " + err.name);
                    client.error(err.stack);
                    client.say(command.channel, "Error: Internal Error.");
                });
            }
        };

        const helpfiles = {
            "factoids": [
                "Factoids are short descriptions for phrases often used"
                "for FAQs or inside jokes.",
                "",
                "You can look up a factoid with `{{!}}factoid key` or",
                "teach this bot a factoid with `{{!}}learn`. You can also",
                "make the bot forget a factoid with `{{!}}forget key`.",
                "Admins can make certain factoids unmodifiable.",
                "For more information, do {{!}}help command-name."
            ],

            "factoid": [
                "{{!}}factoid key",
                format("%skey", factoidTrigger),
                "",
                "Look up a factoid.",
                "Factoids are small messages this bot responds with.",
                "",
                "See also: {{!}}learn, {{!}}forget"
            ],

            "learn": {
                "*": [
                    "{{!}}learn factoid-key = factiod-description",
                    " ",
                    "Adds a factoid to the factoids database.",
                    "This bot also supports a modifier before the `=`.",
                    "To see them, do {{!}}help learn formats"
                ],

                "formats": [
                    "{{!}}learn key = description",
                    "Sets the bot to just say whatever the description is.",
                    " ",
                    "{{!}}learn key := description",
                    "As previous, but prefixes description with '<key> is '.",
                    "When using this, the case matters for your key.",
                    " ",
                    "{{!}}learn key != action",
                    "As the initial, but has the bot act the action.",
                    " ",
                    "{{!}}learn key += amendment",
                    "Modifies an existing factoid to add more information.",
                    " ",
                    "{{!}}learn ~= s/regexp/replacement/flags",
                    "Modifies an existing factoid by finding the first match",
                    "of the regexp in the current factoid, and replacing it",
                    "with the replacement.",
                    "Flag: 'g' - Replaces all occurences of the RegExp",
                    "Flag: 'i' - Makes the RegExp case insensitive.",
                    "See also: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp"
                ]
            },

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
                return format("Unlocked factoid '%s'.", factoid);
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
            commands: Object.keys(handlers)
                .filter(function (handler) { return handler[0] === "!"; })
                .map(function (command) { return command.slice(1); })
        };
    }
};