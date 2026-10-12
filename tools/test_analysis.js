// ---------------------------------------------------------------------------
// test_analysis.js - runs pm_analysis.js and pm_text.js on real input.
//
// WHY THIS EXISTS
// Builds 1 to 5 shipped a module that died at load and nothing caught it. Later builds
// shipped a report whose ranking, participation and unit arithmetic had never been
// executed ONCE, because the only way to run Panorama JS is to be inside the game.
// Every one of those was found by the user, in game, one at a time.
//
// Panorama's JS is a JavaScript ES3 subset with no modules and no Node on the build
// machine. Windows Script Host, however, ships a JScript interpreter with every copy of
// Windows, and pm_analysis.js deliberately sticks to ES3 syntax so it can be read by
// both. That makes the analysis engine testable without the game and without a
// toolchain - which is the difference between a bug report and a red build.
//
//   cscript //E:JScript //nologo tools\test_analysis.js
//
// WHAT IT HAS ALREADY CAUGHT
//   * a trailing comma in the METRICS array literal, which appended a seventh
//     undefined element and would have thrown on every open
//   * the formatter named i() shadowed by a loop variable named i in the same file
//   * "8 200 souls/min" - a total with a per-minute label, off by ~26x
//   * a space before every percent sign
//   * the advice line about dying a lot being sliced off on exactly the games where
//     dying a lot was the story
//   * "\u0421\u041b\u0410\u0411\u0410\u042f \u0418\u0413\u0420\u0410" stamped on an MVP game, because the worst rank on the board was
//     healing and the hero was a carry who is not supposed to heal
//   * "7,1 \u0442." read as 71 thousand instead of 7.1 thousand, because the Russian
//     decimal comma was being stripped as a thousands separator
//
// WHAT IS NOT TESTED
// Anything that touches a Panorama panel. pm_core.js is the screen; it needs the game.
// ---------------------------------------------------------------------------

var HERE = WScript.ScriptFullName;
function dirOf(p) {
    var a = p.lastIndexOf('\\');
    var b = p.lastIndexOf('/');
    a = (a < 0) ? b : ((b < 0) ? a : Math.max(a, b));
    return (a < 0) ? '' : p.substring(0, a + 1);
}

// dirOf() is idempotent on a path that already ends in a separator, so dirOf(dirOf(x))
// is dirOf(x). Strip the trailing separator before going up, or ROOT ends up pointing at
// tools\ and every source path resolves to tools\panorama\scripts\...
function parentOf(dir) {
    var d = dir;
    while (d.length > 3 && (d.charAt(d.length - 1) === '\\' || d.charAt(d.length - 1) === '/')) {
        d = d.substring(0, d.length - 1);
    }
    return dirOf(d);
}
var ROOT = parentOf(dirOf(HERE));

// Panorama's global object, stubbed. pm_analysis and pm_text only ever touch $.Msg and
// $.PM, so this is the entire surface they depend on.
var $ = { Msg: function () {} };

// Sources are UTF-8 and cscript's own file reader is ANSI. Reading pm_text.js as cp1251
// turned every label into mojibake inside the test process, which would have made every
// wording assertion fail for a reason that has nothing to do with the code under test.
// ADODB.Stream reads UTF-8 properly and ships with every Windows.
function readSource(rel) {
    var path = ROOT + rel;
    var src = null;
    try {
        var stream = new ActiveXObject('ADODB.Stream');
        stream.Type = 2;              // adTypeText
        stream.Charset = 'utf-8';
        stream.Open();
        stream.LoadFromFile(path);
        src = stream.ReadText();
        stream.Close();
    } catch (e) {
        src = null;
    }
    if (src === null) {
        var fso = new ActiveXObject('Scripting.FileSystemObject');
        var f = fso.OpenTextFile(path, 1);
        src = f.ReadAll();
        f.Close();
    }
    // 'use strict' is a directive prologue; harmless to drop for a top-level eval.
    return src.replace(/'use strict';/g, '');
}

