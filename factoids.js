/**
 * Dirty DB is an append only database that emulates a JSON object.
 *
 * Our database has keys of factoid names, with a value being the
 * following struct:
 *
 * %Factoid{
 *   intent: %Tennu.Message{}'s intent ^1
 *   message: %Tennu.Message{}'s message ^1
 *   editor: Full hostmask of last editor to the factoid.
 *   time: Time of modification.
 *   frozen: Boolean of whether only admins can edit the factoid.
 * }
 *
 * 1: Will be missing if the message is deleted.
 **/

 // Dirty DB really needs an update method...

const Dirty = require('dirty');
const Promise = require('bluebird');
const format = require('util').format;
const now = function () { return (new Date()).toISOString(); }

module.exports = function (databaseLocation) {
    const db = Dirty(databaseLocation);

    return {
        // String -> %Tennu.Message{}
        get: function (key) {
            const value = db.get(key.toLowerCase());

            if (!value || !value.message) {
                return;
            }

            return {
                intent: value.intent,
                message: value.message
            };
        },

        // String, %Factoid{} -> Boolean
        // Boolean represents whether key was actually set.
        // A key can be not set if the key is frozen and
        //   the editor is not an admin.
        set: function (key, next) {
            return new Promise(function (resolve, reject) {
                if (!(next.intent && next.message && next.editor)) {
                    reject(new Error("An addition or modification to the database requires an intent, message, and editor."));
                    return;
                }

                function _set () {
                    db.set(key.toLowerCase(), {
                        intent: next.intent,
                        message: next.message,
                        editor: next.editor,
                        time: now(),
                        frozen: previous ? previous.frozen : false
                    });
                }

                const previous = db.get(key);

                console.log(require('util').inspect(previous));
                console.log(require('util').inspect(next));

                if (previous && previous.frozen) {
                    return next.isAdmin(next.editor).then(function (isAdmin) {
                        if (isAdmin) {
                            _set();
                            resolve(true);
                        } else {
                            resolve(false);
                        }
                    });
                }

                _set();
                resolve(true);
            });
        },

        // String, Hostmask -> Boolean
        // Boolean represents whether key was actaully deleted.
        // A key can only be deleted if it has a message, and
        //   if it is frozen, that the editor is an admin.
        delete: function (key, editor, isAdmin) {
            return new Promise(function (resolve, reject) {
                key = key.toLowerCase();
                const previous = db.get(key);

                function _delete () {
                    db.set(key, {
                        editor: editor,
                        time: now(),
                        frozen: previous.frozen
                    });
                }

                if (!previous || !previous.message) {
                    reject([false, "dne"]);
                } else if (previous && previous.frozen) {
                    isAdmin(editor).then(function (isAdmin) {
                        if (isAdmin) {
                            _delete();
                            resolve([true]);
                        } else {
                            resolve([false, "frozen"]);
                        }
                    }).catch(reject);
                } else {
                    _delete();
                    resolve([true]);
                }
            });
        },

        // String -> Boolean
        freeze: function (key) {
            const value = db.get(key);

            if (!value) {
                db.set(key, {
                    frozen: true
                });
            }

            db.set(key, {
                intent: value.intent,
                message: value.message,
                editor: value.editor,
                time: value.time,
                frozen: true
            });

            return true;
        },

        // String -> Boolean
        unfreeze: function (key) {
            const value = db.get(key);

            if (!value) {
                return false;
            }

            db.set(key, {
                intent: value.intent,
                message: value.message,
                editor: value.editor,
                time: value.time,
                frozen: false
            });

            return true;
        }
    };
};