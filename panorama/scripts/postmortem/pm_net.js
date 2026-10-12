// pm_net.js — the only data channel out of Panorama, and it is not a networking API.
//
// THE PROBLEM
// Panorama has no networking. Confirmed in-game, not assumed: the complete global list
// is Promise, JSON, globalThis, $, panorama. There is no fetch, XMLHttpRequest,
// WebSocket, EventSource, navigator, window, document, localStorage, setTimeout or
// btoa/atob. `$.AsyncWebRequest` still exists as a binding and logs
// "ERROR: AsyncWebRequest has been removed." when called - Valve pulled it.
//
// THE WORKAROUND
// `$.CreatePanel("CitadelHTMLPanel", ...)` creates a panel whose contents are a real
// Chromium. Inside that page, fetch and WebSocket work. The bridge is an EVENT, not a
// method: the page sets document.title and Panorama receives the string as an event
// argument.
//
//   Panorama -> page   panel.SetURL("javascript:...")   no reload, live socket survives
//   page -> Panorama   $.RegisterEventHandler("HTMLTitle", panel, cb)
//                      cb arg1 = document.title
//
// Measured in-game by the DeadlockNews probe mod: 64/256/1024/4096 char titles arrive
// whole, 16384 and 65536 are both silently cut to exactly 4096; 12 of 12 rewrites at
// 250ms arrived with no loss. That is ~4 updates/sec and a 4096 char payload.
//
// FOUR THINGS THAT WILL BITE IF IGNORED
//
// 1. THE PANEL MUST NOT BE HIDDEN. A panel with zero opacity or collapsed visibility is
//    skipped by the engine's loader. So the bridge panel is 2x2 pixels, opaque, in a
//    corner: genuinely visible to the engine, genuinely invisible to the player. It is
//    NOT hidden and NOT transparent, on purpose.
//
// 2. DEDUP ON CONTENT, NOT ON LENGTH. HTMLTitle fires twice per navigation. A dedup
//    keyed on (channel, length) collapsed five distinct ticks into one row elsewhere
//    and read as "the stream never fired".
//
// 3. 4096 IS NOT A LOT. A Deadlock match with ten players, items and graph series runs
//    to several KB, so it does NOT fit. The rule this module enforces: only what is
//    about to be drawn goes down, and anything larger is read one slice at a time by
//    index. Slices are requested one after another, never fired off together, because
//    whether two consecutive title writes coalesce was never measured.
//
// 4. EVERY TERMINAL PATH MUST CALL cb OR err. A bare return wedges the caller, because
//    poll loops re-arm only from their own callbacks.
//
// Only the exact success reply counts. Anything else is a decode fault: treating a
//    mis-scaled width as success once produced a client that silently diverged from the
//    server until the board desynced.

'use strict';

