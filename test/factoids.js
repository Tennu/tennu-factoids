// var sinon = require("sinon");
var assert = require("better-assert");
var equal = require("deep-eql");
var inspect = require("util").inspect;
var format = require("util").format;

var debug = false;
var logfn = debug ? console.log.bind(console) : function () {};

var Factoids = require("../factoids");
var Promise = require("bluebird");
var result = require("r-result"); 
var Ok = result.Ok;
var Fail = result.Fail;

var isoDateRegex = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d.\d{3}Z$/;

describe("Factoids", function () {
    var factoids;

    beforeEach(function () {
        factoids = Factoids("", function () { return true; });
    });

    it("getting a key that was never set returns `undefined`", function () {
        assert(factoids.get("never set") === undefined);
    });

    it("setting a key that was never set returns set factoid value", function () {
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

    it ("getting a key of a set factoid returns the set factoid's value", function () {
        return factoids.set("sample keyword", {
            intent: "say",
            message: "sample description",
            editor: "user"
        })
        .then(function (factoidResult) {
            assert(factoidResult.isOk());
        })
        .then(function () {
            var factoid = factoids.get("sample keyword");
            logfn(inspect(factoid));

            assert(factoid.intent === "say");
            assert(factoid.message === "sample description");
        });
    });

    it ("getting a key of a deleted factoid returns `undefined`", function () {
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
            assert(factoids.get("sample keyword") === undefined);
        });
    });

    it("can replace one description with a regexp change of another", function () {
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
});