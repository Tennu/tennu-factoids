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

var makeClient = function (daemon) {
    var client = {};

    client.config = function (value) {
        return {
            "command-trigger": "!",
            "factoids-trigger": "@",
            "factoids-database": "", // In memory database.
            "daemon": daemon || "unreal"
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
        client = makeClient();
        plugin = Plugin.init(client);

        factoid = plugin.handlers["!factoid"];
        learn = plugin.handlers["!learn"];
        forget = plugin.handlers["!forget"];
    });

    describe("Basics", function () {
        it("can learn factoids with !learn", function () {
            return learn({
                args: ["x", "=", "y"],
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
                hostmask: "user!user@isp.net"
            })
            .then(function () {
                return learn({
                    args: ["y", "@=", "x"],
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
                hostmask: "user!user@isp.net"
            })
            .then(function () {
                return learn({
                    args: ["y", "@=", "x"],
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
        it.skip("can do simple find and replace", function () {

        });

        it.skip("can append simple text", function () {

        });

        it("can append a URL", function () {
            return learn({
                args: ["x", "=", "y"],
                hostmask: "user!user@isp.net"  
            })
            .then(function () {
                return learn({
                    args: ["x", "+=", "| https://tennu.github.io/"],
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
                hostmask: "user!user@isp.net"  
            })
            .then(function () {
                return learn({
                    // Note that `[` in a RegExp has special meaning and has to be closed.
                    args: ["x", "~=", "s/[/</"],
                    hostmask: "user!user@isp.net"
                });
            })
            .then(function (replaceResponse) {
                logfn(inspect(replaceResponse));
                assert(replaceResponse === "Invalid replacement format. RegExp invalid.");
            });
        });
    });

    describe("@", function () {
        it("tells the user specified after the @ the factoid", function () {
            return learn({
                args: ["x", "=", "y"],
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
        it("disallows messages that begin with '!' when dameon is 'twitch' and intent is 'say'", function () {
            client = makeClient("twitch");
            plugin = Plugin.init(client);

            learn = plugin.handlers["!learn"];

            return learn({
                args: ["x", "=", "!evil"],
                hostmask: "user!user@isp.net"
            })
            .then(function (response) {
                logfn(inspect(response));
                assert(response === "Disallowed! Factoid message could be a Twitch command.");
            });
        });

        it("disallows editing to make message start with '!' when prior test conditions are true", function () {
            client = makeClient("twitch");
            plugin = Plugin.init(client);

            learn = plugin.handlers["!learn"];

            return learn({
                args: ["x", "=", "evil"],
                hostmask: "user!user@isp.net"
            })
            .then(function () {
                return learn({
                    args: ["x", "~=", "s/^/!/"],
                    hostmask: "user!user@isp.net"
                });
            })
            .then(function (response) {
                logfn(inspect(response));
                assert(response === "Disallowed! Factoid message could be a Twitch command.");
            });
        });

        it("allows editing to make messages start with '!' when daemon is not 'twitch'", function () {
            // Note(Havvy): Uses `learn` from beforeEach of top-level describe.
            return learn({
                args: ["x", "=", "!evil"],
                hostmask: "user!user@isp.net"
            })
            .then(function (response) {
                logfn(inspect(response));
                assert(response === "Learned factoid 'x'.");
            });
        });
    });
});