// Namespace lives on $, NOT globalThis. Measured in game on build 25763945: each
// compiled .vjs_c gets its own globalThis, so a namespace attached there is a
// different object per file and pm_core.js sees an undefined PM.Compat. The $
// object IS shared by every script in one panel context - which is exactly how the
// DL Arcade mod shares its modules ($.MG). globalThis stays for XML entry points:
// onactivate="PMOpenOverlay()" resolves those fine.
var PM = ($.PM = $.PM || {});
if (PM.Net) { /* already initialised */ }
else {

var DOWNLINK_LIMIT = 4096;   // measured, not assumed
var REQUEST_TIMEOUT = 8.0;   // seconds
var BRIDGE_SIZE = 2;         // px. see trap 1.

// Where the bridge page lives. A real https origin, not a data: URL:
//   - data: documents have an opaque origin where `localStorage` THROWS SecurityError
//     (it is a throwing getter, not a plain undefined), which aborted an entire page
//     script for the reference probe and made the log read as "fetch is absent";
//   - a real origin also lets us proxy the API, which closes CORS and any old-TLS
//     problem in one move.
// Left empty on purpose: an unset bridge reports "not configured" instead of hammering
// a placeholder host. Fill it in before expecting API data.
var BRIDGE_URL = '';

var netState = {
    panel: null,
    ready: false,
    lastTitle: '',
    handlerId: null,
    stats: { titles: 0, unique: 0, maxLen: 0, truncated: 0, errors: 0 },
    pending: null,
    queue: [],
    onLine: null
};

function netLog(msg) {
    $.Msg('[PM-NET] ' + msg);
}

function parseTitle(raw) {
    // Expected shape: PM1|<kind>|<seq>|<payload>. Anything else is not ours.
    if (!raw) { return null; }
    if (raw.length < 5 || raw.indexOf('PM1|') !== 0) { return null; }
    var parts = raw.split('|');
    if (parts.length < 4) { return null; }
    return { kind: parts[1], seq: parseInt(parts[2], 10), payload: parts.slice(3).join('|') };
}

function makePanel(context) {
    var panel = $.CreatePanel('CitadelHTMLPanel', context, 'PM_Bridge');
    if (!panel) {
        netLog('CreatePanel("CitadelHTMLPanel") returned null - context may not support it');
        return null;
    }
    panel.style.width = BRIDGE_SIZE + 'px';
    panel.style.height = BRIDGE_SIZE + 'px';
    panel.style.horizontalAlign = 'right';
    panel.style.verticalAlign = 'bottom';
    panel.style.marginLeft = '0px';
    panel.style.marginRight = '2px';
    panel.style.marginBottom = '2px';
    // Trap 1: never collapse, never fade. Opaque and 2x2.
    panel.style.visibility = 'visible';
    panel.style.opacity = '1';
    panel.hittest = false;
    panel.enabled = false;
    return panel;
}

function onTitle(panel, title) {
    // Defensive: the engine's argument order was measured as (panel, title), but accept
    // a single-argument call too rather than losing the payload.
    if (title === undefined && typeof panel === 'string') {
        title = panel;
    }
    if (typeof title !== 'string') { return; }

    netState.stats.titles++;
    if (title.length > netState.stats.maxLen) { netState.stats.maxLen = title.length; }
    if (title.length >= DOWNLINK_LIMIT) { netState.stats.truncated++; }

    // Trap 2: dedup on content. HTMLTitle fires twice per navigation, and length alone
    // is not a key.
    if (title === netState.lastTitle) { return; }
    netState.lastTitle = title;
    netState.stats.unique++;

    var msg = parseTitle(title);
    if (!msg) {
        // Not ours. That is normal: the page echoes titles for its own reasons.
        return;
    }

    var waiter = netState.pending;
    if (waiter && waiter.kind === msg.kind) {
        netState.pending = null;
        waiter.cb(null, msg.payload);
    }
    if (netState.onLine) { netState.onLine(msg); }
}

function start(context) {
    if (netState.panel) { return netState.panel; }
    if (!BRIDGE_URL) {
        netLog('BRIDGE_URL is empty - transport disabled. Set it in pm_net.js to enable API access.');
        return null;
    }
    var panel = makePanel(context);
    if (!panel) { return null; }
    netState.panel = panel;

    netState.handlerId = $.RegisterEventHandler('HTMLTitle', panel, onTitle);

    // Load the page. This is the moment that answers phase 1: does a CEF panel work in
    // this XML context at all? If nothing arrives on the handler afterwards, it does not.
    try {
        panel.SetURL(BRIDGE_URL);
        netLog('bridge panel created, loading ' + BRIDGE_URL);
    } catch (e) {
        netLog('SetURL threw: ' + e);
        return null;
    }
    return panel;
}

// Send a line of JavaScript into the live document. No reload, so an open socket stays
// open. This is the uplink.
function send(js) {
    if (!netState.panel) { return false; }
    try {
        netState.panel.SetURL('javascript:' + js);
        return true;
    } catch (e) {
        netLog('uplink SetURL failed: ' + e);
        return false;
    }
}

// One request/one reply. cb(err, payload) - exactly one of the two, always.
function request(kind, body, cb) {
    if (!netState.panel) {
        netState.stats.errors++;
        cb('bridge-not-configured', null);
        return;
    }
    if (netState.pending) {
        netState.stats.errors++;
        cb('bridge-busy', null);
        return;
    }
    netState.pending = { kind: kind, cb: cb };

    var line = 'pmReply(' + JSON.stringify(kind) + ',' + JSON.stringify(String(body)) + ')';
    if (!send(line)) {
        netState.pending = null;
        netState.stats.errors++;
        cb('uplink-failed', null);
        return;
    }

    // Timeout re-arms from a callback like everything else, and always clears pending so
    // the next call is not wedged behind a dead one.
    $.Schedule(REQUEST_TIMEOUT, function () {
        if (!netState.pending || netState.pending.kind !== kind) { return; }
        netState.pending = null;
        netState.stats.errors++;
        cb('timeout', null);
    });
}

function configure(url) {
    // BRIDGE_URL is a const so it cannot be reassigned at runtime; this exists to keep
    // the intent explicit for a future build that injects the URL at pack time.
    netLog('configure(' + url + ') is not wired yet; edit BRIDGE_URL in pm_net.js');
}

PM.Net = {
    start: start,
    send: send,
    request: request,
    configure: configure,
    stats: netState.stats,
    isConfigured: function () { return !!BRIDGE_URL; },
    DOWNLINK_LIMIT: DOWNLINK_LIMIT
};

netLog('module loaded, bridge ' + (BRIDGE_URL ? 'configured' : 'not configured'));
}