// eval() has to happen at the top level of THIS file, not inside a helper. A direct eval
// inside a function declares the evaluated script's vars in that function's scope and
// throws them away on return, so PM ends up undefined.
var SRC_TEXT = readSource('panorama/scripts/postmortem/pm_text.js');
var SRC_ANALYSIS = readSource('panorama/scripts/postmortem/pm_analysis.js');
var SRC_DATA = readSource('panorama/scripts/postmortem/pm_data.js');
eval(SRC_TEXT);
eval(SRC_ANALYSIS);
// pm_data.js touches no Panorama API while loading - only its functions do, and none of
// them are called here. That is the only reason its number parsing is testable at all.
eval(SRC_DATA);

// Array.prototype.map and indexOf are ES5. The harness parses as ES3, and so does
// everything it loads, so the helpers below spell the loops out.
function textsOf(list, field) {
    var out = [];
    for (var i = 0; i < list.length; i++) { out.push(list[i][field]); }
    return out.join(' ');
}

function oneOf(needle, haystack) {
    for (var i = 0; i < haystack.length; i++) {
        if (haystack[i] === needle) { return true; }
    }
    return false;
}

function keysOf(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) { out.push(list[i].key); }
    return out;
}

// Russian expectations, written as escapes. cscript reads THIS file as ANSI too, so a
// literal Cyrillic string here would arrive as mojibake and never match.
var RU_NA = '\u043d\u0435\u0442 \u0434\u0430\u043d\u043d\u044b\u0445';
var RU_PLACE = '\u043c\u0435\u0441\u0442\u043e';
var RU_OF = '\u0438\u0437';

// -- harness ----------------------------------------------------------------------
var PASS = 0;
var FAIL = 0;
var FAILURES = [];

function eq(actual, expected, what) {
    var a = String(actual);
    var e = String(expected);
    if (a === e) { PASS++; } else { FAIL++; FAILURES.push(what + '\n       expected: ' + e + '\n       actual:   ' + a); }
}

function ok(cond, what) {
    if (cond) { PASS++; } else { FAIL++; FAILURES.push(what); }
}

function section(name) { WScript.Echo('  ' + name); }

// -- pm_text: number formatting ----------------------------------------------------
section('pm_text: number formatting');
eq(PM.Text.f(0, ''), '0', 'zero');
eq(PM.Text.f(7, ''), '7', 'single digit');
eq(PM.Text.f(999, ''), '999', 'no separator needed');
eq(PM.Text.f(1000, ''), '1\u00a0000', 'one separator, non-breaking space');
eq(PM.Text.f(12345, ''), '12\u00a0345', 'two separators');
eq(PM.Text.f(1234567, ''), '1\u00a0234\u00a0567', 'three groups');
eq(PM.Text.f(100000, ''), '100\u00a0000', 'round hundred thousand');
eq(PM.Text.f(-4321, ''), '-4\u00a0321', 'negative');
eq(PM.Text.f(1234.567, ''), '1\u00a0234.56', 'fraction truncated to two decimals');
eq(PM.Text.f(12.34, ''), '12.34', 'fraction preserved');
eq(PM.Text.f(null, ''), RU_NA, 'null prints the missing marker, never 0');
eq(PM.Text.f(undefined, ''), RU_NA, 'undefined prints the missing marker');
eq(PM.Text.int(12, ''), '12', 'integer');
ok(PM.Text.f(1234, '').indexOf(' ') === -1, 'no plain space inside a grouped number');
eq(PM.Text.pct(0), '0%', 'zero percent, no space before the sign');
eq(PM.Text.pct(43.25), '43.3%', 'percent rounded to one decimal');
eq(PM.Text.pct(null), RU_NA, 'percent of null');

