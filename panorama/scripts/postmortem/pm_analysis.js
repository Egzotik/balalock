'use strict';

// ─────────────────────────────────────────────────────────────────────────────────
// pm_analysis.js — the post-match engine.
//
// This is a direct port of the analysis in the desktop app's ui/app.js. That file is the
// source of truth for the numbers and it was validated against a large match sample;
// re-deriving the formulas here would only create a second, drifting definition.
//
// The only structural difference from the app is the input. The app fetched match data
// over HTTP from api.deadlock-api.com and got exact integers. Here the rows come out of
// the game's own scoreboard, where three of the six fields arrive FORMATTED ("12.3k")
// and are therefore approximate to about +/-100. That is fine for a lobby median and a
// rank, and the code below never pretends otherwise: a value it could not read becomes
// null, is left out of the distribution, and the sample size is reported next to the
// rank so a thin distribution is visible instead of looking authoritative.
//
// Nothing in here touches the DOM. It takes the plain object pm_data.js produces and
// returns a plain object, which is why it can be reasoned about without the game.
// ─────────────────────────────────────────────────────────────────────────────────

var PM = ($.PM = $.PM || {});

// Metric definitions, higher-is-better first. The order is the order they are shown in.
var METRICS = [
    { key: 'souls', label: 'souls', higher: true },
    { key: 'heroDamage', label: 'hero damage', higher: true },
    { key: 'killParticipation', label: 'kill participation', higher: true },
    { key: 'objectiveDamage', label: 'objective damage', higher: true },
    { key: 'healing', label: 'healing', higher: true },
    { key: 'deaths', label: 'deaths', higher: false }
];

function isNum(v) {
    return v !== null && v !== undefined && typeof v === 'number' && isFinite(v);
}

// Values we could actually read, for one metric, across the whole lobby.
function column(players, key) {
    var out = [];
    for (var i = 0; i < players.length; i++) {
        if (isNum(players[i][key])) { out.push(players[i][key]); }
    }
    return out;
}

