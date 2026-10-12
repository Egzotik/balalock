// pm_probe.js — answers the questions phase 1 exists to answer.
//
// The game only runs on the user's machine, so this file is the instrument. It is not
// throwaway debug code: it is reachable from the overlay's Diagnostics section, and its
// output is what decides whether the API path ships at all.
//
// THE FOUR OPEN QUESTIONS, in the order they must be answered
//   Q1  does $.CreatePanel("CitadelHTMLPanel") work in THIS xml context?
//       Every measurement in the reference probe was taken in the HUD context. Both of
//       our hosts are dashboard contexts. If the panel cannot be created here, the whole
//       API path is dead and we ship the offline-only mod.
//   Q2  does a page inside it load and run?
//   Q3  does the downlink deliver, and how many characters actually arrive?
//   Q4  can the page reach api.deadlock-api.com, and can it reach our own bridge?
//
// GUARD EVERY PROBE
// The reference probe lost an entire run to this: a `data:` document has an opaque
// origin, `typeof localStorage` THROWS SecurityError there (it is a throwing getter,
// not a plain undefined lookup), and an unguarded read in the FIRST top-level statement
// aborted the whole page script. Not one report arrived - not even the pure-typeof line
// that needs no network - and the log read as "fetch is absent" when nothing had run.
// So: probe page beacons FIRST, every individual access sits in its own try/catch, and
// the Panorama side has an explicit liveness beacon so "script died" stays
// distinguishable from "all probes failed".
//
// KEEP IT LEAN
// The game console buffer is about 3 MB and the game itself spams it, which pushed a
// previous result block out of the log entirely. Filter when running:
//     con_filter_enable 1 ; con_filter_text PM

'use strict';

// Namespace lives on $, NOT globalThis. Measured in game on build 25763945: each
// compiled .vjs_c gets its own globalThis, so a namespace attached there is a
// different object per file and pm_core.js sees an undefined PM.Compat. The $
// object IS shared by every script in one panel context - which is exactly how the
// DL Arcade mod shares its modules ($.MG). globalThis stays for XML entry points:
// onactivate="PMOpenOverlay()" resolves those fine.
var PM = ($.PM = $.PM || {});
if (PM.Probe) { /* already initialised */ }
else {

var TIMEOUT = 12.0;
var TAG = '[PM-PROBE]';

// Percent-encoder. Panorama's global list is Promise, JSON, globalThis, $, panorama -
// there is no encodeURIComponent, and a data: URL breaks on '#', '%', space, '"', '<',
// '>' and '`'. So the page source is kept to a safe alphabet where possible and escaped
// here.
var URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*\'()/:@$,;';

function encodeUrl(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
        var c = str.charAt(i);
        if (URL_SAFE.indexOf(c) >= 0) { out += c; }
        else { out += '%' + ('0' + c.charCodeAt(0).toString(16)).slice(-2); }
    }
    return out;
}

// The probe page. Kept under the ~1900 char data: URL limit that was measured, and
// written without <angle brackets> in script bodies where avoidable.
//   - pmReply() is the reply half of the bridge; it is also how the page pushes
//     unprompted, which is what the beacons use.
//   - the length ladder is what answers Q3: if 4096 arrives whole and 8192 arrives as
//     exactly 4096, the channel truncates silently and slices are mandatory.
var PAGE_SOURCE = [
    "var S=0;",
    "function pmReply(k,b){document.title='PM1|'+k+'|'+S+'|'+String(b);}",
    "pmReply('alive','page-loaded');",
    "function t(n){try{return (typeof window[n])}catch(e){return 'throws'}}",
    "pmReply('types','fetch='+t('fetch')+' ws='+t('WebSocket')+' xhr='+t('XMLHttpRequest')+' ls='+t('localStorage'));",
    "function ladder(n){var s='';for(var i=0;i<n;i++){s+='0123456789'}pmReply('len'+n,s);}",
    "ladder(64);ladder(1024);ladder(4096);ladder(8192);",
    "function probe(u,k){try{fetch(u).then(function(r){pmReply(k,'ok '+r.status)}).catch(function(e){pmReply(k,'err '+(e&&e.name))})}",
    "catch(err){pmReply(k,'threw')}}",
    "probe('https://api.deadlock-api.com/','api');",
    "pmReply('end','script-reached-end');"
].join('');

function dataUrl() {
    return 'data:text/html,' + encodeUrl(
        '<html><head><script>' + PAGE_SOURCE + '</script></head><body></body></html>'
    );
}

function probeLog(msg) {
    $.Msg(TAG + ' ' + msg);
}