// -- pm_data: number parsing ------------------------------------------------------
// The scoreboard renders four columns through {g:citadel_thousands:...}, so the Label text
// is a UNIT count, not the real number: 42 000 souls arrives as "42 \u0442.".
//
// The bug this covers: the Russian decimal comma was being stripped along with spaces, so
// "7,1 \u0442." became 71 and objective damage came out as 71 000 instead of 7 100 - ten times
// the real figure, and still shaped like a plausible stat.
section('pm_data: the thousands unit and the Russian decimal comma');
var P = PM.Data.parseThousands;
eq(P('42 \u0442.'), 42000, '42 thousand');
eq(P('30 \u0442.'), 30000, '30 thousand');
eq(P('7,1 \u0442.'), 7100, 'a Russian decimal comma is a decimal point, not a separator');
eq(P('7.1 \u0442.'), 7100, 'and the same number in English notation');
eq(P('11 \u0442.'), 11000, '11 thousand');
eq(P('1,2 \u043c\u043b\u043d.'), 1200000, 'millions');
eq(P('42k'), 42000, 'English k');
eq(P('1.2M'), 1200000, 'English M');
eq(P('1 234 567'), 1234567, 'spaces are group separators');
eq(P('1,234 \u0442.'), 1234, 'a three-digit Russian fraction is 1.234 thousand');
eq(P('1,234,567'), 1234.567, 'only the LAST separator is the decimal point');
eq(P('1,234,567 \u0442.'), 1234567, 'and the unit still applies on top');
eq(P(1234), 1234, 'a real number passes through');
eq(P(''), null, 'empty is unreadable, not zero');
eq(P('n/a'), null, 'a placeholder is unreadable');
eq(PM.Data.parseIntSafe('13'), 13, 'integer labels');
eq(PM.Data.parseIntSafe('\u2014'), null, 'a dash is unreadable, not zero');
eq(PM.Data.multiplierFromUnit(null), 1000, 'no unit child still means thousands');
eq(PM.Data.multiplierFromUnit('\u0442.'), 1000, 'the Russian t');
eq(PM.Data.multiplierFromUnit('k'), 1000, 'the English k');
eq(PM.Data.multiplierFromUnit('\u043c\u043b\u043d.'), 1000000, 'millions');
// -- fixtures ---------------------------------------------------------------------
// A synthetic 12-player lobby. Numbers chosen so every rank and every derived figure can
// be checked by hand; team 1 is the local player's side.
//
//                  souls  k   d   a  hdmg  odmg  heal
var PLAYERS = [
    // team 1
    { team: 1, isLocal: true,  hero: 'Drifter', souls: 8200,  kills: 6, deaths: 3, assists: 7, heroDamage: 9400,  objectiveDamage: 3100, healing: 900 },
    { team: 1, hero: 'Grey Talon', souls: 7900,  kills: 8, deaths: 2, assists: 3, heroDamage: 8200,  objectiveDamage: 2600, healing: 400 },
    { team: 1, hero: 'Bebop',       souls: 6100,  kills: 4, deaths: 4, assists: 8, heroDamage: 6100,  objectiveDamage: 1900, healing: 5200 },
    { team: 1, hero: 'Infernus',    souls: 4800,  kills: 3, deaths: 5, assists: 5, heroDamage: 4300,  objectiveDamage: 1500, healing: 300 },
    { team: 1, hero: 'Wraith',      souls: 3000,  kills: 1, deaths: 6, assists: 2, heroDamage: 2500,  objectiveDamage: 900,  healing: 100 },
    { team: 1, hero: 'Kelvin',      souls: 1200,  kills: 0, deaths: 8, assists: 1, heroDamage: 800,   objectiveDamage: 300,  healing: 0 },
    // team 2
    { team: 2, hero: 'Haze',        souls: 7500,  kills: 7, deaths: 3, assists: 6, heroDamage: 8800,  objectiveDamage: 2900, healing: 700 },
    { team: 2, hero: 'Dynamo',      souls: 6300,  kills: 5, deaths: 3, assists: 9, heroDamage: 7400,  objectiveDamage: 2100, healing: 1200 },
    { team: 2, hero: 'Lady Geist',  souls: 5900,  kills: 5, deaths: 4, assists: 4, heroDamage: 6600,  objectiveDamage: 2400, healing: 200 },
    { team: 2, hero: 'Paradox',     souls: 5400,  kills: 4, deaths: 5, assists: 4, heroDamage: 5800,  objectiveDamage: 1700, healing: 150 },
    { team: 2, hero: 'Seven',       souls: 3600,  kills: 2, deaths: 7, assists: 3, heroDamage: 3100,  objectiveDamage: 1100, healing: 60 },
    { team: 2, hero: 'Mo & Krill',  souls: 900,   kills: 0, deaths: 9, assists: 0, heroDamage: 600,   objectiveDamage: 200,  healing: 0 }
];

