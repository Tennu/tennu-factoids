const Dirty = require('dirty');
const format = require('util').format;

module.exports = function (databaseLocation, log) {
    const db = Dirty(databaseLocation);

    return {
        get: function (key, respondWhenNoKey) {
            // TODO: Move relevant parts into plugin.js
            const value = db.get(key.toLowerCase());

            if (!value) {
                log("factoids", "No key found.");

                if (respondWhenNoKey) {
                    return format("No such factoid '%s' found.", key);
                } else {
                    return;
                }
            }

            return format("%s is %s", key, value);
        },

        set: function (key, value) {
            db.set(key.toLowerCase(), value);
        },

        delete: function (key) {
            db.rm(key.toLowerCase());
        }
    };
};