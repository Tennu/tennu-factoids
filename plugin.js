const Factoids = require("./factoids");
const format = require('util').format;
const Promise = require('bluebird');
// Promise.onPossiblyUnhandledRejection(function () {});
const Result = require('r-result');
const Ok = Result.Ok;
const Fail = Result.Fail;

const UNSAFE = false;
const SAFE = true;

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
    name: "factoids",

    configDefaults: {
        "factoids-max-alias-depth": 3,

        // 510 - "PRIVMSG #c n :" = 496.
        // 510 is the maximum length of an IRC message.
        // The string is the minimal number of non-message characters
        // in a private message sent from the server.
        "factoids-max-message-length": 496,

        "factoids-safe-replace": false
    },

    init: function (client, imports) {
        const commandTrigger = client.config("command-trigger");
        const factoidTrigger = client.config("factoids-trigger");
        const databaseLocation = client.config("factoids-database");
        const maxAliasDepth = client.config("factoids-max-alias-depth");
        const maxMessageLength = client.config("factoids-max-message-length");
        const safeReplace = client.config("factoids-safe-replace");
        const daemon = client.config("daemon");

        const adminPlugin = client.getRole("admin");
        var requiresAdmin, isAdmin;
        if (adminPlugin) {
            requiresAdmin = adminPlugin.requiresAdmin;
            isAdmin = adminPlugin.isAdmin;
        } else {
            isAdmin = function () { return Promise.resolve(false); }
        }

        const beforeUpdate = function (factoid) {
            if (factoid.intent === "say" && factoid.message[0] === "\u{1}") {
                return Fail("ctcp-command");
            }

            if (
                daemon === "twitch"
                && factoid.intent === "say"
                && (factoid.message[0] === "!" || factoid.message[0] === "/")
            ) {
                return Fail("maybe-twitch-command");
            }
            
            return Ok(factoid);
        };

        const factoids = Factoids({
            databaseLocation: databaseLocation, 
            isEditorAdmin: isAdmin,
            maxAliasDepth: maxAliasDepth,
            maxMessageLength: maxMessageLength,
            beforeUpdate: beforeUpdate,
            safeReplace: safeReplace
        });

        // Privmsg -> Bool
        function isFactoidRequest (privmsg) {
            return privmsg.message.indexOf(factoidTrigger) === 0;
        }

        // String -> String
        function getFactoidKey (message) {
            return trim(message.slice(factoidTrigger.length).replace(/\s+/g, " "));
        }

        function getFactoid (request, respondWhenNoKey) {
            var split = splitAt(request, "@");
            var key = trim(split[0]);
            var who = trim(split[1]);

            var response = factoids.get(key)
            .map(function (response) {
                if (who && response.intent === "say") {
                    response.message = format("%s: %s", who, response.message);
                }

                return response;
            })
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

            return response;
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

            "!factoid-metadata": function (command) {
                if (command.args.length === 0) {
                    return "No factoid specified.";
                }

                const key = command.args.join(" ");

                return factoids.getMetadata(key).match({
                    Ok: function (metadata) {
                        // {exists: Boolean, intent: String?, aliasTo: String?, lastEditor: String?, lastEditTime: Number?, frozen: boolean?}
                        const frozen = metadata.frozen ? "[LOCKED] " : "";
                        const intent = metadata.exists ? metadata.intent : "Forgotten";
                        const alias = intent === "alias" ? ` [${metadata.aliasTo}]` : "";
                        const editor = `${metadata.lastEditor.nickname}!${metadata.lastEditor.username}@${metadata.lastEditor.hostname}`;
                        const time = String(new Date(metadata.lastEditTime));
                        return `Factoid metadata for '${key}': ${frozen}Intent=${intent}${alias}; LastEdit=${editor} on ${time}`;
                    },

                    Fail: function (_failure) {
                        return `No factoid '${key}' ever created.`;
                    }
                });
            },

            "!learn": function (command) {
                // args is [key, description]
                const args = splitAt(command.args.join(" "), "=");
                const fullkey = args[0];
                const modifier = fullkey.slice(-1);
                const key = trim(fullkey.slice(0, -1));
                const description = trim(args[1]);

                function learn (key, description, intent, isSafeReplace) {
                    description = {
                        intent: intent,
                        message: trim(description),
                        editor: command.hostmask
                    };

                    return factoids.set(key, description, {isSafeReplace: isSafeReplace})
                    .then(bindr(Result.map, function (description) {
                        client.note("FactoidsPlugin", format("Factoid: '%s' => [%s] %s", key, description.intent, description.message));
                        return format("Learned factoid '%s'.", key);
                    }));
                }

                function edit (key, replacement) {
                    function extractReplacement (replacement) {
                        replacement = trim(replacement);

                        // This regular expression is made of layers.
                        // The outer layer is r### ^s/_/_/_$ ###
                        // The inner layer is r### (([^/]|\/)*) ###
                        // The third part just allows 'g's and 'i's.
                        // The inner layer is for allowing anything except
                        // for "/" except when escaped e.g. "\/".
                        // Because "\" and "/" are special characters, they're
                        // escaped in the regexp, making it a huge mess of
                        // forwards and backwards slashes.
                        //
                        // The match will return `null` if it fails to match,
                        // but if it succeeds, it'll return an array-like where
                        // the numbers chosen in the returned object are the
                        // matched groups. The 0th element is the entire match
                        // while the even elements are the last instance of the
                        // inner parenthesis group, which is the last character
                        // of the outer parenthesis group of the inner layer.
                        replacement = replacement.match(/^s\/(([^\/]|\\\/)*)\/(([^\/]|\\\/)*)\/([gi]*)$/);

                        if (replacement === null) {
                            return Fail("bad-replace-format");
                        } else {
                            return Ok({
                                find: replacement[1],
                                replace: replacement[3].replace(/\\\//g, "/"),
                                flags: replacement[5]
                            });
                        }
                    }

                    return Promise.try(function () {
                        return extractReplacement(replacement)
                        .andThen(function (replacementObject) {
                            // Cannot use a `const` inside the `try` block
                            // because in ES6, the `const` is only in scope
                            // within that block. Thus, hoisting it out of
                            // that block. Have to use `var` due to lack
                            // of expression based try/catch.
                            var regexp;
                            try {
                                regexp = new RegExp(replacementObject.find, replacementObject.flags);
                            } catch (e) {
                                return Fail("bad-replace-regexp");
                            }

                            return factoids.replace(key, regexp, replacementObject.replace, command.hostmask);
                        });
                    })
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
                        case ":": return learn(key, format("%s is %s", key, description), "say", UNSAFE);
                        case "!": return learn(key, description, "act", UNSAFE);
                        case "+": return edit(key, format("s/$/ %s/", description.replace(/\//g, "\\/")));
                        case "@": return alias(key, description);
                        case "f": /* fallthrough */
                        case "F": return learn(key, description, "say", SAFE);
                        default: return learn(trim(fullkey), description, "say", UNSAFE);
                    }
                }))
                .then(bindr(Result.unwrapOrElse, function (failureReason) {
                    switch (failureReason) {
                        case "dne":                 return format("Cannot edit '%s'. Factoid does not exist.", key);
                        case "frozen":               return format("Cannot edit '%s'. Factoid is locked.", key);
                        case "unchanged":            return format("Replacement on '%s' had no effect.", key);
                        case "no-message-left":      return format("Cannot edit '%s'. Would leave factoid empty. Use %sforget instead.", key, commandTrigger);
                        case "bad-replace-format":   return format("Invalid replacement format. See %shelp learn replace for format.", commandTrigger);
                        case "bad-replace-regexp":   return "Invalid replacement format. RegExp invalid.";
                        case "bad-format-no-key":    return "Invalid format. No key specified.";
                        case "bad-format-no-desc":   return "Invalid format. No description specified.";
                        case "ctcp-command":         return "Disallowed! Factoid message would be a CTCP command."
                        case "maybe-twitch-command": return "Disallowed! Factoid message could be a Twitch command.";
                        case "message-length-exceeded": return "Factoid too long.";
                        case "unsafe-replace": return format("Cannot rewrite '%s'. Use `%s f= new description` or !forget if you really wanted to replace.", key, key);
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
                " ",
                format("You can look up a factoid with `{{!}}factoid key` or %skey.", factoidTrigger),
                "You can teach this bot a factoid with `{{!}}learn`.",
                "You can also make the bot forget a factoid with `{{!}}forget key`.",
                "Admins can make certain factoids unmodifiable.",
                "For more information, do {{!}}help command-name."
            ],

            "factoid": [
                "{{!}}factoid key",
                format("%skey", factoidTrigger),
                " ",
                "Look up a factoid.",
                "Factoids are small messages this bot responds with.",
                "",
                "You may add an '@ nick' to the end to have the bot say",
                "the response to that user.",
                "",
                "See also: {{!}}learn, {{!}}forget"
            ],

            "factoid-metadata": [
                "{{!}}factoid-metadata key",
                " ",
                "Return metadata about factoid. Information is intent, existence, aliasing info, last editor, intent, and if locked.",
                "If factoid is an alias, will show alias to in square brackets after intent. e.g. `Intent=alias [other]` aliases to `other`.",
                "If factoid was forgotten, will show `Intent=Forgotten`.",
                "If factoid is locked, will show [LOCKED]."
            ],

            "learn": {
                "*": [
                    "{{!}}learn factoid-key = factiod-description",
                    " ",
                    "Adds a factoid to the factoids database.",
                    "This bot also supports a modifier before the `=`.",
                    "To see them, do {{!}}help learn formats",
                    " ",
                    "Keys may consist of all characters other than `=` and `@`."
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
                    "A space is automatically added between the prior description",
                    "and the amended text.",
                    " ",
                    "{{!}}learn key ~= s/regexp/replacement/flags",
                    "Modifies an existing factoid by finding the first match",
                    "of the regexp in the current factoid, and replacing it",
                    "with the replacement.",
                    "Escape '/' by doing '\\/'.",
                    "Flag: 'g' - Replaces all occurences of the RegExp",
                    "Flag: 'i' - Makes the RegExp case insensitive.",
                    "See also: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp"
                ]
            },

            "forget": [
                "{{!}}forget factoid-name",
                " ",
                "Removes the factoid entry from the factoids database."
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

        if (safeReplace) {
            helpfiles["learn"]["*"] = helpfiles["learn"]["*"].concat([
                "",
                "Safe mode is currently enabled. This means to replace a factoid",
                "you must either use !forget factoid and then !learn factoid = description",
                "or !learn factoid f= description."
            ]);

            helpfiles["learn"]["formats"] = helpfiles["learn"]["formats"].concat([
                "",
                "{{!}}learn key f= description",
                "Force relearn the factoid to the new description."
            ]);
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