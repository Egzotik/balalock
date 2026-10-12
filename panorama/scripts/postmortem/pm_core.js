// pm_core.js — POSTMORTEM entry controller and overlay lifecycle.
//
// Loaded last, in both hosts (home page and post-game page). Responsibilities, in
// order:
//
//   1. work out which host we are in
//   2. run the compatibility gate (pm_compat.js) and only then reveal the button
//   3. measure whether the overlay has room; hide ourselves if it does not
//   4. build the overlay once and reuse it
//   5. wire the close button, ESC, and the diagnostics entry point
//
// Panorama constraints that shape this file, all confirmed in-game by other Deadlock
// mods rather than assumed:
//   - no async/await, no fetch, no localStorage, no setTimeout: use $.Schedule
//   - no Game / GameEvents global, so nothing here listens for engine events; state is
//     discovered by walking panels
//   - a page can be hidden or destroyed while we are alive, so every handle is
//     re-checked with IsValid() and every loop stops on its own
//   - panels created with $.CreatePanel render with the stylesheets of the XML context
//     that created them, which is why pm_root.vcss is included by the hosts
//
// Data collection, analysis and the API transport are separate modules. This file only
// owns the screen and its lifecycle.

'use strict';

// Namespace lives on $, NOT globalThis. Measured in game on build 25763945: each
// compiled .vjs_c gets its own globalThis, so a namespace attached there is a
// different object per file and pm_core.js sees an undefined PM.Compat. The $
// object IS shared by every script in one panel context - which is exactly how the
// DL Arcade mod shares its modules ($.MG). globalThis stays for XML entry points:
// onactivate="PMOpenOverlay()" resolves those fine.
var PM = ($.PM = $.PM || {});

