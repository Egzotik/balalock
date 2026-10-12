// pm_compat.js — layout compatibility gate.
//
// WHY THIS FILE EXISTS
// A mod that overrides a vanilla Panorama layout has one fatal failure mode: the C++
// side looks up children of the overridden layout BY NAME, and stops with
//   FATAL ERROR: Unable to find child 'Team1Screen' in layout file
//   'panorama\layout\post_game\citadel_db_page_post_game_new.xml'
// if the copy it loaded does not contain what it expects. Removing a vanilla child is
// one way to cause that. So does Valve adding a NEW required child in a patch while we
// are still shipping last month's copy.
//
// The check below is the runtime half of that defence. tools/extract_vanilla.py is the
// build-time half. Neither replaces the other: the local-build extractor can only see
// compressed string tables, and this check only runs once the game is actually up.
//
// WHAT IT DOES
// Walks up from the current XML context to the host root, looks for the identifiers the
// host's C++ requires, and reports what it actually found. pm_core.js acts on the
// verdict: keep the button, or hide it and leave the vanilla page alone.
//
// Included by both hosts, so it must be idempotent.

'use strict';

// Namespace lives on $, NOT globalThis. Measured in game on build 25763945: each
// compiled .vjs_c gets its own globalThis, so a namespace attached there is a
// different object per file and pm_core.js sees an undefined PM.Compat. The $
// object IS shared by every script in one panel context - which is exactly how the
// DL Arcade mod shares its modules ($.MG). globalThis stays for XML entry points:
// onactivate="PMOpenOverlay()" resolves those fine.
var PM = ($.PM = $.PM || {});
if (PM.Compat) { /* double include, nothing to do */ }
else {

// ── What each host requires ──────────────────────────────────────────────────────
// Team1Screen / Team2Screen / ScoreboardScreen / GraphsScreen are the four carousel
// screens in the post-game page as of build 25763945. MVPScreen is deliberately NOT
// required: the shipped stylesheet still has an #MVPScreen rule but the layout in the
// installed build does not contain the panel, so requiring it would be wrong. It is
// probed and reported separately, because if a patch ever ADDS it, our override starts
// crashing and this is the line that tells us why.
var HOSTS = {
    // Entry point B: the post-game page. These are the ids the C++ side looks up by
    // name; losing any of them is what produces the "Unable to find child" fatal.
    post_game: {
        rootIds: ['CitadelPostGameNew'],
        required: [
            'ScreensCarousel', 'Team1Screen', 'Team2Screen',
            'ScoreboardScreen', 'GraphsScreen',
            'CarouselNavLeftArrow', 'CarouselNavRightArrow', 'CarouselNavItems',
            'PlayAgainButton', 'ReplayButton', 'CommendNotification'
        ],
        // Optional panels. Missing is fine; present means the build moved on.
        optional: ['MVPScreen']
    },

    // Entry point A: the profile page. Chosen over the home page because it is the one
    // dashboard page that already holds both data sources, so a button here is not a
    // shell: {d:player_stats_state} carries the career totals and {d:match_history_state}
    // carries the player's own match blocks.
    profile: {
        rootIds: ['CitadelProfilePage'],
        required: [
            // vanilla containers the profile page's stylesheet targets
            'StatsContent', 'StatsLeft', 'HeroList',
            'GamesPlayedContainer', 'GamesWonContainer',
            'LastHitsContainer', 'DeniesContainer', 'CommendsContainer',
            // our own button, so a build that lost the edit fails loudly here instead of
            // looking like a no-op mod
            'PM_ProfileButton'
        ],
        // MatchHistoryArea is optional because it lives inside a nested AsyncDataPanel:
        // a slow or failed history request leaves it absent, and that must not take the
        // career numbers down with it.
        optional: ['MatchHistoryArea', 'FriendID']
    },

    // Kept for the deferred dashboard-footer entry point. See docs/COMPAT.md,
    // "Deferred: dashboard footer entry": CitadelFooterBar is pinned to height 28px,
    // so an overlay cannot be hosted there yet. Nothing maps to this name today.
    dashboard_footer: {
        rootIds: ['CitadelFooterBar'],
        required: [
            'LeftCommandPanel', 'CenterLeftCommandPanel', 'CenterCommandPanel',
            'CenterRightCommandPanel', 'RightCommandPanel'
        ],
        optional: []
    }
};

function compatValid(panel) {
    return !!(panel && panel.IsValid());
}

function compatChildById(panel, id) {
    if (!compatValid(panel)) { return null; }
    var kids = panel.Children();
    if (!kids) { return null; }
    for (var i = 0; i < kids.length; i++) {
        if (kids[i].id === id) { return kids[i]; }
    }
    return null;
}

// Walk parents until we hit one of the host root ids. Bounded, because a bad override
// could in theory build a very deep tree.
function findHostRoot(contextPanel, rootIds) {
    var panel = contextPanel;
    for (var depth = 0; compatValid(panel) && depth < 60; depth++, panel = panel.GetParent()) {
        for (var i = 0; i < rootIds.length; i++) {
            if (panel.id === rootIds[i] || panel.paneltype === rootIds[i]) {
                return panel;
            }
        }
    }
    return null;
}

function checkHost(contextPanel, hostName) {
    var spec = HOSTS[hostName];
    var result = { host: hostName, ok: true, missing: [], present: [], optionalMissing: [] };
    var root = findHostRoot(contextPanel, spec.rootIds);
    if (!root) {
        result.ok = false;
        result.missing = spec.rootIds.slice();
        return result;
    }
    for (var i = 0; i < spec.required.length; i++) {
        var id = spec.required[i];
        if (compatValid(compatChildById(root, id))) { result.present.push(id); }
        else { result.missing.push(id); }
    }
    for (var j = 0; j < spec.optional.length; j++) {
        if (!compatValid(compatChildById(root, spec.optional[j]))) {
            result.optionalMissing.push(spec.optional[j]);
        }
    }
    result.ok = result.missing.length === 0;
    return result;
}

function describe(result) {
    var parts = [];
    parts.push('host=' + result.host);
    parts.push('ok=' + result.ok);
    parts.push('present=' + result.present.length);
    if (result.missing.length) { parts.push('MISSING[' + result.missing.join(',') + ']'); }
    if (result.optionalMissing.length) {
        parts.push('optional-absent[' + result.optionalMissing.join(',') + ']');
    }
    return parts.join(' ');
}

// Called by pm_core.js for each host it detects. Returns the verdict object.
// The module object has to be CREATED here, not just have fields assigned onto it.
// Assigning PM.Compat.check when PM.Compat is undefined throws
// "Cannot set properties of undefined" and the whole file is skipped at load, which is
// exactly what happened in build 5: pm_data and pm_net survived because they assign
// PM.Data = {...} / PM.Net = {...} wholesale, while this file and pm_probe.js died on
// their first field.
PM.Compat = {
    check: checkHost,
    findHostRoot: findHostRoot,
    describe: describe,
    childById: compatChildById,
    valid: compatValid
};

$.Msg('[PM] compat module loaded');
}