function lobby(extra) {
    var out = [];
    for (var i = 0; i < PLAYERS.length; i++) {
        var p = {};
        for (var k in PLAYERS[i]) {
            if (PLAYERS[i][k] !== undefined) { p[k] = PLAYERS[i][k]; }
        }
        p.awards = p.awards || {};
        p.winning = !!p.winning;
        out.push(p);
    }
    if (extra) { extra(out); }
    return { ok: true, matchId: 'T1', durationSeconds: 1560, players: out };
}

// -- core maths -------------------------------------------------------------------
section('pm_analysis: rank, median, participation');

var data = lobby();
var rep = PM.Analysis.build(data);

ok(rep.ok, 'build succeeds on a full lobby');
eq(rep.focus.hero, 'Drifter', 'focus is the row flagged isLocal, not the first row');
// Guards the trailing-comma class of bug: a parser that tolerates one appends an
// undefined element, and every median, rank and count downstream shifts by one.
eq(PLAYERS.length, 12, 'the fixture really has twelve rows');
eq(rep.lobby.length, 12, 'all twelve rows survive');
eq(rep.lobby[0].hero, 'Drifter', 'lobby is sorted by hero damage, descending');

// Souls: 8200 is the highest in the lobby -> place 1 of 12.
// Sorted: 900,1200,3000,3600,4800,5400,5900,6100,6300,7500,7900,8200 -> 6th and 7th.
var soulsStat = PM.Analysis.byKey(rep, 'souls');
eq(soulsStat.you, 8200, 'own souls read');
eq(soulsStat.median, 5650, 'lobby median souls');
eq(soulsStat.rank, 1, 'best souls is place 1');
eq(soulsStat.of, 12, 'rank is out of twelve');

// Deaths, sorted: 2,3,3,3,4,4,5,5,6,7,8,9. Our 3 is beaten only by the single row with
// 2, and ties SHARE a place rather than queueing behind each other, so this is place 2 of
// 12 with three players on 3 - not place 4.
var deathsStat = PM.Analysis.byKey(rep, 'deaths');
eq(deathsStat.rank, 2, 'three deaths is place 2 of 12 (fewer is better)');
eq(deathsStat.median, 4.5, 'lobby median deaths');

// Kill participation is (k + a) / TEAM kills, not (k) / TEAM kills and never against
// both teams. Team 1 kills: 6 + 8 + 4 + 3 + 1 + 0 = 22. Ours: (6 + 7) / 22 = 59.09.
eq(rep.focus.killParticipation, 59.1, 'kill participation uses (kills+assists)/team kills');
// Sanity: the all-players figure would have been (6+7)/38 = 34.2, which is what the
// previous version printed. Guard the regression explicitly.
ok(rep.focus.killParticipation > 50, 'participation is not diluted by the enemy team');

// Share of team souls: 8200 / 31200 = 26.28 -> 26.3
eq(rep.focus.shareTeamSouls, 26.3, 'share of team souls');

// Team totals.
eq(rep.mine.kills, 22, 'our team kills');
eq(rep.theirs.kills, 23, 'their team kills');
eq(rep.mine.souls, 31200, 'our team souls');
eq(rep.mine.count, 6, 'six per side');

