const sinon = require("sinon");
const nodeassert = require("assert");
const assert = require("better-assert");
const equal = require("deep-eql");
const inspect = require("util").inspect;
const format = require("util").format;

const debug = false;
const logfn = debug ? console.log.bind(console) : function () {};

const Factoids = require("../factoids");
const Promise = require("bluebird");
const result = require("r-result"); 
const Ok = result.Ok;
const Fail = result.Fail;

const isoDateRegex = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d.\d{3}Z$/;

describe("Factoids", function () {
    var factoids;
    function setup (config) {
        const maxMessageLength = config.maxMessageLength || 307;
        const isEditorAdmin = config.isEditorAdmin || function () { return true; };

        factoids = Factoids({
            databaseLocation: "",
            isEditorAdmin: isEditorAdmin, 
            maxAliasDepth: 3,
            maxMessageLength: maxMessageLength,
            beforeUpdate: Ok,
            safeReplace: false
        });
    }

    describe("Normal operation", function () {
        it("getting a key that was never set returns `Fail('no-factoid')`", function () {
            setup({});

            const result = factoids.get("never set");
            logfn(inspect(result));
            assert(result.isFail());
            assert(result.fail() === "no-factoid");
        });

        it("setting a key that is too long, Fail('message-length-exceeded')", function () {
            setup({});

            return factoids.set("sample keyword", {
                intent: "say",
                message:  new Array(400).join().split(",").join("a"),
                editor: "user"
            }) 
            .then(function (factoidResult) {
                logfn(inspect(factoidResult));
                assert(factoidResult.isFail());
                const failureReason = factoidResult.fail();

                assert(failureReason === "message-length-exceeded");

            });

        });

        it("setting a key that was never set returns set factoid value", function () {
            setup({});

            return factoids.set("sample keyword", {
                intent: "say",
                message: "sample description",
                editor: "user"
            })
            .then(function (factoidResult) {
                assert(factoidResult.isOk());
                var factoid = factoidResult.ok();

                assert(factoid.intent === "say");
                assert(factoid.message === "sample description");
                assert(factoid.editor === "user");
                assert(isoDateRegex.test(factoid.time));
                assert(factoid.frozen === false);
            });
        });

        it ("getting a key of a set factoid returns Ok(the set factoid's value)", function () {
            setup({});

            return factoids.set("sample keyword", {
                intent: "say",
                message: "sample description",
                editor: "user"
            })
            .then(function (factoidResult) {
                assert(factoidResult.isOk());
            })
            .then(function () {
                var result = factoids.get("sample keyword");
                assert(result.isOk());
                var factoid = result.ok();
                logfn(inspect(factoid));
                assert(equal(factoid, {
                    intent: "say",
                    message: "sample description"
                }));
            });
        });

        it ("getting a key of a deleted factoid returns `Fail('no-factoid')`", function () {
            setup({});

            return factoids.set("sample keyword", {
                intent: "say",
                message: "sample description",
                editor: "user"
            })
            .then(function (factoidResult) {
                assert(factoidResult.isOk());
            })
            .then(function () {
                return factoids.delete("sample keyword");
            })
            .then(function (deleteResult) {
                logfn(inspect(deleteResult));
                assert(deleteResult.isOk());
            })
            .then(function () {
                var result = factoids.get("sample keyword");
                assert(result.isFail());
                assert(result.fail() === "no-factoid");
            });
        });

        it("can replace one description with a regexp change of another", function () {
            setup({});

            return factoids.set("sample keyword", {
                intent: "say",
                message: "sample description",
                editor: "user"
            })
            .then(function (factoidResult) {
                assert(factoidResult.isOk());
            })
            .then(function () {
                return factoids.replace("sample keyword", /sample/, "changed", "user");
            })
            .then(function (replaceResult) {
                assert(replaceResult.isOk());
            });
        });

        it("cannot replace one description with a message that is too long, Fail(message-length-exceeded)", function () {
            setup({});

            return factoids.set("sample keyword", {
                intent: "say",
                message: new Array(20).join("a"),
                editor: "user"
            })
            .then(function (factoidResult) {
                assert(factoidResult.isOk());
            })
            .then(function () {
                return factoids.replace("sample keyword", /a/g, new Array(20).join().split(",").join("a"), "user");
            })
            .then(function (replaceResult) {
                logfn(inspect(replaceResult));
                assert(replaceResult.isFail());
                const failureReason = replaceResult.fail();

                assert(failureReason === "message-length-exceeded");

            });
        });
    

        it("will fail if regexp change does not modify the description", function () {
            setup({});

            return factoids.set("x", {
                intent: "say",
                message: "sample description",
                editor: "user"
            })
            .then(function (factoidResult) {
                assert(factoidResult.isOk());

                return factoids.replace("x", /foo/, "bar", "user");
            })
            .then(function (replaceResult) {
                logfn(inspect(replaceResult));
                assert(replaceResult.isFail());
                const failureReason = replaceResult.fail();

                assert(failureReason === "unchanged");
            });
        });

        it("will collapse whitespace in a regexp replacement", function () {
            setup({});

            return factoids.set("x", {
                intent: "say",
                message: "first middle last",
                editor: "user"
            })
            .then(function (factoidResult) {
                assert(factoidResult.isOk());

                return factoids.replace("x", /middle/, "", "user");
            })
            .then(function (replaceResult) {
                assert(replaceResult.isOk());

                return factoids.get("x");
            })
            .then(function (getResult) {
                assert(getResult.isOk());
                const factoid = getResult.ok();

                assert(equal(factoid, {
                    intent: "say",
                    message: "first last"
                }));
            });
        });

        it("can have keys alias other keys", function () {
            setup({});

            return factoids.set("sample keyword", {
                intent: "say",
                message: "sample description",
                editor: "user"
            })
            .then(function (factoidResult) {
                assert(factoidResult.isOk());
            })
            .then(function () {
                return factoids.set("sample alias", {
                    intent: "alias",
                    message: "sample keyword", 
                    editor: "user!user@isp.net"
                });
            })
            .then(function (aliasResult) {
                assert(aliasResult.isOk());
            })
            .then(function () {
                var result = factoids.get("sample alias");
                assert(result.isOk());
                var factoid = result.ok();
                assert(equal(factoid, {
                    intent: "say",
                    message: "sample description"
                }));
            });
        });

        it("can alias non-existent keys", function () {
            setup({});

            return factoids.set("sample alias", {
                intent: "alias",
                message: "sample keyword", 
                editor: "user!user@isp.net"
            })
            .then(function (aliasResult) {
                assert(aliasResult.isOk());
            })
            .then(function () {
                var result = factoids.get("sample alias");
                assert(result.isFail());
                assert(result.fail() === "no-factoid");
            });
        });

        it("has a maximum alias depth", function () {
            setup({});

            // This factoid aliases itself.
            return factoids.set("sample alias", {
                intent: "alias",
                message: "sample alias",
                editor: "user!user@isp.net"
            })
            .then(function (aliasResult) {
                assert(aliasResult.isOk())
            })
            .then(function () {
                try {
                    var result = factoids.get("sample alias");
                } catch (e) {
                    logfn(e.name);
                    logfn(e.message);
                    assert(false);
                }
                assert(result.isFail());
                assert(result.fail() === "max-alias-depth-reached");
            });
        });

        it("disallows keys with '@'s in them", function () {
            setup({});

            return factoids.set("a @ b", {
                intent: "say",
                message: "doesn't matter",
                editor: "user!user@isp.net"
            })
            .then(function (result) {
                assert(result.isFail());
                var failure = result.fail();
                assert(failure === "at-symbol-in-key");
            });
        });
    });

    describe("Vandalism protection", function () {
        const isEditorAdmin = function (hostmask) {
            return hostmask === "admin!admin@isp.net";
        };

        it("disallows normal users from setting locked factoids", function () {
            setup({isEditorAdmin: isEditorAdmin});
            factoids.freeze("locked");

            return setResult = factoids.set("locked", {
                intent: "say",
                message: "doesn't matter",
                editor: "user!user@isp.net"
            })
            .then(function (result) {
                assert(result.isFail());
                var failure = result.fail();
                logfn(failure);
                assert(failure === "frozen");
            })
        });

        it("disallows normal users from setting locked factoids with different case", function () {
            setup({isEditorAdmin: isEditorAdmin});
            factoids.freeze("locked");

            return setResult = factoids.set("Locked", {
                intent: "say",
                message: "doesn't matter",
                editor: "user!user@isp.net"
            })
            .then(function (result) {
                assert(result.isFail());
                var failure = result.fail();
                logfn(failure);
                assert(failure === "frozen");
            });
        });
    });

    describe("beforeUpdate property", function () {
        it("throws an error if beforeUpdate is not a function", function () {
            nodeassert.throws(function () {
                var factoids = Factoids({
                    databaseLocation: "",
                    isEditorAdmin: function () { return true; }, 
                    maxAliasDepth: 3,
                    maxMessageLength: 307,
                    beforeUpdate: undefined,
                    safeReplace: false
                });
            });
        });

        it("is called right before setting a factoid", function () {
            var spy = sinon.spy(Ok);

            var factoids = Factoids({
                databaseLocation: "",
                isEditorAdmin: function () { return true; }, 
                maxAliasDepth: 3,
                maxMessageLength: 307,
                beforeUpdate: spy,
                safeReplace: false
            });

            assert(!spy.called);
            
            return factoids.set("abc", {
                intent: "say",
                message: "123",
                editor: "user!user@isp.net"
            })
            .then(function (value) {
                assert(spy.called);
            });
        });

        it("can block the factoid from being updated", function () {
            var factoids = Factoids({
                databaseLocation: "",
                isEditorAdmin: function () { return true; }, 
                maxAliasDepth: 3,
                maxMessageLength: 307,
                beforeUpdate: function () { return Fail("blocked"); },
                safeReplace: false
            });

            return factoids.set("abc", {
                intent: "say",
                message: "123",
                editor: "user!user@isp.net"
            })
            .then(function (setResult) {
                assert(setResult.isFail());

                assert(setResult.fail() === "blocked");
            });
        });

        it("can modify the factoid", function () {
            var beforeUpdate = function (value) {
                value.intent = "act";
                return Ok(value);
            };

            var factoids = Factoids({
                databaseLocation: "",
                isEditorAdmin: function () { return true; }, 
                maxAliasDepth: 3,
                maxMessageLength: 307,
                beforeUpdate: beforeUpdate,
                safeReplace: false
            });

            return factoids.set("abc", {
                intent: "say",
                message: "123",
                editor: "user!user@isp.net"
            })
            .then(function (setResult) {
                assert(setResult.isOk());
                assert(setResult.ok().intent === "act");
            });
        });
    });
});