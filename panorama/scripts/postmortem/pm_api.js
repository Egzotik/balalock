// pm_api.js — все вызовы deadlock-api.com из мода.
//
// WHY THIS FILE EXISTS
// Panorama has no fetch. The only channel out is PM.Net: one request gets exactly one
// title reply of at most 4096 chars (measured). A slim match is 3-6KB, so every read
// here is: meta request (how many slices) followed by slice requests ONE AFTER ANOTHER.
// Parallel slice requests were never measured safe (two title writes may coalesce),
// so the chain below is strictly sequential.
//
// The worker (bridge/worker.js) does the slimming: Panorama never sees the raw 200KB
// metadata. Same-origin fetch on the bridge page also closes the CORS + old-TLS problem
// in one move, which is why BRIDGE_URL points at our own worker, not at the API.
//
// Calling shape is always cb(err, value): err is a short string, value the parsed JSON.
// Every terminal path calls cb exactly once (TRANSPORT.md trap 5).

'use strict';

var PM = ($.PM = $.PM || {});
if (PM.Api) { /* already initialised */ }
else {

var apiSliceLen = 3500;
var apiTagSeq = 0;
var apiOverallTimeout = 40.0;

function apiLog(msg) {
    $.Msg('[PM-API] ' + msg);
}

var apiUrlSafe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*()";

function apiEncode(str) {
    var out = '';
    var s = String(str);
    for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i);
        if (apiUrlSafe.indexOf(c) >= 0) { out += c; }
        else if (c === ' ') { out += '%20'; }
        else { out += '%' + ('0' + c.charCodeAt(0).toString(16)).slice(-2); }
    }
    return out;
}

function apiIsDigits(s) {
    var t = String(s).replace(/^\s+|\s+$/g, '');
    if (!t.length) { return false; }
    for (var i = 0; i < t.length; i++) {
        if (t.charAt(i) < '0' || t.charAt(i) > '9') { return false; }
    }
    return true;
}

function apiBridgeReady() {
    if (!PM.Net) { return false; }
    if (!PM.Net.isConfigured()) { return false; }
    var panel = null;
    try {
        panel = PM.Net.start($.GetContextPanel());
    } catch (e) {
        apiLog('bridge start threw: ' + e);
        return false;
    }
    return !!panel;
}

// One slim document, reassembled from slices. cb(err, text).
function apiFetchSlim(path, cb) {
    if (!apiBridgeReady()) {
        cb('bridge-not-configured', null);
        return;
    }
    var tag = 'a' + (apiTagSeq++);
    var metaKind = tag + '/meta';
    var finished = false;
    function apiDone(err, value) {
        if (finished) { return; }
        finished = true;
        cb(err, value);
    }
    $.Schedule(apiOverallTimeout, function () {
        apiDone('timeout', null);
    });
    PM.Net.request(metaKind, 'slim ' + path, function (metaErr, metaPayload) {
        if (metaErr) { apiDone(metaErr, null); return; }
        var meta = null;
        try {
            meta = JSON.parse(metaPayload);
        } catch (e) {
            apiDone('bad-meta', null);
            return;
        }
        if (!meta || typeof meta.chunks !== 'number' || meta.chunks < 1) {
            var probe = String(metaPayload || '');
            if (probe.indexOf('err ') === 0) { apiDone(probe, null); return; }
            apiDone('bad-meta', null);
            return;
        }
        if (meta.chunks > 40) {
            apiLog('refusing ' + meta.chunks + ' slices for ' + path);
            apiDone('too-large', null);
            return;
        }
        apiPullSlices(tag, 0, meta.chunks, '', apiDone);
    });
}

function apiPullSlices(tag, idx, total, acc, cb) {
    if (idx >= total) {
        cb(null, acc);
        return;
    }
    var kind = tag + '/s' + idx;
    PM.Net.request(kind, 'slice ' + tag + ' ' + idx, function (sliceErr, slicePayload) {
        if (sliceErr) { cb(sliceErr, null); return; }
        var probe = String(slicePayload || '');
        if (probe.indexOf('err ') === 0) { cb(probe, null); return; }
        apiPullSlices(tag, idx + 1, total, acc + probe, cb);
    });
}

// Parsed JSON over the slice transport. cb(err, obj).
function apiGetJSON(path, cb) {
    apiFetchSlim(path, function (fetchErr, text) {
        if (fetchErr) { cb(fetchErr, null); return; }
        try {
            cb(null, JSON.parse(text));
        } catch (e) {
            apiLog('bad json for ' + path + ' len=' + (text ? text.length : 0));
            cb('bad-json', null);
        }
    });
}

// Search by nickname, SteamID64 or account ID. Always cb(err, list).
function apiSearchPlayers(query, cb) {
    var q = String(query).replace(/^\s+|\s+$/g, '');
    if (!q.length) { cb('empty-query', null); return; }
    if (apiIsDigits(q)) {
        apiPlayerSlim(q, function (playerErr, player) {
            if (playerErr) { cb(playerErr, null); return; }
            if (!player || player.error) { cb('not-found', null); return; }
            cb(null, [{
                account_id: player.account_id,
                name: player.name,
                matches: player.matches,
                rank: null
            }]);
        });
        return;
    }
    apiGetJSON('/slim/search?q=' + apiEncode(q), function (searchErr, list) {
        if (searchErr) { cb(searchErr, null); return; }
        if (!list || list.error) { cb((list && list.error) || 'not-found', null); return; }
        cb(null, list);
    });
}

function apiAccountHistory(accountId, cb) {
    apiGetJSON('/slim/history/' + apiEncode(accountId), cb);
}

function apiMatchSlim(matchId, cb) {
    apiGetJSON('/slim/match/' + apiEncode(matchId), cb);
}

function apiPlayerSlim(accountId, cb) {
    apiGetJSON('/slim/player/' + apiEncode(accountId), cb);
}

function apiHeroCounters(heroId, cb) {
    apiGetJSON('/slim/counters?hero_id=' + apiEncode(heroId), cb);
}

function apiHeroItems(heroId, cb) {
    apiGetJSON('/slim/items?hero_id=' + apiEncode(heroId), cb);
}

function apiLeaderboard(region, cb) {
    var r = String(region || 'europe').replace(/^\s+|\s+$/g, '') || 'europe';
    apiGetJSON('/slim/board/' + apiEncode(r), cb);
}

function apiConfigured() {
    return !!(PM.Net && PM.Net.isConfigured());
}

PM.Api = {
    fetchSlim: apiFetchSlim,
    getJSON: apiGetJSON,
    searchPlayers: apiSearchPlayers,
    accountHistory: apiAccountHistory,
    matchSlim: apiMatchSlim,
    playerSlim: apiPlayerSlim,
    heroCounters: apiHeroCounters,
    heroItems: apiHeroItems,
    leaderboard: apiLeaderboard,
    configured: apiConfigured
};

apiLog('module loaded');
}
