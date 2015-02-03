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
 * }^2
 *
 * 1: Will be missing if the message is deleted.
 * 2: Factoids that were never created but frozen will just be {frozen: true}.
 **/

 // Dirty DB really needs an update method...

const Dirty = require('dirty');
const Promise = require('bluebird');
const format = require('util').format;
const now = function () { return (new Date()).toISOString(); }
const Result = require('./result');
const Ok = Result.Ok;
const Fail = Result.Fail;

module.exports = function (databaseLocation, isEditorAdmin) {
    const db = Dirty(databaseLocation);

    const canEdit = function (editor, isKeyFrozen) {
        return new Promise(function (resolve, reject) {
            if (isKeyFrozen) {
                resolve(isEditorAdmin(editor));
            } else {
                resolve(true);
            }
        });
    };

    return {
        // String -> %Tennu.Message{}
        get: function (key) {
            const value = db.get(key.toLowerCase());

            if (!value || !value.message) {
                return;
            }

            return {
                intent: value.intent,
                message: value.message,
                template: true
            };
        },

        // String, %Factoid{} -> Result<(), String>
        set: function (key, next) {
            return Promise.resolve()
            .then(function () {
                if (!(next.intent && next.message && next.editor)) {
                    throw new Error("An intent, message, and editor are all needed to set a new factoid.");
                }

                return db.get(key);
            })
            .then(function (previous) {
                return canEdit(next.editor, previous && previous.frozen)
                .then(function (ifCanEdit) {
                    if (ifCanEdit) {
                        return Ok(previous);
                    } else {
                        console.log("Frozen!");
                        return Fail("frozen");
                    }
                });
            })
            .then(Result.map(function (previous) {
                next = {
                    intent: next.intent,
                    message: next.message,
                    editor: next.editor,
                    time: now(),
                    frozen: previous ? previous.frozen : false
                };

                db.set(key.toLowerCase(), next);

                return Ok(next);
            }));
        },

        // String, Hostmask -> Result<(), String>
        delete: function (key, editor) {
            key = key.toLowerCase();
            return Promise.resolve(db.get(key))
            .then(function (description) {
                if (description && description.message) {
                    return Ok(description);
                } else {
                    return Fail("dne");
                }
            })
            .then(Result.map(function (description) {
                return canEdit(editor, description.frozen)
                .then(function (ifCanEdit) {
                    if (ifCanEdit) {
                        return Ok(description);
                    } else {
                        return Fail("frozen");
                    }
                })
            }))
            .then(Result.map(function (description) {
                db.set(key, {
                    editor: editor,
                    time: now(),
                    frozen: description.frozen
                });

                return Ok();
            }));
        },

        // (String, RegExp, String, HostMask) -> Result<(), String>
        replace: function (key, regexp, replacement, editor) {
            return Promise.resolve(db.get(key))
            .then(function (description) {
                if (description.message) {
                    return Ok(description);
                } else {
                    return Fail("dne");
                }
            })
            .then(Result.map(function (description) {
                return canEdit(editor, description.frozen || false)
                .then(function (ifCanEdit) {
                    if (ifCanEdit) {
                        return Ok(description);
                    } else {
                        return Fail("frozen");
                    }
                });
            }))
            .then(Result.map(function (description) {
                const old_message = description.message;
                const new_message = old_message.replace(regexp, replacement);

                if (old_message === new_message) {
                    return Fail("unchanged");
                }

                if (new_message === "") {
                    return Fail("no-message-left");
                }

                description.message = new_message;
                description.editor = editor;
                description.time = now();

                db.set(key, description);

                return Ok(description);
            }));
        },

        // String -> Boolean
        freeze: function (key) {
            const value = db.get(key);

            if (!value) {
                db.set(key, {
                    frozen: true
                });
                return;
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