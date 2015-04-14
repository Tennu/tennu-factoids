const Factoids = require("./factoids");
const format = require('util').format;
const Promise = require('bluebird');
// Promise.onPossiblyUnhandledRejection(function () {});
const Result = require('r-result');
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

// Binds the last `n` arguments of a function where `n` is the length of `args`.
const bindr = function (fn, args) {
    return function () {
        return fn.apply(null, Array.prototype.slice.call(arguments).concat(args));
    };
};

module.exports = {
    init: function (client, imports) {
        const commandTrigger = client.config("command-trigger");
        const factoidTrigger = client.config("factoids-trigger");
        const database = client.config("factoids-database");
        const maxAliasDepth = client.config("factoids-max-alias-depth") || 3;

        const adminPlugin = client.getRole("admin");
        var requiresAdmin, isAdmin;
        if (adminPlugin) {
            requiresAdmin = adminPlugin.requiresAdmin;
            isAdmin = adminPlugin.isAdmin;
        } else {
            isAdmin = function () { return Promise.resolve(false); }
        }

        const factoids = Factoids(database, isAdmin, maxAliasDepth);

        // Privmsg -> Bool
        function isFactoidRequest(privmsg) {
            return privmsg.message.indexOf(factoidTrigger) === 0;
        }

        // String -> String
        function getFactoidKey(message) {
            return trim(message.slice(factoidTrigger.length).replace(/\s+/g, " "));
        }

        function getFactoid (key, respondWhenNoKey) {
            return factoids.get(key)
            .unwrapOrElse(function (failureReason) {
                switch (failureReason) {
                    case "max-alias-depth-reached":
                        return "Error: Max alias depth reached.";
                    case "no-factoid":
                        client.note("PluginFactoids", format("Key '%s' not found.", key));
                        return respondWhenNoKey ? format("No such factoid '%s' found.", key) : undefined;
                    default:
                        client.error("PluginFactoids", format("Unhandled failure reason in !get: %s", failureReason));
                        return format("Error: Unhandled failure reason in getting factoid ('%s').", failureReason);
                }
            });
        }

        const handlers = {
            privmsg: function (privmsg) {
                if (isFactoidRequest(privmsg)) {
                    return getFactoid(getFactoidKey(privmsg.message), false);
                }
            },

            "!factoid": function (command) {
                if (command.args.length === 0) {
                    return "No factoid specified.";
                }

                return getFactoid(command.args.join(" "), true);
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
                    .then(bindr(Result.map, function (description) {
                        client.note("FactoidsPlugin", format("Factoid: '%s' => [%s] %s", key, description.intent, description.message));
                        return format("Learned factoid '%s'.", key);
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
                    .then(bindr(Result.map, function (description) {
                        client.note("FactoidsPlugin", format("Factoid: '%s' => [%s] %s", key, description.intent, description.message));
                        return format("Successfully did replacement on '%s'.", key);
                    }));
                }

                function alias (key, aliasedKey) {
                    return factoids.set(key, {
                        intent: "alias",
                        message: aliasedKey, 
                        editor: command.hostmask
                    })
                    .then(bindr(Result.map, function () {
                        client.note("FactoidsPlugin", format("Factoid: '%s' => [alias] %s", key, aliasedKey));
                        return format("Learned alias '%s' => '%s'.", key, aliasedKey);
                    }));
                }

                return Promise.try(function () {
                    if (!fullkey) {
                        return Fail("bad-format-no-key");
                    }

                    if (!description) {
                        return Fail("bad-format-no-desc");
                    }

                    return Ok();
                })
                .then(bindr(Result.andThen, function () {
                    switch (modifier) {
                        case "~": return edit(key, description);
                        case ":": return learn(key, format("%s is %s", key, description), "say");
                        case "!": return learn(key, description, "act");
                        case "+": return edit(key, format("s/$/%s/", description));
                        case "@": return alias(key, description);
                        default: return learn(trim(fullkey), description, "say");
                    }
                }))
                .then(bindr(Result.unwrapOrElse, function (failureReason) {
                    switch (failureReason) {
                        case "dne":                 return format("Cannot edit '%s'. Factoid does not exist.", key);
                        case "frozen":              return format("Cannot edit '%s'. Factoid is locked.", key);
                        case "unchanged":           return format("Replacement on '%s' had no effect.", key);
                        case "no-message-left":     return format("Cannot edit '%s'. Would leave factoid empty. Use %sforget instead.", key, commandTrigger);
                        case "bad-replace-format":  return format("Invalid replacement format. See %shelp learn replace for format.", commandTrigger);
                        case "bad-format-no-key":   return "Invalid format. No key specified.";
                        case "bad-format-no-desc":  return "Invalid format. No description specified.";
                        default:
                            client.error("PluginFactoids", format("Unhandled failure reason in !learn: %s", failureReason));
                            return format("Error: Unhandled failure reason in text replacement ('%s').", failureReason);
                    }
                }))
                .catch(function internalError (err) {
                    client.error("PluginFactoids", "Error: " + err.name);
                    client.error(err.stack);
                    client.say(command.channel, "Error: Internal Error.");
                });
            },

            "!forget": function (command) {
                var key;

                return Promise.try(function () {
                    if (command.args.length === 0) {
                        return Fail("no-args");
                    } else {
                        return Ok();
                    }
                })
                .then(bindr(Result.andThen, function () {
                    key = command.args.join(" ");
                    return factoids.delete(key, command.hostmask);
                }))
                .then(bindr(Result.andThen, function () {
                    client.note("PluginFactoids", format("Factoid forgotten: %s", key));
                    return Ok(format("Forgotten factoid '%s'", key));
                }))
                .then(bindr(Result.unwrapOrElse, function (reason) {
                    switch (reason) {
                        case "dne":     return format("Cannot forget factoid '%s'. Factoid does not exist.", key);
                        case "no-args": return        "Cannot forget factoid. No factoid specified.";
                        case "frozen":  return format("Cannot forget factoid '%s'. Factoid is locked.", key);
                        default:
                            client.error("PluginFactoids", format("Unhandled failure reason in !forget: %s", failureReason));
                            return format("Error: Unhandled failure reason in text replacement ('%s').", failureReason);
                    }
                }))
                .catch(function internalError (err) {
                    client.error("PluginFactoids", "Error: " + err.name);
                    client.error(err.stack);
                    client.say(command.channel, "Error: Internal Error.");
                });
            }
        };

        const helpfiles = {
            "factoids": [
                "Factoids are short descriptions for phrases often used",
                "for FAQs or inside jokes.",
                "",
                format("You can look up a factoid with `{{!}}factoid key` or %skey.", factoidTrigger),
                "You can teach this bot a factoid with `{{!}}learn`.",
                "You can also make the bot forget a factoid with `{{!}}forget key`.",
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
                    "{{!}}learn key @= other key",
                    "Makes key an alias for `other key`.",
                    format("There is a maximum alias depth of %s.", maxAliasDepth),
                    "Modifying the value with += or ~= modifies which key is being aliased,",
                    "not the value of the aliased key.",
                    " ",
                    "{{!}}learn key += amendment",
                    "Modifies an existing factoid to add more information.",
                    " ",
                    "{{!}}learn key ~= s/regexp/replacement/flags",
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