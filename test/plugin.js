// var sinon = require("sinon");
var assert = require("better-assert");
var equal = require("deep-eql");
var inspect = require("util").inspect;
var format = require("util").format;

var debug = false;
var logfn = debug ? console.log.bind(console) : function () {};

var Plugin = require("../plugin");
var Promise = require("bluebird");
var result = require("r-result");
var Ok = result.Ok;
var Fail = result.Fail;

var makeClient = function (opts) {
    var client = {};

    client.config = function (value) {
        return {
            "command-trigger": "!",
            "factoids-trigger": "@",
            "factoids-database": "", // In memory database.
            "factoids-max-alias-depth": Plugin.configDefaults["factoids-max-alias-depth"],
            "factoids-max-message-length": Plugin.configDefaults["factoids-max-message-length"],
            "factoids-safe-replace": opts.safeReplace || Plugin.configDefaults["factoids-safe-replace"],
            "daemon": opts.daemon || "unreal",
        }[value];
    };

    client.getRole = function (role) {
        // For now, we're not testing whether the admin
        // stuff is working. The plugin only optionally
        // depends on it.
        return undefined;
    };

    // These methods are used only in internal error handling.
    client.error = logfn;
    client.say = logfn;

    // This method is used for success cases.
    client.note = logfn;

    return client;
};