// ── Q1: can this context host a CitadelHTMLPanel at all? ───────────────────────────
function q1(emit) {
    var context = $.GetContextPanel();
    var panel = null;
    try {
        panel = $.CreatePanel('CitadelHTMLPanel', context, 'PM_ProbePanel');
    } catch (e) {
        emit('Q1 createPanel THREW: ' + e);
        return null;
    }
    if (!panel) {
        emit('Q1 createPanel returned null - context does not support CitadelHTMLPanel');
        return null;
    }
    // Opaque and 2x2, never collapsed. A hidden or transparent panel is skipped by the
    // engine's loader, which would look exactly like "the bridge does not work".
    panel.style.width = '2px';
    panel.style.height = '2px';
    panel.style.visibility = 'visible';
    panel.style.opacity = '1';
    panel.hittest = false;
    panel.enabled = false;
    emit('Q1 createPanel OK, paneltype=' + panel.paneltype);
    return panel;
}

// ── Q2/Q3/Q4: drive the page and collect replies ───────────────────────────────────
function run(emit, done) {
    var context = $.GetContextPanel();
    probeLog('probe start host=' + (context ? context.id : '?'));

    var seen = {};
    var order = [];
    var lastKey = '';

    var url = dataUrl();
    probeLog('data url length = ' + url.length);

    var panel = q1(emit);
    if (!panel) {
        done('VERDICT q1-fail: no CitadelHTMLPanel in this context. Ship offline-only.');
        return;
    }

    $.RegisterEventHandler('HTMLTitle', panel, function onTitle(p, title) {
        if (title === undefined && typeof p === 'string') { title = p; }
        if (typeof title !== 'string') { return; }
        if (title.indexOf('PM1|') !== 0) { return; }
        // Dedup on CONTENT. HTMLTitle fires twice per navigation; a length-keyed dedup
        // made five distinct ticks look like one and read as a dead stream.
        if (title === lastKey) { return; }
        lastKey = title;

        var parts = title.split('|');
        var kind = parts[1];
        var payload = parts.slice(3).join('|');
        if (!seen[kind]) { seen[kind] = payload; order.push(kind); }
        emit('  <- ' + kind + ' (' + payload.length + ' chars) ' + preview(payload));
    });

    try {
        panel.SetURL(url);
        emit('Q2 SetURL(data:) issued');
    } catch (e) {
        emit('Q2 SetURL threw: ' + e);
        done('VERDICT q2-fail: SetURL on a data: URL threw.');
        return;
    }

    var lengths = {};
    $.Schedule(TIMEOUT, function () {
        // Liveness first: if "end" never arrived, the page script died, which is a
        // different diagnosis from "everything ran and reported failure".
        if (!seen.end) {
            emit('page script did NOT reach its end - it died early');
        }
        if (!seen.alive) {
            emit('Q2 FAIL: no beacon at all. The page did not load or the downlink is dead.');
            done('VERDICT q2-fail: page never reported alive.');
            return;
        }
        emit('Q2 page loaded and pushed. replies=' + order.join(','));
        emit('Q3 types: ' + (seen.types || 'missing'));
        ['len64', 'len1024', 'len4096', 'len8192'].forEach(function (k) {
            if (seen[k]) { lengths[k] = seen[k].length; }
        });
        emit('Q3 lengths arrived: ' + JSON.stringify(lengths));
        emit('Q4 api.deadlock-api.com -> ' + (seen.api || 'no answer'));

        var apiOk = typeof seen.api === 'string' && seen.api.indexOf('ok ') === 0;
        var verdict;
        if (apiOk) {
            verdict = 'VERDICT q4-ok: transport works AND the API is reachable from here.';
        } else if (seen.api) {
            verdict = 'VERDICT q4-cors-or-tls: transport works, the API did not answer. ' +
                'Put a proxy on the bridge URL and retest.';
        } else {
            verdict = 'VERDICT q3-only: transport works, the API never answered. ' +
                'Keep the offline screen; treat API data as unavailable.';
        }
        probeLog(verdict);
        done(verdict);
    });
}

function preview(s) {
    if (s.length <= 90) { return s; }
    return s.substring(0, 90) + '...(' + s.length + ')';
}

// See the note in pm_compat.js: the module object must be created, not assumed.
PM.Probe = {
    run: run,
    pageSourceLength: function () { return PAGE_SOURCE.length; },
    dataUrlLength: function () { return dataUrl().length; }
};

probeLog('module loaded, page source ' + PAGE_SOURCE.length + ' chars, data url ' + PM.Probe.dataUrlLength() + ' chars');
}