function median(values) {
    if (!values.length) { return null; }
    var s = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return (s.length % 2) ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// 1 = best. 'higher' false means fewer is better, which is what makes the deaths row
// read the right way round without special-casing it at the call site.
function rankOf(value, values, higher) {
    if (!isNum(value) || !values.length) { return null; }
    var rank = 1;
    for (var i = 0; i < values.length; i++) {
        if (higher ? values[i] > value : values[i] < value) { rank++; }
    }
    return rank;
}

function sumOf(players, key) {
    var total = 0;
    var any = false;
    for (var i = 0; i < players.length; i++) {
        if (isNum(players[i][key])) { total += players[i][key]; any = true; }
    }
    return any ? total : null;
}

function teamOf(players, team) {
    var out = [];
    for (var i = 0; i < players.length; i++) {
        if (players[i].team === team) { out.push(players[i]); }
    }
    return out;
}

// Per-player derived values. Kept as a separate pass so every metric downstream sees a
// consistent row: kill participation and share of souls are functions of the TEAM, not
// of the individual, so they cannot be computed inside the reader.
function enrich(players) {
    var t1 = sumOf(teamOf(players, 1), 'kills');
    var t2 = sumOf(teamOf(players, 2), 'kills');
    var s1 = sumOf(teamOf(players, 1), 'souls');
    var s2 = sumOf(teamOf(players, 2), 'souls');

    for (var i = 0; i < players.length; i++) {
        var p = players[i];
        var teamKills = (p.team === 2) ? t2 : t1;
        var teamSouls = (p.team === 2) ? s2 : s1;

        p.killParticipation = (isNum(p.kills) && isNum(p.assists) && teamKills > 0)
            ? Math.round(((p.kills + p.assists) / teamKills) * 1000) / 10
            : null;

        p.shareTeamSouls = (isNum(p.souls) && teamSouls > 0)
            ? Math.round((p.souls / teamSouls) * 1000) / 10
            : null;
    }
    return players;
}

function teamTotals(players, team) {
    var rows = teamOf(players, team);
    return {
        team: team,
        count: rows.length,
        kills: sumOf(rows, 'kills'),
        souls: sumOf(rows, 'souls'),
        heroDamage: sumOf(rows, 'heroDamage'),
        objectiveDamage: sumOf(rows, 'objectiveDamage'),
        healing: sumOf(rows, 'healing'),
        winning: rows.length ? !!rows[0].winning : false
    };
}

// The awards are not computed here. The scoreboard rows already carry the game's own
// classes for them - AwardKills, AwardPlayerDmg, AwardObjDmg, AwardHealing,
// AwardAssists, AwardSouls - set by the vanilla post-game code. Reading the game's
// verdict is strictly better than reimplementing its tie-breaking rules and getting a
// different answer whenever a tie exists.
// Keys only. pm_text.js owns the Russian label for each.
var AWARD_CLASSES = [
    { cls: 'AwardSouls', key: 'souls' },
    { cls: 'AwardKills', key: 'kills' },
    { cls: 'AwardAssists', key: 'assists' },
    { cls: 'AwardPlayerDmg', key: 'heroDamage' },
    { cls: 'AwardObjDmg', key: 'objectiveDamage' },
    { cls: 'AwardHealing', key: 'healing' }
];

function build(data) {
    var out = {
        ok: false,
        reason: data.reason || null,
        matchId: data.matchId,
        minutes: null,
        focus: null,
        otherTeam: null,
        statLine: [],
        worst: null,
        verdict: null,
        lobby: [],
        mine: null,
        theirs: null,
        awards: [],
        mvpRank: null
    };
    if (!data || !data.ok || !data.players || !data.players.length) { return out; }

    var players = enrich(data.players);
    var focus = null;
    for (var i = 0; i < players.length; i++) {
        if (players[i].isLocal) { focus = players[i]; break; }
    }
    if (!focus) {
        // Do not silently analyse a different player. Reporting a stranger's stats as
        // yours is worse than reporting none, and the reason is printed so the log says
        // which marker the game is using.
        out.reason = 'local-player-not-marked';
        return out;
    }

    var mine = teamTotals(players, focus.team);
    var otherTeam = (focus.team === 2) ? 1 : 2;
    var theirs = teamTotals(players, otherTeam);

    // Stat line: one entry per metric with the value, the lobby median and the rank.
    var n = players.length;
    var statLine = [];
    for (var m = 0; m < METRICS.length; m++) {
        var def = METRICS[m];
        var vals = column(players, def.key);
        statLine.push({
            key: def.key,
            label: def.label,
            higher: def.higher,
            you: focus[def.key],
            median: median(vals),
            rank: rankOf(focus[def.key], vals, def.higher),
            of: vals.length
        });
    }

    // Relevance first, then the worst metric - in that order.
    //
    // "Worst rank on the board" is only meaningful across metrics that describe your
    // play. Healing 11k against a 29.5k median on a carry is the hero doing its job, and
    // letting that number decide the verdict printed "СЛАБАЯ ИГРА" on an MVP game.
    var ignored = [];
    for (var ir = 0; ir < statLine.length; ir++) {
        statLine[ir].relevant = isRelevant(statLine[ir]);
        if (!statLine[ir].relevant) {
            ignored.push({
                key: statLine[ir].key,
                label: statLine[ir].label,
                you: statLine[ir].you,
                median: statLine[ir].median,
                rank: statLine[ir].rank
            });
        }
    }

    var worst = null;
    for (var s = 0; s < statLine.length; s++) {
        if (statLine[s].rank === null || !statLine[s].relevant) { continue; }
        if (!worst || statLine[s].rank > worst.rank) { worst = statLine[s]; }
    }

    // GOOD / MIXED / BAD, same thresholds as the desktop app: bottom third is BAD,
    // middle third is MIXED. Computed on ranks because a rank is comparable across
    // metrics whose units are not.
    var verdict = null;
    if (worst && worst.of) {
        var third = worst.of / 3;
        verdict = (worst.rank <= third) ? 'GOOD'
                : (worst.rank <= third * 2) ? 'MIXED' : 'BAD';
    }

    // Awards, straight from the vanilla classes.
    var awards = [];
    var mvpRank = null;
    for (var a = 0; a < AWARD_CLASSES.length; a++) {
        if (focus.awards && focus.awards[AWARD_CLASSES[a].cls]) {
            awards.push({ key: AWARD_CLASSES[a].key });
        }
    }
    if (focus.mvpRank !== null && focus.mvpRank !== undefined) { mvpRank = focus.mvpRank; }

    out.ok = true;
    out.focus = focus;
    out.minutes = isNum(data.durationSeconds) ? Math.round(data.durationSeconds / 60) : null;
    out.statLine = statLine;
    out.worst = worst;
    out.verdict = verdict;
    out.ignored = ignored;
    out.mine = mine;
    out.otherTeam = otherTeam;
    out.theirs = theirs;
    out.awards = awards;
    out.mvpRank = mvpRank;
    // Lobby sorted by hero damage, exactly as the desktop app shows it: it is the one
    // ordering where a glance tells you whether you contributed.
    out.lobby = players.slice().sort(function (x, y) {
        var xv = isNum(x.heroDamage) ? x.heroDamage : -1;
        var yv = isNum(y.heroDamage) ? y.heroDamage : -1;
        return yv - xv;
    });

    return out;
}

function byKey(report, key) {
    for (var i = 0; i < report.statLine.length; i++) {
        if (report.statLine[i].key === key) { return report.statLine[i]; }
    }
    return null;
}

// How good a metric was, as a key rather than a word. pm_text.js owns the Russian.
function levelOf(rank, of) {
    if (rank === null || rank === undefined || !of) { return 'unknown'; }
    var third = of / 3;
    if (rank <= third) { return 'good'; }
    if (rank <= third * 2) { return 'mid'; }
    return 'bad';
}

// How much each metric is worth when the screen only has room for a few.
//
// Deaths first: "you died nine times" is the one line a player can act on next match,
// while "your objective damage was place 4" is a statistic. Then souls, because a farm
// deficit explains most of the rest. Ordering by rank instead does not work - on a
// catastrophic game every metric is last, the ranks tie, and the sort degenerates to
// declaration order, which pushed the deaths card off the screen entirely.
var IMPORTANCE = ['deaths', 'souls', 'heroDamage', 'killParticipation',
                   'objectiveDamage', 'healing'];

function importanceOf(key) {
    for (var i = 0; i < IMPORTANCE.length; i++) {
        if (IMPORTANCE[i] === key) { return i; }
    }
    return IMPORTANCE.length;
}

// Metrics that always describe how well you played, whatever your hero does.
var ALWAYS = { souls: true, deaths: true, heroDamage: true, killParticipation: true };

// A metric you contribute almost nothing to says something about your ROLE, not about
// your play.
//
// The first real match made this concrete: Drifter, 42k souls (place 1), 30k hero damage,
// 64.6% kill participation, 2 deaths, MVP - and 11k healing against a 29.5k lobby median,
// place 11 of 12. The verdict machinery took the worst rank on the board, found healing,
// and stamped "СЛАБАЯ ИГРА" on a game the player won as MVP.
//
// Below half the lobby median is the line. A support sits far above it and is judged on
// healing; a carry sits far below it and is not judged on healing at all. Either way the
// screen says so out loud instead of quietly dropping the number.
var ROLE_RATIO = 0.5;

// A metric counts toward the verdict and the advice only if it is always relevant or the
// player is at least half way to the lobby median.
function isRelevant(m) {
    if (ALWAYS[m.key]) { return true; }
    if (m.you === null || m.you === undefined) { return false; }
    if (m.median === null || m.median === undefined || m.median <= 0) { return true; }
    return (m.you / m.median) >= ROLE_RATIO;
}

// Every metric, with its level attached. Ordered worst-first, then by importance.
function findings(report) {
    if (!report.ok) { return []; }
    var out = [];
    for (var i = 0; i < report.statLine.length; i++) {
        var m = report.statLine[i];
        out.push({
            key: m.key,
            label: m.label,
            level: levelOf(m.rank, m.of),
            rank: m.rank,
            of: m.of,
            you: m.you,
            median: m.median,
            relevant: isRelevant(m),
            weight: importanceOf(m.key)
        });
    }
    var severity = { bad: 0, mid: 1, unknown: 2, good: 3 };
    out.sort(function (a, b) {
        var d = severity[a.level] - severity[b.level];
        if (d !== 0) { return d; }
        return a.weight - b.weight;
    });
    return out;
}

// The metrics worth a card, and how many. Room on the screen is finite, and a list of
// eleven suggestions is a list nobody reads.
//
// One is reserved for the single most useful non-metric observation - dying a lot is a
// better lead than any rank, because it is actionable on the next match and a rank is
// not.
function shortlist(report, limit) {
    var all = findings(report);
    var out = [];
    for (var i = 0; i < all.length && out.length < (limit || 4); i++) {
        // "Mid" is the interesting band: the player is not failing, but there is a
        // visible gap to the median. Leading with the metrics they already win is
        // filler. A metric that does not apply to the hero earns no card either.
        if (!all[i].relevant) { continue; }
        if (all[i].level === 'bad' || all[i].level === 'mid') { out.push(all[i]); }
    }
    // Nothing is bad or average. Then the question the player asked is "played well, can
    // it be better", and the honest answer is the weakest metric - not the one that
    // happens to sort last.
    if (!out.length) {
        var weakest = null;
        for (var w = 0; w < all.length; w++) {
            if (all[w].rank === null || !all[w].relevant) { continue; }
            if (!weakest || all[w].rank > weakest.rank) { weakest = all[w]; }
        }
        if (weakest) { out.push(weakest); }
    }
    return out;
}

PM.Analysis = {
    build: build,
    findings: findings,
    shortlist: shortlist,
    levelOf: levelOf,
    byKey: byKey,
    METRICS: METRICS
};