const Dirty = require('dirty');

module.exports = function (databaseLocation) {
    const db = Dirty(databaseLocation);

    return {
        get: function (key) {
            return dirty.get(key);
        },

        set: function (key, value) {
            dirty.set(key, value);
        },

        delete: function (key) {
            dirty.rm(key);
        }
    };
};