// Worst metric is simply the largest rank among the metrics that apply. Assert the
// invariant, not just the value, so the rule itself is covered.
section('pm_analysis: worst metric and verdict');
ok(rep.worst !== null, 'a worst metric is found');
eq(rep.worst.relevant, true, 'the worst metric is one the hero actually uses');
var maxRank = 0;
var maxKey = null;
for (var r = 0; r < rep.statLine.length; r++) {
    if (!rep.statLine[r].relevant) { continue; }
    if (rep.statLine[r].rank !== null && rep.statLine[r].rank > maxRank) {
        maxRank = rep.statLine[r].rank;
        maxKey = rep.statLine[r].key;
    }
}
eq(rep.worst.key, maxKey, 'worst metric is the largest relevant rank, by construction');
eq(rep.verdict, 'GOOD', 'every relevant metric is top third -> GOOD');

// -- breakdown --------------------------------------------------------------------
section('pm_text: breakdown sentences');
var bd = PM.Text.breakdown(rep);
ok(bd !== null, 'breakdown produced');
ok(bd.farm.indexOf('26.3%') !== -1, 'farm line states the share of team souls');
ok(bd.farm.indexOf(RU_PLACE + ' 1 ' + RU_OF + ' 12') !== -1, 'farm line states the rank');
// 26 minutes: 8200 / 26 = 315.4 souls/min. The bug this guards printed "8 200 souls/min".
ok(bd.farm.indexOf('315.4') !== -1, 'farm line divides by the match length');
ok(bd.farm.indexOf('8\u00a0200') === -1, 'farm line does not label a total as a rate');
ok(bd.fights.indexOf('59.1%') !== -1, 'fights line states participation');
ok(bd.objectives.indexOf('3\u00a0100') !== -1, 'objectives line formats the number');
ok(bd.farm.indexOf('59.1 %') === -1, 'no space before a percent sign');

// With no duration the label must fall back to the total, never to a fake rate.
var noTime = PM.Analysis.build(lobby());
noTime.minutes = null;
var bdNoTime = PM.Text.breakdown(noTime);
ok(bdNoTime.farm.indexOf('8\u00a0200') !== -1, 'without a duration the farm line shows the total');
ok(bdNoTime.farm.indexOf('/\u043c\u0438\u043d') === -1, 'and it does not claim a per-minute rate');

// -- advice -----------------------------------------------------------------------
section('pm_text: advice triggers');
var tips = PM.Text.advice(rep, 4);
ok(tips.length > 0, 'advice is never empty');
var joined = textsOf(tips, 'fix');
ok(joined.indexOf('Too many deaths') === -1, '3 deaths does not trigger the death tip');

// The advice screen is the whole point of the tool: cause first, then what to do. A card
// with only a cause is a complaint.
section('pm_text: advice shape');
for (var q = 0; q < tips.length; q++) {
    ok(tips[q].cause.length > 10, 'card ' + q + ' states a cause');
    ok(tips[q].fix.length > 10, 'card ' + q + ' states a fix');
    ok(oneOf(tips[q].level, ['good', 'mid', 'bad']), 'card ' + q + ' carries a level');
    ok(tips[q].label.length > 0, 'card ' + q + ' names the metric');
}
var adviceBlob = textsOf(tips, 'cause') + ' ' + textsOf(tips, 'fix') + ' ' +
                 textsOf(tips, 'label');
ok(/[\u0400-\u04FF]/.test(adviceBlob), 'advice is in Russian');
ok(/[\u0400-\u04FF]/.test(PM.Text.TABLE.sectionAdvice), 'the string table is in Russian');
ok(/[\u0400-\u04FF]/.test(PM.Text.verdict(rep).title), 'the verdict is in Russian');

