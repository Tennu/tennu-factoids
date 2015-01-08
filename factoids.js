const Dirty = require('dirty');
const format = require('util').format;

module.exports = function (databaseLocation, log) {
    const db = Dirty(databaseLocation);

    return {
        get: function (key) {
            return db.get(key.toLowerCase());
        },

        set: function (key, value) {
            db.set(key.toLowerCase(), value);
        },

        delete: function (key) {
            db.rm(key.toLowerCase());
        }
    };
};