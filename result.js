const Ok = function (t) {
    return [true, t];
};

const Fail = function (t) {
    return [false, t];
};

const map = function (fn) {
    return function (result) {
        if (result[0]) {
            return fn(result[1]);
        } else {
            return result;
        }
    };
};

const mapFail = function (fn) {
    return function (result) {
        if (result[0]) {
            return result;
        } else {
            return fn(result[1]);
        }
    };
};

const ok = function (result) {
    if (result[0]) {
        return result[1];
    } else {
        throw new Error("Unhandled error value: " + result[1]);
    }
}

module.exports = {
    Ok: Ok,
    Fail: Fail,
    map: map,
    mapFail: mapFail,
    ok: ok
};