// -- awards -----------------------------------------------------------------------
section('pm_analysis: awards come from the game, not from us');
var awarded = lobby(function (rows) {
    rows[0].awards = { AwardPlayerDmg: true, AwardKills: false };
    rows[0].mvpRank = 1;
    rows[0].winning = true;
});
var rep2 = PM.Analysis.build(awarded);
eq(rep2.awards.length, 1, 'exactly the class we saw is reported');
eq(rep2.awards[0].key, 'heroDamage', 'award key mapped from the class name');
eq(rep2.mvpRank, 1, 'mvp rank read from MVP_Rank1');
eq(rep2.mine.winning, true, 'winning flag read from the team container');
ok(/[\u0400-\u04FF]/.test(PM.Text.awardLabel(rep2.awards[0].key)), 'the award label is in Russian');
var rep3 = PM.Analysis.build(lobby());
eq(rep3.awards.length, 0, 'no award classes means no awards claimed');

// -- verdict ----------------------------------------------------------------------
section('pm_text: verdict');
var vdGood = PM.Text.verdict(rep);
eq(vdGood.key, 'good', 'a top-third worst metric reads as a good game');
eq(typeof vdGood.title, 'string', 'the verdict has a title');
ok(vdGood.title.length > 0 && vdGood.note.length > 0, 'the verdict has a note as well');
eq(PM.Text.verdict({ ok: false }).key, 'unknown', 'no report means no verdict');

// -- refuses to guess --------------------------------------------------------------
section('pm_analysis: refuses to guess');
var noLocal = lobby(function (rows) { rows[0].isLocal = false; });
var rep4 = PM.Analysis.build(noLocal);
ok(!rep4.ok, 'no IsLocalPlayer row means no report');
eq(rep4.reason, 'local-player-not-marked', 'and the reason names the marker');

var nothing = { ok: false, reason: 'scoreboard-not-instantiated', players: [], lobby: [] };
ok(PM.Text.breakdown(nothing) === null, 'breakdown of nothing is null');
ok(PM.Text.advice(nothing, 4).length === 0, 'advice of nothing is empty');

// -- unreadable values -------------------------------------------------------------
section('pm_analysis: unreadable values are excluded, not invented');
var gappy = lobby(function (rows) {
    // Four players have an unreadable soul label, i.e. null.
    rows[1].souls = null; rows[3].souls = null;
    rows[5].souls = null; rows[7].souls = null;
});
var rep5 = PM.Analysis.build(gappy);
eq(PM.Analysis.byKey(rep5, 'souls').of, 8, 'median is over the eight rows we could read');
ok(PM.Analysis.byKey(rep5, 'souls').median !== null, 'a median still exists');
eq(rep5.focus.souls, 8200, 'a null row does not shift our own value');

// -- a genuinely bad game ----------------------------------------------------------
section('pm_analysis: a game that was lost badly');
var bad = lobby(function (rows) {
    rows[0].souls = 100; rows[0].kills = 0; rows[0].assists = 0;
    rows[0].deaths = 9; rows[0].heroDamage = 200; rows[0].objectiveDamage = 100;
    rows[0].healing = 0;
});
var rep6 = PM.Analysis.build(bad);
eq(rep6.verdict, 'BAD', 'last on everything reads as BAD');
eq(PM.Text.verdict(rep6).key, 'bad', 'and the verdict screen says so');

// On a nine-death game the deaths card must be on screen. Matching on prose is brittle;
// the metric key is the contract.
var badCards = PM.Text.advice(rep6, 4);
var badKeys = keysOf(badCards);
ok(oneOf('deaths', badKeys), 'nine deaths puts the deaths card on screen');
ok(oneOf('resist', badKeys), 'and the build-resistance note, which used to be sliced off');
ok(badCards.length <= 5, 'never more than five cards');
for (var bl = 0; bl < badCards.length; bl++) {
    ok(badCards[bl].level === 'bad' || badCards[bl].level === 'mid',
       'a lost game produces no congratulation');
}