describe("Factoids plugin", function () {
    var plugin, client;
    var factoid, learn, forget;

    beforeEach(function () {
        client = makeClient({});
        plugin = Plugin.init(client);

        factoid = plugin.handlers["!factoid"];
        learn = plugin.handlers["!learn"];
        forget = plugin.handlers["!forget"];
    });

    describe("Basics", function () {
        it("can learn factoids with !learn", function () {
            return learn({
                args: ["x", "=", "y"],
                message: "!learn x = y",
                hostmask: "user!user@isp.net"
            })
            .then(function (response) {
                logfn(inspect(response));
                assert(response === "Learned factoid 'x'.");
            });
        });

        it("can look up factoids with !factoid key", function () {
            return learn({
                args: ["x", "=", "y"],
                message: "!learn x = y",
                hostmask: "user!user@isp.net"
            })
            .then(function () {
                return factoid({
                    args: ["x"]
                });
            })
            .then(function (response) {
                logfn(inspect(response));
                assert(equal(response, { intent: "say", message: "y" }));
            });
        });
    });

    describe("Aliasing", function () {
        it("can create an alias of a factoid", function () {
            return learn({
                args: ["x", "=", "y"],
                message: "!learn x = y",
                hostmask: "user!user@isp.net"
            })
            .then(function () {
                return learn({
                    args: ["y", "@=", "x"],
                    message: "!learn y @= x",
                    hostmask: "user!user@isp.net"
                });
            })
            .then(function (response) {
                logfn(inspect(response));
                assert(response === "Learned alias 'y' => 'x'.");
            });
        });

        it("can retrieve an alias of a factoid", function () {
            return learn({
                args: ["x", "=", "y"],
                message: "!learn x = y",
                hostmask: "user!user@isp.net"
            })
            .then(function () {
                return learn({
                    args: ["y", "@=", "x"],
                    message: "!learn y @= x",
                    hostmask: "user!user@isp.net"
                });
            })
            .then(function () {
                return factoid({
                    args: ["y"]
                });
            })
            .then(function (response) {
                assert(equal(response, { intent: "say", message: "y" }));
            })
        });

        it("errors out after max alias depth reached", function () {
            return learn({
                args: ["x", "@=", "x"],
                message: "!learn x @= x",
                hostmask: "user!user@isp.net"
            })
            .then(function () {
                return factoid({
                    args: ["x"]
                });
            })
            .then(function (response) {
                logfn(inspect(response));
                assert(response === "Error: Max alias depth reached.");
            });
        });
    });

    describe("editing", function () {
        it("can do simple find and replace", function () {
            return learn({
                args: ["x", "=", "Hello world."],
                message: "!learn x = Hello world.",
                hostmask: "user!user@isp.net"  
            })
            .then(function () {
                return learn({
                    args: ["x", "~=", "s/world/channel/"],
                    message: "!learn x ~= s/world/channel/",
                    hostmask: "user!user@isp.net"
                });
            })
            .then(function (replaceResponse) {
                logfn(inspect(replaceResponse));
                assert(replaceResponse === "Successfully did replacement on 'x'.");

                var getResponse = factoid({
                    args: ["x"]
                });

                logfn(inspect(getResponse));
                assert(equal(getResponse, {
                    intent: "say",
                    message: "Hello channel."
                }));
            });
        });

        it("can append simple text", function () {
            return learn({
                args: ["x", "=", "y"],
                message: "!learn x = y",
                hostmask: "user!user@isp.net"  
            })
            .then(function () {
                return learn({
                    args: ["x", "+=", "z"],
                    message: "!learn x += z",
                    hostmask: "user!user@isp.net"
                });
            })
            .then(function (replaceResponse) {
                logfn(inspect(replaceResponse));
                assert(replaceResponse === "Successfully did replacement on 'x'.");

                var getResponse = factoid({
                    args: ["x"]
                });

                logfn(inspect(getResponse));
                assert(equal(getResponse, {
                    intent: "say",
                    message: "y z"
                }));
            });
        });

        it("can append a URL", function () {
            return learn({
                args: ["x", "=", "y"],
                message: "!learn x = y",
                hostmask: "user!user@isp.net"  
            })
            .then(function () {
                return learn({
                    args: ["x", "+=", "| https://tennu.github.io/"],
                    message: "!learn x += | https://tennu.github.io/",
                    hostmask: "user!user@isp.net"
                });
            })
            .then(function (replaceResponse) {
                logfn(inspect(replaceResponse));
                assert(replaceResponse === "Successfully did replacement on 'x'.");

                var getResponse = factoid({
                    args: ["x"]
                });

                logfn(inspect(getResponse));
                assert(equal(getResponse, {
                    intent: "say",
                    message: "y | https://tennu.github.io/"
                }));
            });
        });

        it("needs a proper RegExp", function () {
            return learn({
                args: ["x", "=", "[y]"],
                message: "!learn x = [y]",
                hostmask: "user!user@isp.net"  
            })
            .then(function () {
                return learn({
                    // Note that `[` in a RegExp has special meaning and has to be closed.
                    // The valid format would be s/[[]/</, I think.
                    args: ["x", "~=", "s/[/</"],
                    message: "!learn x ~= s/[/</",
                    hostmask: "user!user@isp.net"
                });
            })
            .then(function (replaceResponse) {
                logfn(inspect(replaceResponse));
                assert(replaceResponse === "Invalid replacement format. RegExp invalid.");
            });
        });

        it("will declare when no change was made.", function () {
            return learn({
                args: ["x", "=", "y"],
                message: "!learn x = y",
                hostmask: "user!user@isp.net"
            })
            .then(function () {
                return learn({
                    args: ["x", "~=", "s/foo/bar/"],
                    message: "!learn x ~= s/foo/bar/",
                    hostmask: "user!user@isp.net"
                });
            })
            .then(function (replaceResponse) {
                logfn(inspect(replaceResponse));
                assert(replaceResponse === "Replacement on 'x' had no effect.");

                return factoid({
                    args: ["x"]
                });
            })
            .then(function (factoidResponse) {
                logfn(inspect(factoidResponse));
                assert(equal(factoidResponse, { intent: "say", message: "y" }));
            });
        });

        it("will not let you edit a factoid to be too long.", function () {
            const thirty_a = new Array(31).join("a");

            return learn({
                args: ["x", "=", thirty_a],
                message: `!learn x = ${thirty_a}`,
                hostmask: "user!user@isp.net"
            })
            .then(function () {
                return learn({
                    args: ["x", "~=", `s/a/${thirty_a}/g`],
                    message: `!learn x ~= s/a/${thirty_a}/g`,
                    hostmask: "user!user@isp.net"
                });
            })
            .then(function (replaceResponse) {
                logfn(inspect(replaceResponse));
                assert(replaceResponse === "Factoid too long.");

                return factoid({
                    args: ["x"]
                });
            })
            .then(function (factoidResponse) {
                logfn(inspect(factoidResponse));
                assert(equal(factoidResponse, { intent: "say", message: thirty_a }));
            });
        });

        // NOTE(Havvy): It already does this when wholesale learning a new description.
        // NOTE(Havvy): If you want to preserve middle whitespace,
        //              file an issue and it may become an option.
        it("will collapse whitespace after editing", function () {
            return learn({
                args: ["x", "=", "first middle last"],
                message: "!learn x = first middle last",
                hostmask: "user!user@isp.net"
            })
            .then(function () {
                return learn({
                    args: ["x", "~=", "s/middle//"],
                    message: "!learn x ~= s/middle//",
                    hostmask: "user!user@isp.net"
                });
            })
            .then(function () {
                const factoidResponse = factoid({
                    args: ["x"]
                });

                logfn(inspect(factoidResponse));
                assert(equal(factoidResponse, { intent: "say", message: "first last" }));
            });
        });
    });

    describe("@", function () {
        it("tells the user specified after the @ the factoid", function () {
            return learn({
                args: ["x", "=", "y"],
                message: "!learn x = y",
                hostmask: "user!user@isp.net"
            })
            .then(function () {
                var response = factoid({
                    args: ["x", "@", "user"]
                });

                logfn(inspect(response));
                assert(equal(response, {
                    intent: "say",
                    message: "user: y"
                }));
            });
        });

        it("is ignored when the intent is 'act'", function () {
            return learn({
                args: ["x", "!=", "y"],
                message: "!learn x = y",
                hostmask: "user!user@isp.net"
            })
            .then(function () {
                var response = factoid({
                    args: ["x", "@", "user"]
                });

                logfn(inspect(response));
                assert(equal(response, {
                    intent: "act",
                    message: "y"
                }));
            });
        })
    });

    describe("Failure handling", function () {
        describe("!factoid", function () {
            it("needs to be passed a key", function () {
                assert(factoid({args: []}) === "No factoid specified.");
            });

            it("needs a key in the database", function () {
                assert(factoid({args: ["dne"]}) === "No such factoid 'dne' found.");
            });
        });

        describe("!learn", function () {
            it("needs a key on the left of the operand", function () {
                return learn({
                    args: ["=", "y"],
                    message: "!learn = y",
                    hostmask: "user!user@isp.net"
                })
                .then(function (response) {
                    assert(response === "Invalid format. No key specified.");
                });
            });
        });

        describe("!forget", function () {
            it("needs the key to be forgotten to exist", function () {
                return forget({
                    args: ["x"]
                })
                .then(function (response) {
                    logfn(inspect(response));
                    assert(response === "Cannot forget factoid 'x'. Factoid does not exist.")
                });
            });
        });
    });

    describe("Twitch protection", function () {
        it("disallows messages that begin with '!' when daemon is 'twitch' and intent is 'say'", function () {
            client = makeClient({daemon: "twitch"});
            plugin = Plugin.init(client);

            learn = plugin.handlers["!learn"];

            return learn({
                args: ["x", "=", "!evil"],
                message: "!learn x = !evil",
                hostmask: "user!user@isp.net"
            })
            .then(function (response) {
                logfn(inspect(response));
                assert(response === "Disallowed! Factoid message could be a Twitch command.");
            });
        });

        it("disallows editing to make message start with '!' when prior test conditions are true", function () {
            client = makeClient({daemon: "twitch"});
            plugin = Plugin.init(client);

            learn = plugin.handlers["!learn"];

            return learn({
                args: ["x", "=", "evil"],
                message: "!learn x = evil",
                hostmask: "user!user@isp.net"
            })
            .then(function () {
                return learn({
                    args: ["x", "~=", "s/^/!/"],
                    message: "!learn x ~= s/^/!/",
                    hostmask: "user!user@isp.net"
                });
            })
            .then(function (response) {
                logfn(inspect(response));
                assert(response === "Disallowed! Factoid message could be a Twitch command.");
            });
        });

        it("disallows messages that begin with '/' when daemon is 'twitch' and intent is 'say'", function () {
            client = makeClient({daemon: "twitch"});
            plugin = Plugin.init(client);

            learn = plugin.handlers["!learn"];

            return learn({
                args: ["x", "=", "/evil"],
                message: "!learn x = /evil",
                hostmask: "user!user@isp.net"
            })
            .then(function (response) {
                logfn(inspect(response));
                assert(response === "Disallowed! Factoid message could be a Twitch command.");
            });
        });

        it("disallows editing to make message start with '/' when prior test conditions are true", function () {
            client = makeClient({daemon: "twitch"});
            plugin = Plugin.init(client);

            learn = plugin.handlers["!learn"];

            return learn({
                args: ["x", "=", "evil"],
                message: "!learn x = evil",
                hostmask: "user!user@isp.net"
            })
            .then(function () {
                return learn({
                    args: ["x", "~=", "s/^/\//"],
                    message: "!learn x ~= s/^/\//",
                    hostmask: "user!user@isp.net"
                });
            })
            .then(function (response) {
                logfn(inspect(response));
                assert(response === "Disallowed! Factoid message could be a Twitch command." ||
                    response === "Invalid replacement format. See !help learn replace for format.");
            });
        });

        it("allows editing to make messages start with '!' when daemon is not 'twitch'", function () {
            // Note(Havvy): Uses `learn` from beforeEach of top-level describe.
            return learn({
                args: ["x", "=", "!evil"],
                message: "!learn x = !evil",
                hostmask: "user!user@isp.net"
            })
            .then(function (response) {
                logfn(inspect(response));
                assert(response === "Learned factoid 'x'.");
            });
        });
    });

    describe("Safe editing", function () {
        // Completely replaces the beforeEach from the higher level `describe`.
        beforeEach(function () {
            client = makeClient({safeReplace: true});
            plugin = Plugin.init(client);

            factoid = plugin.handlers["!factoid"];
            learn = plugin.handlers["!learn"];
            forget = plugin.handlers["!forget"];

            return learn({
                args: ["x", "=", "y"],
                message: "!learn x = y",
                hostmask: "user!user@isp.net"
            })
            .then(function (response) {
                logfn(inspect(response));
                assert(response === "Learned factoid 'x'.");
            });
        });

        it("disallows relearning a factoid unsafely", function () {
            return learn({
                args: ["x", "=", "z"],
                message: "!learn x = z",
                hostmask: "user!user@isp.net"
            })
            .then(function (response) {
                logfn(inspect(response));
                assert(response === "Cannot rewrite 'x'. Use `x f= new description` or !forget if you really wanted to replace.")
            });
        });

        it("disallows relearning a factoid unsafely as an alias", function () {
            return learn({
                args: ["x", "@=", "z"],
                message: "!learn x @= z",
                hostmask: "user!user@isp.net"
            })
            .then(function (response) {
                logfn(inspect(response));
                assert(response === "Cannot rewrite 'x'. Use `x f= new description` or !forget if you really wanted to replace.")
            });
        });

        it("disallows relearning a factoid unsafely as an action", function () {
            return learn({
                args: ["x", "!=", "z"],
                message: "!learn x != z",
                hostmask: "user!user@isp.net"
            })
            .then(function (response) {
                logfn(inspect(response));
                assert(response === "Cannot rewrite 'x'. Use `x f= new description` or !forget if you really wanted to replace.")
            });
        });

        it("disallows relearning a factoid unsafely as a definition", function () {
            return learn({
                args: ["x", ":=", "z"],
                message: "!learn x := z",
                hostmask: "user!user@isp.net"
            })
            .then(function (response) {
                logfn(inspect(response));
                assert(response === "Cannot rewrite 'x'. Use `x f= new description` or !forget if you really wanted to replace.")
            });
        });

        it("allows relearning a factoid as a forced relearn with lowercase 'f'", function () {
            return learn({
                args: ["x", "f=", "z"],
                message: "!learn x f= z",
                hostmask: "user!user@isp.net"
            })
            .then(function (response) {
                logfn(inspect(response));
                assert(response === "Learned factoid 'x'.");
            });
        });

        it("allows relearning a factoid as a forced relearn with capital 'F'", function () {
            return learn({
                args: ["x", "F=", "z"],
                message: "!learn x F= z",
                hostmask: "user!user@isp.net"
            })
            .then(function (response) {
                logfn(inspect(response));
                assert(response === "Learned factoid 'x'.");
            });
        });
    });
});