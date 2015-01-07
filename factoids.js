const Dirty = require('dirty');

module.exports = function (databaseLocation) {
    const db = Dirty(databaseLocation);

    return {
        get: function (key) {
            return db.get(key);
        },

        set: function (key, value) {
            db.set(key, value);
        },

        delete: function (key) {
            db.rm(key);
        }
    };
};