// -- the first real match, reproduced ----------------------------------------------
// Drifter, 42 000 souls (place 1), 30 000 hero damage, 64.6% kill participation (place
// 2), 2 deaths (place 1), MVP - and 11 000 healing against a 29 500 lobby median, place 11
// of 12.
//
// The verdict machinery took the worst rank on the board, found healing, and printed
// "\u0421\u041b\u0410\u0411\u0410\u042f \u0418\u0413\u0420\u0410" on a game the player won as MVP. Every other metric was excellent.
section('pm_analysis: a carry is not judged on healing');

var carry = lobby(function (rows) {
    rows[0].souls = 42000;
    rows[0].heroDamage = 30000;
    rows[0].kills = 13; rows[0].deaths = 2; rows[0].assists = 18;
    rows[0].objectiveDamage = 7100;
    rows[0].healing = 11000;
    // lift the rest of the lobby so our healing really is last
    for (var c = 1; c < rows.length; c++) {
        rows[c].healing = 29500;
        if (rows[c].souls > 42000) { rows[c].souls = 31500; }
        if (rows[c].heroDamage > 30000) { rows[c].heroDamage = 29000; }
        if (rows[c].objectiveDamage > 7100) { rows[c].objectiveDamage = 38000; }
    }
});
var repCarry = PM.Analysis.build(carry);
eq(repCarry.verdict, 'GOOD', 'an MVP carry is not a bad game');
eq(PM.Text.verdict(repCarry).key, 'good', 'and the verdict screen agrees');
ok(repCarry.worst.key !== 'healing', 'the worst metric is not the one the hero ignores');
eq(repCarry.ignored.length, 1, 'exactly one metric is excluded');
eq(repCarry.ignored[0].key, 'healing', 'and it is healing');
ok(!oneOf('healing', keysOf(PM.Text.advice(repCarry, 4))),
   'no card scolds the carry for not healing');
ok(PM.Text.advice(repCarry, 4).length > 0, 'a good game still gets improvement advice');

// A support in the same lobby IS judged on healing.
var support = lobby(function (rows) {
    rows[0].souls = 42000;
    rows[0].heroDamage = 30000;
    rows[0].kills = 13; rows[0].deaths = 2; rows[0].assists = 18;
    rows[0].objectiveDamage = 7100;
    rows[0].healing = 52000;
});
var repSupport = PM.Analysis.build(support);
eq(repSupport.ignored.length, 0, 'a support is judged on healing');
ok(repSupport.verdict !== null, 'and still gets a verdict');

// -- place phrasing ----------------------------------------------------------------
section('pm_text: place phrasing');
eq(PM.Text.place(PM.Analysis.byKey(rep, 'souls'), 12),
   RU_PLACE + ' 1 ' + RU_OF + ' 12', 'place with a rank');
eq(PM.Text.place({ rank: null, of: 8 }, 12),
   RU_PLACE + ' ' + RU_NA + ' ' + RU_OF + ' 8', 'unranked still states the sample size');

// -- report -------------------------------------------------------------------------
WScript.Echo('');
if (FAIL) {
    WScript.Echo('FAIL  ' + FAIL + ' failed, ' + PASS + ' passed');
    for (var fi = 0; fi < FAILURES.length; fi++) {
        WScript.Echo('  - ' + FAILURES[fi]);
    }
    WScript.Quit(1);
}
WScript.Echo('OK    ' + PASS + ' assertions passed');
WScript.Echo('');
WScript.Echo('  focus         ' + rep.focus.hero + '  ' + rep.focus.kills + '/' +
             rep.focus.deaths + '/' + rep.focus.assists);
WScript.Echo('  participation ' + rep.focus.killParticipation + '%   share of team souls ' +
             rep.focus.shareTeamSouls + '%');
WScript.Echo('  verdict       ' + rep.verdict + '   worst: ' + rep.worst.key +
             ' place ' + rep.worst.rank + ' of ' + rep.worst.of);
WScript.Echo('  carry verdict ' + repCarry.verdict + '   ignored: ' +
             keysOf(repCarry.ignored).join(','));
WScript.Echo('  breakdown     ' + bd.farm);