// Strings live here rather than in localisation tokens. Panorama's localisation for
// addons was not verified for this game build, and an unresolved #Token renders as its
// own key, which is worse than English text. Phase 6 adds RU alongside EN here.
(function () {

// One table for all user-visible strings, from pm_text.js. The local TEXT above only
// holds literals used while building the panel tree.
// One table for every user-visible string, from pm_text.js. It used to be split
// across two files, which is how a key ended up missing from one and present
// in the other; there is now exactly one.
var T = PM.Text.TABLE;

// ── host identification ───────────────────────────────────────────────────────────
// Both hosts name their layout root after the panel type, so a single check at depth 0
// is enough. Anything else means we were included somewhere unexpected: stay inert
// rather than guess.
function detectHost(contextPanel) {
    if (!PM.Compat.valid(contextPanel)) { return null; }
    if (contextPanel.id === 'CitadelPostGameNew' || contextPanel.paneltype === 'CitadelPostGameNew') {
        return 'post_game';
    }
    if (contextPanel.id === 'CitadelProfilePage' || contextPanel.paneltype === 'CitadelProfilePage') {
        return 'profile';
    }
    return null;
}

// Maps the host we detected to its spec in pm_compat. Both names are the same today,
// but keeping them separate means a host can be renamed in one place only.
var HOST_SPEC = {
    profile: 'profile',
    post_game: 'post_game'
};

// ── panel helpers ─────────────────────────────────────────────────────────────────
// AddClass() takes ONE class name. Passing 'PMChartFill you' adds a single class
// literally called "PMChartFill you", which matches no rule in the stylesheet - so every
// two-class call site silently rendered unstyled. Six of them, including the chart bars,
// which is why the chart showed two identical empty tracks per row.
//
// Split on whitespace and add each one, so 'A B' means what it looks like.
function addClasses(panel, cls) {
    if (!panel || !cls) { return; }
    var parts = cls.split(/\s+/);
    for (var i = 0; i < parts.length; i++) {
        if (parts[i]) { panel.AddClass(parts[i]); }
    }
}

function make(type, parent, id, cls) {
    var panel = $.CreatePanel(type, parent, id);
    addClasses(panel, cls);
    return panel;
}

function setLabelText(panel, text) {
    if (alive(panel)) { panel.text = text; }
}

// ── overlay construction ──────────────────────────────────────────────────────────
// Built once per host and then only shown/hidden. Rebuilding on every open would
// churn a few hundred panels for nothing, and the user will open this screen many
// times in a session.
function buildOverlay(context) {
    var overlay = $.CreatePanel('Panel', context, 'PMOverlay');
    if (!overlay) {
        $.Msg('[PM] failed to create overlay panel');
        return null;
    }

    var backdrop = make('Panel', overlay, 'PMBackdrop', '');
    // Consume the click. Without this a stray click can land on whatever the dashboard
    // has underneath, which is exactly the failure the DL Arcade mod logged as bug #2.
    backdrop.hittest = true;

    var frame = make('Panel', overlay, 'PMFrame', '');

    // header
    var header = make('Panel', frame, 'PMHeader', '');
    var title = make('Label', header, 'PMTitleLabel', '');
    title.text = 'POSTMORTEM';
    var subtitle = make('Label', header, 'PMSubtitleLabel', '');
    subtitle.text = T.subtitle;
    make('Panel', header, 'PMSpacer', '');

    var headerRight = make('Panel', header, 'PMHeaderRight', '');
    var badge = make('Panel', headerRight, 'PMSourceBadge', '');
    var badgeLabel = make('Label', badge, 'PMSourceBadgeLabel', '');
    badgeLabel.text = T.sourceBadge;

    var closeButton = make('Button', headerRight, 'PMCloseButton', '');
    var closeLabel = make('Label', closeButton, 'PMCloseButtonLabel', '');
    closeLabel.text = T.closeButton;
    closeButton.SetPanelEvent('onactivate', closeOverlay);

    // body - the one scrollable panel on the screen
    var body = make('Panel', frame, 'PMBody', '');
    // A wheel event only reaches a hit-testable panel, and this one is created rather
    // than declared in XML, so it gets no chance to opt in.
    body.hittest = true;

    var status = make('Label', body, 'PMStatus', '');
    status.text = T.statusLoading;

    // hero card. Populated in phase 3 from the native scoreboard; the structure is here
    // now so the layout does not shift later.
    var heroSection = make('Panel', body, 'PMSection', '');
    make('Label', heroSection, 'PMSectionTitle', '').text = T.sectionMatch;
    make('Panel', heroSection, 'PMSectionRule', '');
    var heroCard = make('Panel', heroSection, 'PMHeroCard', '');
    // There is no portrait here. The game addresses hero art by an internal id
    // (s2r://panorama/images/heroes/<id>_mm_psd.vtex_c) while the scoreboard gives a
    // display name, so filling it would mean a thirty-entry lookup table that breaks on
    // the next hero patch - and a wrong id renders as a broken image, which looks worse
    // than no image. An empty 64px frame looked like a failed load; nothing at all does
    // not.
    var heroMeta = make('Panel', heroCard, 'PMHeroMeta', '');
    make('Label', heroMeta, 'PMHeroName', '').text = T.heroUnknown;
    var heroKda = make('Label', heroMeta, 'PMHeroKda', '');
    heroKda.text = T.noMatchData;
    var heroMeta2 = make('Label', heroMeta, 'PMHeroMeta2', '');
    heroMeta2.text = '';

    // Вердикт стоит сразу под героем, а не внизу: это ответ на первый вопрос игрока,
    // и он должен читаться до прокрутки.
    var verdictBox = make('Panel', body, 'PMVerdict', '');
    var verdictTitle = make('Label', verdictBox, 'PMVerdictTitle', '');
    verdictTitle.text = '';
    var verdictNote = make('Label', verdictBox, 'PMVerdictNote', '');
    verdictNote.text = '';
    state.verdictBox = verdictBox;
    state.verdictTitle = verdictTitle;
    state.verdictNote = verdictNote;

    var metricSection = make('Panel', body, 'PMSection', '');
    make('Label', metricSection, 'PMSectionTitle', '').text = T.sectionAgainstLobby;
    make('Panel', metricSection, 'PMSectionRule', '');
    var metricRow = make('Panel', metricSection, 'PMMetricRow', '');
    for (var i = 0; i < 6; i++) {
        var card = make('Panel', metricRow, '', 'PMMetricCard');
        make('Label', card, '', 'PMMetricName').text = '-';
        make('Label', card, '', 'PMMetricValue').text = '-';
        make('Label', card, '', 'PMMetricLobby').text = '';
        make('Label', card, '', 'PMMetricRank').text = '';
    }

    // Every section gets its OWN body id.
    //
    // They used to share the class PMTableBody, and FindChildTraverse returns the first
    // match in tree order - so the profile list, the fail-open problem list and the
    // report all wrote into the same panel and overwrote each other. On screen that
    // looked like "the sections below are empty" rather than like a bug.
    // График «ты против медианы». Шесть строк, в каждой две полосы. Полосы нужны
    // потому, что «42 000» и «31 500» рядом не показывают провал - его показывает
    // длина полосы, и глазом это считывается быстрее, чем сравнением цифр.
    var chartSection = make('Panel', body, 'PMSection', '');
    make('Label', chartSection, 'PMSectionTitle', '').text = T.sectionChart;
    make('Panel', chartSection, 'PMSectionRule', '');
    var chartLegend = make('Panel', chartSection, 'PMChartLegend', '');
    make('Label', chartLegend, '', 'PMLegendYou').text = T.colYou;
    make('Label', chartLegend, '', 'PMLegendMedian').text = T.colMedian;
    make('Panel', chartSection, 'PMChartBody');

    var breakdownSection = make('Panel', body, 'PMSection', '');
    make('Label', breakdownSection, 'PMSectionTitle', '').text = T.sectionBreakdown;
    make('Panel', breakdownSection, 'PMSectionRule', '');
    var gapLine = make('Label', breakdownSection, 'PMBreakdownHeadline', '');
    gapLine.text = '';
    var breakdownRows = make('Panel', breakdownSection, 'PMBreakdownRow', '');
    var awardRow = make('Panel', breakdownSection, 'PMAwardRow', '');
    var ignoredRow = make('Panel', breakdownSection, 'PMIgnoredRow', '');

    var statSection = make('Panel', body, 'PMSection', '');
    make('Label', statSection, 'PMSectionTitle', '').text = T.sectionStatLine;
    make('Panel', statSection, 'PMSectionRule', '');
    var statHeader = make('Panel', statSection, 'PMStatHeader', '');
    make('Label', statHeader, '', 'PMCell name').text = T.rowStat;
    make('Label', statHeader, '', 'PMCell').text = T.colYou;
    make('Label', statHeader, '', 'PMCell').text = T.colMedian;
    make('Label', statHeader, '', 'PMCell rank').text = T.colRank;
    make('Panel', statSection, 'PMStatBody');

    var lobbySection = make('Panel', body, 'PMSection', '');
    make('Label', lobbySection, 'PMSectionTitle', '').text = T.sectionLobby;
    make('Panel', lobbySection, 'PMSectionRule', '');
    var lobbyHeader = make('Panel', lobbySection, 'PMTableHeader', '');
    make('Label', lobbyHeader, '', 'PMCell name').text = T.rowHero;
    make('Label', lobbyHeader, '', 'PMCell').text = T.rowKda;
    make('Label', lobbyHeader, '', 'PMCell').text = T.colSouls;
    make('Label', lobbyHeader, '', 'PMCell dmg').text = T.rowHeroDamage;
    make('Panel', lobbySection, 'PMLobbyBody');

    var adviceSection = make('Panel', body, 'PMSection', '');
    make('Label', adviceSection, 'PMSectionTitle', '').text = T.sectionAdvice;
    make('Panel', adviceSection, 'PMSectionRule', '');
    make('Panel', adviceSection, 'PMAdviceBody');
    // Диагностика всегда внизу, а советы - над ней: советы это ответ, диагностика
    // это инструмент для того, кто пишет баг-репорт.

    var teamSection = make('Panel', body, 'PMSection', '');
    make('Label', teamSection, 'PMSectionTitle', '').text = T.sectionTeamTotals;
    make('Panel', teamSection, 'PMSectionRule', '');
    var teamColumns = make('Panel', teamSection, 'PMTeamColumns', '');
    var mine = make('Panel', teamColumns, '', 'PMTeamColumn PMTeamMine');
    var theirs = make('Panel', teamColumns, '', 'PMTeamColumn PMTeamTheirs');
    for (var k = 0; k < 5; k++) {
        var rowA = make('Panel', mine, '', 'PMTeamCellMine');
        make('Label', rowA, '', 'PMTeamLabel').text = '-';
        make('Label', rowA, '', 'PMTeamValue').text = '-';
        var rowB = make('Panel', theirs, '', 'PMTeamCellTheirs');
        make('Label', rowB, '', 'PMTeamLabel').text = '-';
        make('Label', rowB, '', 'PMTeamValue').text = '-';
    }

    // Diagnostics is not a throwaway debug menu: phase 1 has to answer whether the CEF
    // transport works in this context, and the user is the only one who can run the
    // game. Surfacing the result on screen is the difference between a bug report and
    // a verdict.
    var diagSection = make('Panel', body, 'PMSection', '');
    make('Label', diagSection, 'PMSectionTitle', '').text = T.sectionDiagnostics;
    make('Panel', diagSection, 'PMSectionRule', '');
    var diagRow = make('Panel', diagSection, 'PMTableRow', '');
    make('Label', diagRow, '', 'PMCell name').text = T.diagRun;
    var diagButton = make('Button', diagRow, 'PMCloseButton', '');
    make('Label', diagButton, 'PMCloseButtonLabel', '').text = T.diagRunButton;
    diagButton.SetPanelEvent('onactivate', runDiagnostics);
    var diagOut = make('Panel', diagSection, 'PMDiagBody', '');
    state.diagOutput = diagOut;
    // Fail-open problems get their own panel for the same reason the sections do.
    var problemsHead = make('Label', diagSection, 'PMProblemsHeader', 'PMBreakdownLine');
    problemsHead.text = T.wrongNone;
    make('Panel', diagSection, 'PMProblemsBody');

    // footer
    var footer = make('Panel', frame, 'PMFooter', '');
    make('Label', footer, 'PMFooterNote', '').text = T.footerNote;
    var footerSpacer = make('Panel', footer, 'PMSpacer', '');
    footerSpacer.width = 'fill-parent-flow( 1.0 )';

    overlay.style.visibility = 'collapse';
    return overlay;
}

// ── state ─────────────────────────────────────────────────────────────────────────
var state = {
    host: null,
    context: null,
    overlay: null,
    compat: null,
    button: null,
    opened: false,
    stopLoop: null,
    matchId: '',
    geom: { w: 0, h: 0, via: '' },
    // Everything that went wrong, in order. The button and the overlay stay available
    // regardless; this list is what gets shown inside the overlay. Fail-open is
    // deliberate: build 3 made button visibility JS-owned and then any boot failure
    // removed the button completely, which is indistinguishable from "the mod is not
    // installed". A mod that explains itself beats a mod that silently vanishes.
    problems: [],

    // Panel handles built once and reused. These live in state, not on the module
    // namespace: PM is what modules publish, and stashing UI handles on it made
    // PM.verdictBox look like a published API that another module was expected to read.
    diagOutput: null,
    verdictBox: null,
    verdictTitle: null,
    verdictNote: null,

    // Latched diagnostics, so a 0.5 second refresh loop does not repeat itself.
    hostWarned: false,
    refreshErrors: 0
};

function note(msg) {
    state.problems.push(msg);
    $.Msg('[PM] problem: ' + msg);
}

// Show or hide a panel. `visibility: collapse` removes it from layout entirely, which
// is what we want for a button that has no reason to be on screen yet.
// Local, so a missing or broken pm_compat.js can never take the whole screen down.
// In build 5 setVisible() itself threw on PM.Compat.valid, which meant the reveal of
// the entry button never ran and every click threw.
function alive(panel) {
    return !!(panel && panel.IsValid());
}

function setVisible(panel, visible) {
    if (!alive(panel)) { return; }
    var want = visible ? 'visible' : 'collapse';
    if (panel.style.visibility !== want) { panel.style.visibility = want; }
    panel.enabled = visible;
    panel.hittest = visible;
}

// Layout geometry, read once and cached per host.
//
// Why measured instead of CSS-only: build 2 shipped an overlay sized with
// `width: 100%; height: 100%` and a `visibility: collapse` default in the stylesheet.
// In game the overlay was created, opened and closed on ESC - and drew nothing. The
// failure is invisible-by-design: the object exists and toggles, so every JS-level
// check passes while nothing reaches the screen.
//
// Two contributing causes, both removed here:
//   1. `100%` needs a sized parent, and the parent is a DashboardPage whose layout is
//      not resolved when the layout script runs.
//   2. `visibility` was set in BOTH the stylesheet and inline. Inline should win, but
//      relying on that precedence for "is this thing on screen" is one too many links.
//
// So: explicit pixel geometry from the measured parent, and the stylesheet no longer
// hides the overlay at all.
// Find a usable screen size.
//
// Measured size on the host itself is not trustworthy: CitadelPostGameNew is a
// DashboardPage, and a DashboardPage root can report 0x0 (or no
// actuallayoutwidth at all) while its layout script runs. So walk up the ancestors
// until one reports something plausible, and remember which one answered.
//
// If nothing does, `size` stays null and the CSS fallback takes over. Getting this
// wrong is what left build 5's overlay invisible with a button that did nothing.
function resolveSize(context) {
    var panel = context;
    var chain = [];
    for (var depth = 0; panel && panel.IsValid() && depth < 12; depth++, panel = panel.GetParent()) {
        var w = panel.actuallayoutwidth;
        var h = panel.actuallayoutheight;
        chain.push((panel.id || panel.paneltype || '?') + '=' + w + 'x' + h);
        if (w >= 600 && h >= 400) {
            $.Msg('[PM] size from ' + (panel.id || panel.paneltype) + ' ' + w + 'x' + h);
            return { w: w, h: h, via: panel.id || panel.paneltype, chain: chain };
        }
    }
    $.Msg('[PM] no ancestor reported a usable size; chain: ' + chain.join(' '));
    return null;
}

function measure(context) {
    var size = resolveSize(context);
    if (size) {
        state.geom.w = size.w;
        state.geom.h = size.h;
        state.geom.via = size.via;
    }
    $.Msg('[PM] host geometry ' + state.geom.w + 'x' + state.geom.h +
          ' via=' + (state.geom.via || '?') +
          ' id=' + (context.id || '?') + ' type=' + (context.paneltype || '?'));
    return state.geom;
}

function applyGeometry(overlay) {
    if (!alive(overlay)) { return false; }
    if (state.geom.w && state.geom.h) {
        overlay.style.width = state.geom.w + 'px';
        overlay.style.height = state.geom.h + 'px';
        overlay.style.marginLeft = '0px';
        overlay.style.marginRight = '0px';
        overlay.style.marginTop = '0px';
        overlay.style.marginBottom = '0px';
        overlay.style.horizontalAlign = 'left';
        overlay.style.verticalAlign = 'top';
    } else {
        // Fallback, NOT a no-op. Relative sizing needs a sized ancestor, but it is a
        // far better guess than leaving the overlay with no size at all - which is what
        // build 5 did, and why the button did nothing when pressed.
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.horizontalAlign = 'left';
        overlay.style.verticalAlign = 'top';
        $.Msg('[PM] geometry fallback: overlay sized 100% of its parent');
    }
    overlay.style.zIndex = '10000';
    return true;
}

// Everything about the overlay that could hide it, in one log line. Called on every
// open so one run tells us which of these is wrong instead of three rounds of guessing.
function reportGeometry(overlay, tag) {
    if (!alive(overlay)) { $.Msg('[PM] ' + tag + ' overlay INVALID'); return; }
    var frame = PM.Data.childById(overlay, 'PMFrame');
    var back = PM.Data.childById(overlay, 'PMBackdrop');
    $.Msg('[PM] ' + tag + ' vis=' + overlay.style.visibility +
          ' overlay=' + overlay.actuallayoutwidth + 'x' + overlay.actuallayoutheight +
          ' backdrop=' + (alive(back) ? back.actuallayoutwidth + 'x' + back.actuallayoutheight : '?') +
          ' frame=' + (alive(frame) ? frame.actuallayoutwidth + 'x' + frame.actuallayoutheight : '?') +
          ' children=' + overlay.Children().length +
          ' xIndex=' + overlay.style.zIndex +
          ' parent=' + (overlay.GetParent() ? (overlay.GetParent().id || overlay.GetParent().paneltype) : 'null'));
}

// Does the overlay have anywhere to draw? The home page root is full screen, but this
// check is what told us the dashboard footer would NOT have been, and a future host
// could regress the same way. Measured, not assumed.
function overlayHasRoom(context) {
    var g = measure(context);
    // 600x400 is the smallest size that could hold the metric cards at all.
    return g.w >= 600 && g.h >= 400;
}

// ── open / close ──────────────────────────────────────────────────────────────────
// ── scoreboard tab ─────────────────────────────────────────────────────────────────
//
// The scoreboard is instantiated lazily: the post-game page opens on the MVP screen, and
// #Scoreboard does not exist until its tab has been visited. Reading it first therefore
// fails, and asking the user to go and click a tab is a poor answer when the game already
// has a control for exactly that.
//
// The page builds one nav item per carousel screen and gives it the screen's own
// navclass, so the Scoreboard tab is reachable by activating the nav item whose class is
// "Scoreboard". Same mechanism as the View Details handoff, and it uses the game's own
// control rather than poking the carousel's internals.
function selectScoreboardTab(context) {
    var nav = context.FindChildTraverse('CarouselNavItems');
    if (!alive(nav)) { return false; }

    // Take the class off the screen itself rather than hardcoding 'Scoreboard'.
    var want = 'Scoreboard';
    var screen = context.FindChildTraverse('ScoreboardScreen');
    if (alive(screen) && screen.navclass) { want = screen.navclass; }

    var items = nav.FindChildrenWithClassTraverse(want);
    if (!items || !items.length) {
        $.Msg('[PM] nav: no item with class ' + want);
        return false;
    }
    $.DispatchEvent('Activated', items[0], 'mouse');
    return true;
}

// Whether the scoreboard exists yet, without reading anything from it.
function scoreboardReady(context) {
    var carousel = context.FindChildTraverse('ScreensCarousel');
    if (!alive(carousel)) { return false; }
    var screen = PM.Data.childById(carousel, 'ScoreboardScreen');
    return alive(screen) && alive(PM.Data.childById(screen, 'Scoreboard'));
}

// Is the body actually scrollable?
//
// Wheel scrolling is not something this file can force: it depends on the panel being
// hit-testable and having more content than height, and neither is visible from here.
// What IS testable is whether the panel ACCEPTS a scroll offset. Set one, read it back,
// and say so in the log - so "the wheel does nothing" comes with an answer attached
// instead of needing another round trip to guess at.
function reportScroll(context) {
    var box = body('PMBody');
    if (!alive(box)) { return; }
    var before = box.scrollTop;
    var asked = 1;
    box.scrollTop = asked;
    var got = box.scrollTop;
    box.scrollTop = before;
    $.Msg('[PM] scroll body=' + box.actuallayoutwidth + 'x' + box.actuallayoutheight +
          ' acceptsOffset=' + (got === asked ? 'yes' : ('no(' + got + ')')) +
          ' hittest=' + !!box.hittest);
}

function openOverlay() {
    var context = state.context;
    if (!alive(context)) {
        $.Msg('[PM] open requested but host context is gone');
        return;
    }
    if (!state.overlay) { state.overlay = buildOverlay(context); }
    if (!state.overlay) { return; }

    // If the layout was not resolved when the scripts ran, the cached geometry is empty.
    // Measure again now that the user is looking at the page.
    if (!state.geom.w || !state.geom.h) { measure(context); }
    applyGeometry(state.overlay);

    setVisible(state.overlay, true);
    state.opened = true;
    reportGeometry(state.overlay, 'open');

    // One frame later the layout is resolved and the numbers mean something. Build 5
    // only ever reported the pre-frame state, which is exactly when a DashboardPage
    // still measures 0x0.
    $.Schedule(0.1, function () {
        if (!state.opened || !alive(state.overlay)) { return; }
        resolveSize(context);
        applyGeometry(state.overlay);
        reportGeometry(state.overlay, 'open+1f');
        reportScroll(context);
    });

    refresh();

    // If the scoreboard has not been built yet, build it: press the game's own nav item
    // and let the refresh loop below pick the data up a frame later. Asking the user to
    // go and click a tab they may not even see is worse than doing it for them.
    if (state.host === 'post_game' && !scoreboardReady(context)) {
        setLabelText(context.FindChildTraverse('PMStatus'), T.statusOpeningTable);
        if (selectScoreboardTab(context)) {
            state.tabRequests = (state.tabRequests || 0) + 1;
            $.Msg('[PM] scoreboard not built; activating its nav item');
        } else if (state.tabRequests >= 3) {
            note('cannot reach the Scoreboard tab on this page; open it by hand once');
            setLabelText(context.FindChildTraverse('PMStatus'), T.statusNeedScoreboardTab);
        }
    } else {
        state.tabRequests = 0;
    }

    // The post-game page is destroyed or hidden while we live, so a refresh loop keeps
    // the Match ID and the host verdict current. 0.5s while the overlay is open.
    if (!state.stopLoop) {
        state.stopLoop = $.Schedule(0.5, function tick() {
            if (!state.opened) { state.stopLoop = null; return; }
            if (!alive(state.context)) {
                state.opened = false;
                state.stopLoop = null;
                return;
            }
            refresh();
            state.stopLoop = $.Schedule(0.5, tick);
        });
    }
}

function closeOverlay() {
    state.opened = false;
    if (state.stopLoop) {
        $.CancelScheduled(state.stopLoop);
        state.stopLoop = null;
    }
    setVisible(state.overlay, false);
}

// ── content refresh ───────────────────────────────────────────────────────────────
// Two hosts, two very different data sets, read on every refresh:
//
//   profile   career totals + the player's own match blocks. Picking a match dispatches
//             the game's own "View Details", which navigates to the post-game page - so
//             this host's only real job is to list matches and hand off.
//   post_game the full stat line for whichever match is open, past or just played.
// Refresh runs on a 0.5 second timer for as long as the overlay is open, so a throw
// inside it does not just lose one frame: the reschedule is the last statement, so the
// loop dies and the screen silently stops updating while still looking correct. It threw
// once on the real match and the only evidence was an undecodable line in console.log.
//
// Fail-open, and say once why.
function refresh() {
    var context = state.context;
    if (!alive(context) || !PM.Data) { return; }
    if (!state.host) {
        // Do not sit here quietly. An empty screen that LOOKS finished is the worst
        // possible failure, and it is exactly what a null host produces.
        if (!state.hostWarned) {
            state.hostWarned = true;
            $.Msg('[PM] refresh: no host detected, nothing to read');
            note('this page is not one POSTMORTEM knows how to read; nothing will load');
        }
        return;
    }
    try {
        if (state.host === 'profile') { refreshProfile(context); }
        else if (state.host === 'post_game') { refreshPostGame(context); }
        state.refreshErrors = 0;
    } catch (err) {
        state.refreshErrors = (state.refreshErrors || 0) + 1;
        if (state.refreshErrors === 1) {
            $.Msg('[PM] refresh failed: ' + err);
        }
    }
}

function refreshPostGame(context) {
    var data = PM.Data.readPostGame(context);
    if (data.matchId && data.matchId !== state.matchId) {
        state.matchId = data.matchId;
        $.Msg('[PM] match id: ' + data.matchId);
    }

    var status = context.FindChildTraverse('PMStatus');
    if (data.ok) {
        setLabelText(status, data.matchId + '  \u00b7  ' + PM.Text.int(data.players.length, T.rowPlayers));
    } else if (data.reason === 'scoreboard-not-instantiated') {
        // Expected, not an error: the scoreboard component is only built once its tab
        // has been opened. Say so instead of showing an empty screen.
        setLabelText(status, T.statusNeedScoreboardTab);
    } else {
        setLabelText(status, T.statusNoMatch);
    }
    renderReport(context, data);
}

function refreshProfile(context) {
    var career = PM.Data.readCareer(context);
    state.career = career;
    var history = PM.Data.readMatchHistory(context);
    state.history = history;

    var status = context.FindChildTraverse('PMStatus');
    if (history.ok) {
        setLabelText(status, career.ok
            ? (career.gamesPlayed + ' matches, ' + career.gamesWon + ' won, ' + history.blocks.length + ' listed')
            : (history.blocks.length + ' matches listed'));
    } else {
        setLabelText(status, T.statusNoHistory);
    }
    renderProfile(context, career, history);
}

// ── report rendering ──────────────────────────────────────────────────────────────
// ── report rendering ───────────────────────────────────────────────────────────────
// The screen is a straight port of the desktop app's postmortem view, in this order:
//
//   this match        hero, KDA, length, result
//   against the lobby six KPI cards, each with the lobby median and the rank
//   the breakdown    the single worst metric, then farm / fights / objectives
//                     in prose, then the team's own award chips
//   stat line         every metric, you vs median vs place, out of N
//   lobby             all twelve players by hero damage, yours marked
//   what to change    the advice list
//   team totals       your side vs theirs, side by side
//
// Every value below comes either from the scoreboard or from pm_analysis. Nothing here
// is invented to fill a slot: a figure that could not be read prints "n/a" and is left
// out of the distribution, and if the local player cannot be identified the whole report
// says so rather than analysing a stranger.

function clearChildren(panel) {
    if (!alive(panel)) { return; }
    var kids = panel.Children();
    while (kids.length > 0) { $.RemoveChild(kids[0]); }
}

function body(id) {
    return state.context ? state.context.FindChildTraverse(id) : null;
}

function fmt(n) { return PM.Text.f(n, ''); }

function renderReport(context, data) {
    var heroName = context.FindChildTraverse('PMHeroName');
    var heroKda = context.FindChildTraverse('PMHeroKda');
    var heroMeta = context.FindChildTraverse('PMHeroMeta2');

    // Clear first. The panel tree is built once and reused, so without this a second open
    // shows the previous match's rows underneath the new ones.
    clearChildren(body('PMChartBody'));
    clearChildren(body('PMStatBody'));
    clearChildren(body('PMLobbyBody'));
    clearChildren(body('PMAdviceBody'));
    clearChildren(body('PMBreakdownRow'));
    clearChildren(body('PMAwardRow'));
    clearChildren(body('PMIgnoredRow'));
    setLabelText(context.FindChildTraverse('PMBreakdownHeadline'), '');
    if (alive(state.verdictTitle)) { state.verdictTitle.text = ''; }
    if (alive(state.verdictNote)) { state.verdictNote.text = ''; }

    var report = PM.Analysis.build(data);

    if (!report.ok) {
        setLabelText(heroName, T.heroUnknown);
        setLabelText(heroMeta, '');
        setLabelText(heroKda, report.reason === 'scoreboard-not-instantiated'
            ? T.statusNeedScoreboardTab
            : (report.reason === 'local-player-not-marked' ? T.noLocalPlayer
                : 'На этом экране нет данных матча.'));
        return;
    }

    var me = report.focus;
    var n = report.lobby.length;

    setLabelText(heroName, me.hero || T.heroUnknown);
    setLabelText(heroKda, PM.Text.int(me.kills) + ' / ' + PM.Text.int(me.deaths) + ' / ' +
                            PM.Text.int(me.assists));

    var metaBits = [];
    metaBits.push(report.mine.winning ? T.won : T.lost);
    if (report.minutes !== null) { metaBits.push(report.minutes + ' мин'); }
    if (report.mvpRank !== null) { metaBits.push(T.mvp + ' ' + report.mvpRank); }
    setLabelText(heroMeta, metaBits.join('   ·   '));

    // ── вердикт ─────────────────────────────────────────────────────────────────
    var vd = PM.Text.verdict(report);
    if (alive(state.verdictBox)) {
        state.verdictBox.RemoveClass('good');
        state.verdictBox.RemoveClass('mid');
        state.verdictBox.RemoveClass('bad');
        state.verdictBox.AddClass(vd.key);
        state.verdictTitle.text = vd.title;
        state.verdictNote.text = vd.note;
    }

    // ── KPI cards ───────────────────────────────────────────────────────────────
    var row = context.FindChildTraverse('PMMetricRow');
    var cards = row ? row.Children() : [];
    for (var i = 0; i < cards.length; i++) {
        var labels = cards[i].Children();
        if (i >= report.statLine.length) {
            setLabelText(labels[0], '');
            setLabelText(labels[1], '');
            setLabelText(labels[2], '');
            setLabelText(labels[3], '');
            continue;
        }
        var m = report.statLine[i];
        setLabelText(labels[0], m.label);
        setLabelText(labels[1], fmt(m.you));
        setLabelText(labels[2], 'медиана ' + fmt(m.median));
        setLabelText(labels[3], m.rank === null ? '' : (m.rank + ' из ' + m.of));
        // Подсветка только для настоящего выброса, и только когда строк достаточно.
        if (cards[i].BHasClass('warn')) { cards[i].RemoveClass('warn'); }
        if (m.rank !== null && m.of >= 8 && (m.rank > m.of - 2 || m.rank <= 2)) {
            cards[i].AddClass('warn');
        }
    }

    // ── график: ты против медианы ───────────────────────────────────────────────
    //
    // Каждая полоса нормирована по своему же максимуму (ты или медиана), с запасом.
    // Общий масштаб по всем метрикам дал бы шесть рядов, где пять выглядят как
    // «ноль»: урон в десятки тысяч, участие в процентах, смерти в единицах.
    var chartBox = body('PMChartBody');
    if (alive(chartBox)) {
        for (var c = 0; c < report.statLine.length; c++) {
            var cs = report.statLine[c];
            var scale = Math.max(num(cs.you), num(cs.median), 1) * 1.15;
            var cr = make('Panel', chartBox, 'PMChartRow');

            make('Label', cr, 'PMChartName', '').text = cs.label;

            var bars = make('Panel', cr, 'PMChartBars', '');
            var youTrack = make('Panel', bars, 'PMChartTrack', '');
            var youFill = make('Panel', youTrack, '', 'PMChartFill you');
            youFill.style.width = pctOf(cs.you, scale) + '%';
            var medTrack = make('Panel', bars, 'PMChartTrack', '');
            var medFill = make('Panel', medTrack, '', 'PMChartFill median');
            medFill.style.width = pctOf(cs.median, scale) + '%';

            var youNum = make('Label', cr, 'PMChartYou', '');
            youNum.text = fmt(cs.you);
            var medNum = make('Label', cr, 'PMChartMedian', '');
            medNum.text = fmt(cs.median);
            make('Label', cr, 'PMChartRank', '').text =
                (cs.rank === null ? '' : (cs.rank + ' / ' + cs.of));
        }
    }

    // ── разбор ─────────────────────────────────────────────────────────────────
    var bd = PM.Text.breakdown(report);
    var breakdownBox = body('PMBreakdownRow');
    if (bd && alive(breakdownBox)) {
        var tagged = [
            { tag: T.tagFarm, text: bd.farm },
            { tag: T.tagFights, text: bd.fights },
            { tag: T.tagObjectives, text: bd.objectives }
        ];
        for (var b = 0; b < tagged.length; b++) {
            var br = make('Panel', breakdownBox, '', 'PMBreakdownRowItem');
            make('Label', br, '', 'PMBreakdownTag').text = tagged[b].tag;
            make('Label', br, '', 'PMBreakdownLine').text = tagged[b].text;
        }
    }

    if (report.worst) {
        setLabelText(context.FindChildTraverse('PMBreakdownHeadline'),
            T.gapPrefix + ' ' + report.worst.label + ' - ' +
            PM.Text.place(report.worst, n) + ' (у вас ' + fmt(report.worst.you) +
            ' против медианы ' + fmt(report.worst.median) + ')');
    }

    // Метрики, которые не в счёт. Если этого не сказать, то «11 из 12 по лечению»
    // просто ичезает, и выглядит так, будто мод что-то потерял.
    var ignoredBox = body('PMIgnoredRow');
    if (alive(ignoredBox) && report.ignored.length) {
        for (var ig = 0; ig < report.ignored.length; ig++) {
            var igRow = make('Panel', ignoredBox, '', 'PMIgnoredItem');
            make('Label', igRow, '', 'PMIgnoredLabel').text =
                T.ignoredNote + PM.Text.metricLabel(report.ignored[ig].key) +
                ' — ' + fmt(report.ignored[ig].you) + ' против медианы ' +
                fmt(report.ignored[ig].median);
        }
    }

    // Награды — вердикт самой игры, поэтому показываются так, как решила игра.
    var awardsBox = body('PMAwardRow');
    if (alive(awardsBox)) {
        if (report.awards.length) {
            for (var a = 0; a < report.awards.length; a++) {
                make('Label', awardsBox, '', 'PMAwardChip').text =
                    PM.Text.awardLabel(report.awards[a].key);
            }
        } else {
            make('Label', awardsBox, '', 'PMAwardChip none').text = T.awardNone;
        }
    }

    // ── советы: причина -> решение ─────────────────────────────────────────────
    var tips = PM.Text.advice(report, 4);
    var adviceBox = body('PMAdviceBody');
    if (alive(adviceBox)) {
        if (!tips.length) {
            var noneRow = make('Panel', adviceBox, '', 'PMAdviceRow');
            make('Label', noneRow, '', 'PMBreakdownLine').text =
                'Недостаточно данных, чтобы дать совет.';
        }
        for (var t = 0; t < tips.length; t++) {
            var card2 = make('Panel', adviceBox, 'PMAdviceCard ' + tips[t].level, '');
            var head = make('Panel', card2, '', 'PMAdviceHead');
            make('Label', head, 'PMAdviceName', '').text = tips[t].label;
            make('Label', head, 'PMAdvicePlace', '').text = tips[t].place;

            var causeRow = make('Panel', card2, '', 'PMAdviceLine');
            make('Label', causeRow, 'PMAdviceKey', '').text = 'Причина:';
            make('Label', causeRow, 'PMAdviceText', '').text = tips[t].cause;

            var fixRow = make('Panel', card2, '', 'PMAdviceLine fix');
            make('Label', fixRow, 'PMAdviceKey', '').text = 'Что делать:';
            make('Label', fixRow, 'PMAdviceText', '').text = tips[t].fix;
        }
    }

    // ── таблица статистики ─────────────────────────────────────────────────────
    var statBox = body('PMStatBody');
    if (alive(statBox)) {
        for (var s2 = 0; s2 < report.statLine.length; s2++) {
            var sm = report.statLine[s2];
            var sr = make('Panel', statBox, '', 'PMTableRow');
            if (sm.rank !== null && sm.of >= 8 && sm.rank > sm.of * 2 / 3) {
                sr.AddClass('warn');
            }
            make('Label', sr, '', 'PMCell name').text = sm.label;
            make('Label', sr, '', 'PMCell').text = fmt(sm.you);
            make('Label', sr, '', 'PMCell').text = fmt(sm.median);
            make('Label', sr, '', 'PMCell rank').text =
                (sm.rank === null ? T.notAvailable : (sm.rank + ' / ' + sm.of));
        }
    }

    // ── лобби по урону ─────────────────────────────────────────────────────────
    var lobbyBox = body('PMLobbyBody');
    if (alive(lobbyBox)) {
        var maxDmg = 1;
        for (var d = 0; d < report.lobby.length; d++) {
            var v = report.lobby[d].heroDamage;
            if (typeof v === 'number' && isFinite(v) && v > maxDmg) { maxDmg = v; }
        }
        for (var p = 0; p < report.lobby.length; p++) {
            var lp = report.lobby[p];
            var lr = make('Panel', lobbyBox, '', 'PMTableRow');
            if (lp.isLocal) { lr.AddClass('me'); }

            var nameCell = make('Panel', lr, '', 'PMLobbyName');
            if (lp.isLocal) {
                make('Label', nameCell, '', 'PMCell name').text = (lp.hero || '?') + '  ★';
            } else {
                make('Label', nameCell, '', 'PMCell name').text = lp.hero || '?';
            }

            make('Label', lr, '', 'PMCell kda').text =
                PM.Text.int(lp.kills) + '/' + PM.Text.int(lp.deaths) + '/' +
                PM.Text.int(lp.assists);
            make('Label', lr, '', 'PMCell').text = fmt(lp.souls);

            var barCell = make('Panel', lr, 'PMLobbyBarCell', '');
            var track = make('Panel', barCell, '', 'PMItemBarTrack');
            var fill = make('Panel', track, '', 'PMItemBarFill');
            fill.style.width = pctOf(lp.heroDamage, maxDmg) + '%';
            if (lp.isLocal) { fill.AddClass('me'); }
            make('Label', lr, '', 'PMCell dmg').text = fmt(lp.heroDamage);
        }
    }

    // ── сводка по командам ─────────────────────────────────────────────────────
    var mineBox = context.FindChildTraverse('PMTeamCellMine');
    var theirsBox = context.FindChildTraverse('PMTeamCellTheirs');
    var totals = [
        { label: T.rowKills, get: function (t) { return fmt(t.kills); } },
        { label: T.rowSouls, get: function (t) { return fmt(t.souls); } },
        { label: T.rowHeroDamage, get: function (t) { return fmt(t.heroDamage); } },
        { label: T.rowObjectiveDamage, get: function (t) { return fmt(t.objectiveDamage); } },
        { label: T.rowHealing, get: function (t) { return fmt(t.healing); } }
    ];
    for (var cc = 0; cc < totals.length; cc++) {
        var cellA = alive(mineBox) ? mineBox.Children()[cc] : null;
        var cellB = alive(theirsBox) ? theirsBox.Children()[cc] : null;
        if (!cellA || !cellB) { continue; }
        var kidsA = cellA.Children();
        var kidsB = cellB.Children();
        setLabelText(kidsA[0], totals[cc].label);
        setLabelText(kidsA[1], totals[cc].get(report.mine));
        setLabelText(kidsB[0], totals[cc].label);
        setLabelText(kidsB[1], totals[cc].get(report.theirs));
    }
}

// Helpers for the chart. num() treats an unreadable value as zero for the purpose of
// scaling only - it never reaches the screen, which shows "нет данных" via fmt().
function num(v) {
    return (typeof v === 'number' && isFinite(v)) ? v : 0;
}

function pctOf(v, scale) {
    if (typeof v !== 'number' || !isFinite(v) || !scale) { return 0; }
    var w = Math.round((v / scale) * 100);
    return (w < 0) ? 0 : ((w > 100) ? 100 : w);
}

// ── profile rendering ─────────────────────────────────────────────────────────────
function renderProfile(context, career, history) {
    var list = context.FindChildTraverse('PMStatBody');
    if (!alive(list)) { return; }

    var kids = list.Children();
    while (kids.length > 0) { $.RemoveChild(kids[0]); }

    var i;
    if (career.ok) {
        var head = make('Panel', list, '', 'PMTableRow');
        make('Label', head, '', 'PMCell name').text =
            'career: ' + career.gamesPlayed + ' games / ' + career.gamesWon + ' won' +
            (career.winRate !== null ? ' (' + career.winRate + '%)' : '');
        make('Label', head, '', 'PMCell').text =
            'LH ' + fmt(career.lastHits) + '  denies ' + fmt(career.denies);
    }

    if (!history.ok) {
        var none = make('Panel', list, '', 'PMTableRow');
        make('Label', none, '', 'PMCell name').text = T.statusNoHistory;
        return;
    }

    for (i = 0; i < history.blocks.length && i < 25; i++) {
        var block = history.blocks[i];
        var row = make('Panel', list, '', 'PMTableRow');
        var name = make('Label', row, '', 'PMCell name');
        name.text = (block.hero || '?') + '  ' + (block.outcome || '?') +
                    (block.duration ? '  ' + block.duration : '') +
                    (block.networth ? '  ' + block.networth : '');
        var pick = make('Label', row, '', 'PMCell');
        pick.text = 'open';
        // Hand off to the game: activating the block's own View Details navigates to the
        // post-game page for that match, where the other host renders the report.
        (function (blockPanel) {
            pick.SetPanelEvent('onactivate', function () {
                PM.Data.openMatchDetails(blockPanel);
            });
        })(block.panel);
    }
}

// ── diagnostics ───────────────────────────────────────────────────────────────────
function runDiagnostics() {
    var out = state.diagOutput;
    if (!alive(out)) { return; }
    setVisible(state.overlay, true);
    // The probe answers asynchronously, so clear the area and let it append.
    while (out.Children().length > 0) {
        $.RemoveChild(out.Children()[0]);
    }
    var head = make('Label', out, '', 'PMBreakdownLine');
    head.text = T.diagRunning;
    PM.Probe.run(function line(text) {
        var row = make('Panel', out, '', 'PMTableRow');
        make('Label', row, '', 'PMCell name').text = text;
    }, function done(summary) {
        var row = make('Panel', out, '', 'PMTableRow');
        make('Label', row, '', 'PMMetricLobby').text = summary;
    });
}

// ── global entry points, referenced from XML onactivate ────────────────────────────
globalThis.PMOpenOverlay = function PMOpenOverlay() { openOverlay(); };
globalThis.PMCloseOverlay = function PMCloseOverlay() { closeOverlay(); };

// ESC handling. The post-game page's oncancel is repointed at this by our override of
// citadel_db_page_post_game_new.xml, so ESC closes the overlay first and only then
// leaves the page. Without that repoint the page would navigate away with the overlay
// still up.
globalThis.PMOnCancel = function PMOnCancel() {
    if (state.opened) {
        closeOverlay();
        return;
    }
    if (typeof CitadelNavigateBack === 'function') {
        CitadelNavigateBack();
    }
};

// Wrapped so ANY failure still produces a [PM] line. Measured lesson from build 1: an
// exception at the compatibility check produced NO [PM] output at all, so the only
// evidence was a bare "Skipping rest of script" with no hint which module died. Every
// exit below logs first.
function boot() {
    var context = $.GetContextPanel();
    state.context = context;
    $.Msg('[PM] boot context=' + (context ? context.id : 'null') +
          ' type=' + (context ? context.paneltype : 'null'));

    var host = detectHost(context);
    if (!host) {
        // Not one of our hosts. Staying inert is correct here: our XML was not loaded.
        $.Msg('[PM] loaded in an unexpected context; staying inert');
        return;
    }
    state.host = host;

    // Compatibility is REPORTED, not enforced. If a future patch renames a vanilla
    // child, the mod still opens and says which one is missing, instead of the button
    // disappearing and the user concluding the install failed.
    if (PM.Compat) {
        var verdict = PM.Compat.check(context, HOST_SPEC[host] || host);
        state.compat = verdict;
        $.Msg('[PM] ' + PM.Compat.describe(verdict));
        if (!verdict.ok) {
            note('this game build is missing some vanilla panels the layout expects: ' +
                 verdict.missing.join(', '));
        }
    } else {
        note('pm_compat.js did not register');
    }
    if (!PM.Data) { note('pm_data.js did not register'); }

    var buttonId = host === 'post_game' ? 'PM_PostGameButton' : 'PM_ProfileButton';
    var button = (PM.Compat && PM.Compat.childById)
        ? PM.Compat.childById(context, buttonId) : null;
    if (!alive(button)) {
        note('entry button #' + buttonId + ' is not in the layout copy this build loaded');
    }
    state.button = button;

    // Build the overlay immediately. Its own construction is the only hard gate: with no
    // overlay there is nothing to click into.
    try {
        state.overlay = buildOverlay(context);
    } catch (err) {
        note('overlay construction threw: ' + (err && err.message ? err.message : err));
        state.overlay = null;
    }
    if (!state.overlay) {
        $.Msg('[PM] no overlay; the entry button cannot work');
        return;
    }

    // Measure one frame later: a DashboardPage root has no size when its layout script
    // runs, and a 0x0 measurement is what left build 2's overlay invisible.
    $.Schedule(0.1, function settle() {
        if (!alive(context)) { return; }
        // Only warn if the page is STILL too small. A DashboardPage commonly measures 0
        // for a frame or two while its layout resolves; warning on that transient left a
        // permanent "WHAT WENT WRONG" entry on an otherwise perfect build.
        if (!overlayHasRoom(context) && state.geom.w >= 0 && state.geom.h >= 0 &&
            !resolveSize(context)) {
            note('no ancestor of this page reports a usable size, so the report may be clipped');
        }
        applyGeometry(state.overlay);
        if (state.problems.length) {
            renderProblems(context);
        }
        // Always reveal. Never hide.
        setVisible(button, true);
        $.Msg('[PM] ready: host=' + host +
              ' data=' + (PM.Data ? 'ok' : 'MISSING') +
              ' probe=' + (PM.Probe ? 'loaded' : 'off') +
              ' problems=' + state.problems.length);
    });
}

// Show every collected problem in the overlay, so a broken build says why instead of
// just not appearing.
// The problem list is the fail-open mechanism: if the mod cannot read the match, it
// says so here instead of silently showing an empty report. It therefore has to be
// VISIBLE WHILE EMPTY during development - a build that silently showed nothing for
// five runs is exactly how a whole module died unnoticed - so the header is always
// shown, and it reads how many problems were recorded.
function renderProblems(context) {
    var box = context.FindChildTraverse('PMProblemsBody');
    if (!alive(box)) { return; }
    clearChildren(box);

    var header = context.FindChildTraverse('PMProblemsHeader');
    if (alive(header)) {
        header.text = state.problems.length
            ? T.wrongHeader + ' (' + state.problems.length + ')'
            : T.wrongNone;
    }

    for (var i = 0; i < state.problems.length; i++) {
        var row = make('Panel', box, '', 'PMProblemRow');
        make('Label', row, '', 'PMBreakdownLine').text = state.problems[i];
    }
}

$.Msg('[PM] core loaded, compat=' + (PM.Compat ? 'ok' : 'MISSING') +
      ' data=' + (PM.Data ? 'ok' : 'MISSING') +
      ' net=' + (PM.Net ? 'ok' : 'MISSING') +
      ' probe=' + (PM.Probe ? 'ok' : 'MISSING'));
boot();

})();