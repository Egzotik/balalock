// pm_data.js — reads match data out of the game's own panels.
//
// WHY THIS FILE EXISTS
// The whole report can be built without a network request, because the game already
// loads everything it shows on two pages:
//
//   profile page  ({d:player_stats_state}, {d:match_history_state})
//     career totals: games_played, games_won, last_hits, denies, commend_count
//     per-hero rows in #HeroList
//     the player's own match blocks in #MatchHistoryArea
//
//   post-game page  (CitadelPostGameScoreboardNew inside the carousel)
//     the full stat line for the match currently open - and "View Details" on a past
//     match opens this same page for that match, verified in game on build 25763945
//     per player: net_worth, kills, deaths, assists, hero damage, objective damage,
//     healing, hero, match id, duration
//
// Two value shapes have to be handled, and mixing them up is the main trap here:
//
//   EXACT   KillsValue / DeathsValue / AssistsValue -> plain integers in a Label
//   LOSSY   SoulsValue / PlayerDmgValue / ObjDmgValue / HealingValue are bound as
//           {g:citadel_thousands:...} with html="true", so the Label holds a FORMATTED
//           string like "12.3k". Percentiles and medians computed from those are only
//           good to about a hundred, which is fine for a lobby rank and useless for
//           anything tighter.
//
// parseThousands() handles the formatted form and never returns NaN or null: an
// unparseable value becomes null, and every caller treats null as "unknown" rather than
// as zero. A wrong zero would silently invent a player who did nothing.
//
// Everything here is pure reading. No writes, no state that outlives a call.

'use strict';

var PM = ($.PM = $.PM || {});
if (PM.Data) { /* already initialised */ }
else {

var LOG = '[PM-DATA] ';

function dataLog(msg) { $.Msg(LOG + msg); }

function dataValid(panel) {
    return !!(panel && panel.IsValid());
}

function dataChildById(panel, id) {
    if (!dataValid(panel)) { return null; }
    var kids = panel.Children();
    if (!kids) { return null; }
    for (var i = 0; i < kids.length; i++) {
        if (kids[i].id === id) { return kids[i]; }
    }
    return null;
}

// FIND DEEP, not just among direct children.
//
// The vanilla post-game scoreboard nests its stat labels two levels down:
//   .Player > .PlayerRow > .StatsContainer.KDAContainer > #KillsValue
// so a direct-children lookup finds the row and then misses every value inside it.
// That is what made build 6 show "MATCH ... / 12 PLAYERS" with every stat at "-" and
// "team kills" of zero: the rows were found, the labels were not.
//
// FindChildTraverse is the right tool here. It is slower than a direct lookup, and on a
// 12-row scoreboard that does not matter.
function findDeep(panel, id) {
    if (!dataValid(panel)) { return null; }
    var found = panel.FindChildTraverse(id);
    return dataValid(found) ? found : null;
}

function labelText(panel, id) {
    var label = findDeep(panel, id);
    if (!dataValid(label)) { return null; }
    var text = label.text;
    return (typeof text === 'string' && text.length) ? text : null;
}

// Direct children only, for the places where nesting is not wanted: finding WHICH
// carousel screen we are on, and the scoreboard component itself.


function classesWithClass(panel, className) {
    if (!dataValid(panel)) { return []; }
    var out = [];
    var kids = panel.Children();
    for (var i = 0; kids && i < kids.length; i++) {
        if (kids[i].BHasClass(className)) { out.push(kids[i]); }
    }
    return out;
}

// ── formatted numbers ─────────────────────────────────────────────────────────────
// "12.3k" -> 12300, "1,234" -> 1234, "48.2k" -> 48200. Returns null when it cannot read
// the string at all, which is different from zero.
// ── parsing the scoreboard's formatted numbers ─────────────────────────────────────
//
// Four columns are bound to {g:citadel_thousands:...}, so the Label text is a UNIT count,
// not the real number: 42 000 souls arrives as "42 т.". Two things went wrong before this
// was written properly, and both produced numbers that looked plausible:
//
//   * the unit was dropped, so 42 000 souls was reported as 42 and a 31-minute match
//     became "1.4 souls/min";
//   * the Russian decimal comma was stripped along with the spaces, so "7,1 т." became 71
//     and objective damage came out as 71 000 instead of 7 100.
//
// The comma rule is locale-specific on purpose. Russian groups thousands with a space, so
// a comma here is ALWAYS a decimal point. That means "1,234" is 1.234 and not 1234 - and
// accepting a US-formatted "1,234,567" would mean guessing which convention produced the
// label, which is a guess that silently misreads real data.
function parseThousands(raw) {
    if (raw === null || raw === undefined) { return null; }
    if (typeof raw === 'number') { return isFinite(raw) ? raw : null; }

    var text = String(raw);
    // Group separators: every width of space, including the non-breaking ones.
    text = text.replace(/[\s  ]/g, '');

    // Unit words first, while the text is still readable.
    var mult = 1;
    if (/млн|mln|million/i.test(text)) {
        mult = 1e6;
        text = text.replace(/млн|mln|million/ig, '');
    } else if (/тыс|thou/i.test(text)) {
        mult = 1e3;
        text = text.replace(/тыс|thou/ig, '');
    }

    // Keep only what can carry a number, so a trailing "т." becomes a trailing "т".
    text = text.replace(/[^0-9A-Za-zА-Яа-я.,+-]/g, '');
    text = text.replace(/[.,]+$/, '');

    // Single-letter suffixes.
    var tail = text.charAt(text.length - 1);
    if (tail === 'k' || tail === 'K' || tail === 'т' || tail === 'Т') {
        mult = 1e3; text = text.slice(0, -1);
    } else if (tail === 'm' || tail === 'M' || tail === 'м' || tail === 'М') {
        mult = 1e6; text = text.slice(0, -1);
    }

    // Decimal point: the LAST separator wins, everything before it is grouping.
    var lastDot = text.lastIndexOf('.');
    var lastComma = text.lastIndexOf(',');
    var dec = Math.max(lastDot, lastComma);
    if (dec !== -1) {
        var intPart = text.substring(0, dec).replace(/[.,]/g, '');
        var frac = text.substring(dec + 1).replace(/[.,]/g, '');
        text = (intPart || '0') + '.' + frac;
    } else {
        text = text.replace(/[.,]/g, '');
    }

    if (!text || text === '-' || text === '+' || text === '.') { return null; }
    var value = parseFloat(text);
    if (isNaN(value)) { return null; }
    return value * mult;
}

// ── the thousands suffix ──────────────────────────────────────────────────────────
//
// Four scoreboard columns are bound to {g:citadel_thousands:...}: the game formats them
// in units, so a 42,000 soul match renders as the Label text "42" (42 thousand) and a
// 31-minute match of 42k souls would otherwise be reported as "1.4 souls/min" - off by
// three orders of magnitude, dragging every derived figure with it.
//
// The unit itself is rendered as a child Label inside the value, with the class `demote`
// (the shipped stylesheet has `#SoulsValue .demote{color: soulFlat;}`), so it is read
// rather than assumed. The default is 1000 only because of the thousands binding above,
// and it is per-FIELD: a 42k soul total and a 10k objective damage are not the same
// magnitude, and a patch could reformat one of them.
var MULT_K = 1e3;
var MULT_M = 1e6;

function multiplierFromUnit(unit) {
    if (unit === null || unit === undefined) { return MULT_K; }
    var u = String(unit).toLowerCase();
    // Millions first: "млн" contains neither 'k' nor the Russian 'т'.
    if (u.indexOf('млн') !== -1 || u.indexOf('mln') !== -1 ||
        u.indexOf('million') !== -1 || u.indexOf('m') !== -1) {
        return MULT_M;
    }
    if (u.indexOf('k') !== -1 || u.indexOf('т') !== -1 ||
        u.indexOf('тыс') !== -1 || u.indexOf('thou') !== -1) {
        return MULT_K;
    }
    // A unit we cannot interpret is not a reason to drop three orders of magnitude.
    return MULT_K;
}

// The unit child of a stat label, if this build renders one.
function statUnit(row, id) {
    var label = findDeep(row, id);
    if (!dataValid(label)) { return null; }
    if (!label.FindChildrenWithClass) { return null; }
    var kids = label.FindChildrenWithClass('demote');
    if (!kids || !kids.length) { return null; }
    var text = kids[0].text;
    return (typeof text === 'string' && text.length) ? text : null;
}

// A stat the scoreboard renders in units. Returns null when the number is unreadable,
// so a half-read value never becomes a confidently wrong one.
function readScaled(row, id) {
    var value = parseThousands(labelText(row, id));
    if (value === null) { return null; }
    return value * multiplierFromUnit(statUnit(row, id));
}

function parseIntSafe(raw) {
    if (raw === null || raw === undefined) { return null; }
    if (typeof raw === 'number') { return isFinite(raw) ? Math.round(raw) : null; }
    var digits = String(raw).replace(/[^\d-]/g, '');
    if (!digits) { return null; }
    var value = parseInt(digits, 10);
    return isNaN(value) ? null : value;
}

// ── post-game page: the full stat line for the open match ─────────────────────────

// The classes the vanilla post-game scoreboard puts on a .Player row. Read, not
// recomputed: the game has already decided who led each column, and re-deriving that
// would disagree with it on every tie.
//
//   IsLocalPlayer  - verified in the shipped stylesheet:
//                    #Team1 .Player.IsLocalPlayer .PlayerRow { background-color: ... }
//   Award*         - team leader in that column
//   MVP_Rank1..3   - the MVP screen's honour mentions
var AWARD_CLASS_NAMES = [
    'AwardSouls', 'AwardKills', 'AwardAssists',
    'AwardPlayerDmg', 'AwardObjDmg', 'AwardHealing'
];

function readAwards(row) {
    var out = {};
    for (var i = 0; i < AWARD_CLASS_NAMES.length; i++) {
        out[AWARD_CLASS_NAMES[i]] = !!row.BHasClass(AWARD_CLASS_NAMES[i]);
    }
    return out;
}

function readMvpRank(row) {
    if (row.BHasClass('MVP_Rank1')) { return 1; }
    if (row.BHasClass('MVP_Rank2')) { return 2; }
    if (row.BHasClass('MVP_Rank3')) { return 3; }
    return null;
}

// The match length is needed for any per-minute figure. There is no id for it in the
// post-game layout, so rather than guess at one, read every label on the page and take
// the first that is literally a clock time. If the game ever stops rendering one, this
// returns null and the report falls back to match totals - which is why nothing in the
// report is allowed to require a per-minute number.
function readDuration(context) {
    if (!dataValid(context)) { return null; }
    var labels = context.FindChildrenWithClassTraverse ? null : null;
    // Labels are not class-tagged, so walk the scoreboard and the carousel screens and
    // read their children directly.
    var roots = [];
    var carousel = context.FindChildTraverse('ScreensCarousel');
    if (dataValid(carousel)) { roots.push(carousel); }
    var details = context.FindChildTraverse('MatchDetails');
    if (dataValid(details)) { roots.push(details); }

    for (var r = 0; r < roots.length; r++) {
        var seconds = scanForClock(roots[r], 0);
        if (seconds !== null) { return seconds; }
    }
    return null;
}

function scanForClock(panel, depth) {
    if (!dataValid(panel) || depth > 6) { return null; }
    var kids = panel.Children();
    for (var i = 0; kids && i < kids.length; i++) {
        var child = kids[i];
        var text = child.text;
        if (typeof text === 'string' && text.length >= 4 && text.length <= 7) {
            var m = /^(\d{1,3}):([0-5]\d)$/.exec(text.trim());
            if (m) {
                var secs = (+m[1]) * 60 + (+m[2]);
                // A match is at least ten minutes and at most an hour. Anything outside
                // that is some other clock on the page (a respawn timer, a cooldown).
                if (secs >= 600 && secs <= 3600) { return secs; }
            }
        }
        var deeper = scanForClock(child, depth + 1);
        if (deeper !== null) { return deeper; }
    }
    return null;
}

function readPostGame(context) {
    var out = { ok: false, matchId: '', durationSeconds: null, players: [] };
    if (!dataValid(context)) { return out; }
    out.durationSeconds = readDuration(context);

    var carousel = context.FindChildTraverse('ScreensCarousel');
    if (dataValid(carousel)) {
        var screens = carousel.Children();
        for (var s = 0; screens && s < screens.length; s++) {
            var id = labelText(screens[s], 'MatchID');
            if (id) { out.matchId = id; break; }
        }
    }

    // The scoreboard lives on its own carousel screen and is instantiated lazily, so it
    // may be absent until that tab has been opened. Report that instead of returning an
    // empty lobby with no explanation.
    var screen = dataChildById(carousel, 'ScoreboardScreen');
    var scoreboard = dataValid(screen) ? dataChildById(screen, 'Scoreboard') : null;
    if (!dataValid(scoreboard)) {
        out.reason = 'scoreboard-not-instantiated';
        return out;
    }

    // Read team by team rather than flattening the whole scoreboard.
    //
    // Team attribution is not decoration: kill participation and share of souls are
    // per-TEAM, and summing both teams together gives a number that looks plausible and
    // means nothing. The vanilla layout keeps each side in its own container -
    //   Team1 > TeamPlayers   and   Team2 > TeamPlayers
    // which is the only reliable team signal available.
    var teams = [
        { id: 'Team1', label: 1 },
        { id: 'Team2', label: 2 }
    ];
    var classesSeen = {};
    var foundAny = false;

    for (var t = 0; t < teams.length; t++) {
        var teamBox = findDeep(scoreboard, teams[t].id);
        if (!dataValid(teamBox)) {
            dataLog('scoreboard: no ' + teams[t].id + ' container');
            continue;
        }
        // The game marks the winning side on the team container, not on a row.
        var winning = !!teamBox.BHasClass('IsWinningTeam');

        var holder = findDeep(teamBox, 'TeamPlayers');
        var rows = dataValid(holder)
            ? holder.FindChildrenWithClassTraverse('Player')
            : scoreboard.FindChildrenWithClassTraverse('Player');

        for (var r = 0; rows && r < rows.length; r++) {
            var row = rows[r];
            if (row.BHasClass('TotalsRow')) { continue; }

            var cls = row.GetClasses ? row.GetClasses() : [];
            for (var ci = 0; cls && ci < cls.length; ci++) {
                classesSeen[cls[ci]] = (classesSeen[cls[ci]] || 0) + 1;
            }

            out.players.push({
                // IsLocalPlayer only.
                //
                // The obvious second candidate, id="LocalPlayerIdentifier", is declared
                // on EVERY row in the vanilla layout and the game just collapses it on
                // the other eleven. Treating its presence as the marker made all twelve
                // rows look local, so the report confidently analysed whichever player
                // happened to be first - which is how a Drifter game came back labelled
                // Dynamo. Presence of an element is not a flag; a CLASS is.
                isLocal: !!row.BHasClass('IsLocalPlayer'),
                team: teams[t].label,
                winning: winning,
                mvpRank: readMvpRank(row),
                awards: readAwards(row),
                name: labelText(row, 'PlayerName'),
                hero: labelText(row, 'HeroName'),
                panel: row,
                souls: readScaled(row, 'SoulsValue'),
                kills: parseIntSafe(labelText(row, 'KillsValue')),
                deaths: parseIntSafe(labelText(row, 'DeathsValue')),
                assists: parseIntSafe(labelText(row, 'AssistsValue')),
                heroDamage: readScaled(row, 'PlayerDmgValue'),
                objectiveDamage: readScaled(row, 'ObjDmgValue'),
                healing: readScaled(row, 'HealingValue')
            });
            foundAny = true;
        }
    }

    var localCount = 0;
    for (var p = 0; p < out.players.length; p++) {
        if (out.players[p].isLocal) { localCount++; }
    }

    var sample = null;
    for (var q = 0; q < out.players.length; q++) {
        if (out.players[q].isLocal) { sample = out.players[q]; break; }
    }
    sample = sample || out.players[0] || {};

    // The unit is the one thing that silently rescales every number on the screen, so it
    // gets its own log line showing the RAW label text beside it. If the next run still
    // shows soul=42 and this line shows unit="", the default of 1000 is doing the work
    // and the whole screen is wrong by 1000x - visible immediately here.
    var probeRow = sample.panel;
    dataLog('post-game units: souls="' + labelText(probeRow, 'SoulsValue') + '" u="' +
        statUnit(probeRow, 'SoulsValue') + '" hdmg="' + labelText(probeRow, 'PlayerDmgValue') +
        '" u="' + statUnit(probeRow, 'PlayerDmgValue') + '" odmg="' +
        labelText(probeRow, 'ObjDmgValue') + '" u="' + statUnit(probeRow, 'ObjDmgValue') +
        '" heal="' + labelText(probeRow, 'HealingValue') + '" u="' +
        statUnit(probeRow, 'HealingValue') + '"');

    dataLog('post-game match ' + out.matchId + ': ' + out.players.length + ' players' +
        ' local=' + localCount + ' duration=' + out.durationSeconds +
        ' | sample soul=' + sample.souls + ' kda=' + sample.kills + '/' + sample.deaths +
        '/' + sample.assists + ' hdmg=' + sample.heroDamage +
        ' odmg=' + sample.objectiveDamage + ' heal=' + sample.healing +
        ' hero=' + sample.hero + ' awards=' + JSON.stringify(sample.awards) +
        ' | classes=' + JSON.stringify(classesSeen));

    out.ok = foundAny;
    if (!out.ok) { dataLog('post-game read failed: no player rows under Team1/Team2'); }
    if (foundAny && localCount !== 1) {
        // One row must be marked. Zero means the marker moved and the report refuses to
        // guess; more than one means the class is set on a container as well.
        dataLog('post-game WARNING: IsLocalPlayer matched ' + localCount +
            ' rows (expected exactly 1)');
    }
    return out;
}

// ── profile page: career totals ───────────────────────────────────────────────────
function readCareer(context) {
    var out = { ok: false };
    if (!dataValid(context)) { return out; }

    var left = context.FindChildTraverse('StatsLeft');
    if (!dataValid(left)) {
        out.reason = 'stats-left-missing';
        return out;
    }

    function stat(containerId, valueId) {
        var box = dataChildById(left, containerId);
        if (!dataValid(box)) { return null; }
        return parseIntSafe(labelText(box, valueId));
    }

    out.gamesPlayed = stat('GamesPlayedContainer', 'statValue');
    out.gamesWon = stat('GamesWonContainer', 'statValue');
    out.lastHits = stat('LastHitsContainer', 'statValue');
    out.denies = stat('DeniesContainer', 'statValue');
    out.commends = stat('CommendsContainer', 'statValue');

    if (out.gamesPlayed) {
        out.winRate = out.gamesPlayed > 0
            ? Math.round((out.gamesWon / out.gamesPlayed) * 100)
            : null;
    }

    // Friend ID is the only identity the profile exposes. There is no Steam API in
    // Panorama, so this is the handle used if the API is ever switched on.
    out.friendId = labelText(context, 'FriendID');

    out.ok = out.gamesPlayed !== null;
    dataLog('career ' + out.gamesPlayed + ' games, ' + out.gamesWon + ' won, winrate ' +
        out.winRate + '%, lastHits ' + out.lastHits + ', denies ' + out.denies);
    return out;
}

// ── profile page: the player's own match history ──────────────────────────────────
// Returns the block panels themselves, not copies, because picking a match means
// activating the game's own "View Details" panel on that block. The game then navigates
// to the post-game page for that match and our other host renders the report.
function readMatchHistory(context) {
    var out = { ok: false, blocks: [] };
    if (!dataValid(context)) { return out; }

    var area = context.FindChildTraverse('MatchHistoryArea');
    if (!dataValid(area)) {
        out.reason = 'match-history-area-missing';
        return out;
    }

    var blocks = area.FindChildrenWithClassTraverse('MatchBlockBig')
        .concat(area.FindChildrenWithClassTraverse('gameMiniBlock'));
    if (!blocks || !blocks.length) {
        out.reason = 'no-match-blocks';
        return out;
    }

    for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i];
        out.blocks.push({
            panel: block,
            hero: labelText(block, 'HeroName'),
            outcome: labelText(block, 'gameResult') || labelText(block, 'gameResultShort'),
            duration: labelText(block, 'gameDuration'),
            networth: labelText(block, 'gameNetworth')
        });
    }
    out.ok = out.blocks.length > 0;
    dataLog('history: ' + out.blocks.length + ' match blocks' +
        (out.ok ? ', first: ' + out.blocks[0].hero + ' ' + out.blocks[0].outcome : ''));
    return out;
}

// Activate the game's own "View Details" control on a history block.
//
// This is the whole trick that removes the need for a network: the game already knows
// how to open a full scoreboard for a past match, we just press its button. The
// dispatch contract - DispatchEvent("Activated", panel, "mouse"), with the source
// argument - is the one the Commend Everyone mod uses against C++-bound panels.
// MouseActivate is not a dataValid event name and does nothing.
function openMatchDetails(blockPanel) {
    if (!dataValid(blockPanel)) {
        dataLog('openMatchDetails: invalid block');
        return false;
    }
    var targets = blockPanel.FindChildrenWithClassTraverse('viewDetails');
    if (!targets || !targets.length) {
        dataLog('openMatchDetails: no viewDetails control on this block');
        return false;
    }
    try {
        $.DispatchEvent('Activated', targets[0], 'mouse');
        dataLog('openMatchDetails: dispatched on ' + blockPanel.id);
        return true;
    } catch (err) {
        dataLog('openMatchDetails threw: ' + err);
        return false;
    }
}

PM.Data = {
    readPostGame: readPostGame,
    readCareer: readCareer,
    readMatchHistory: readMatchHistory,
    openMatchDetails: openMatchDetails,
    findDeep: findDeep,
    parseThousands: parseThousands,
    multiplierFromUnit: multiplierFromUnit,
    parseIntSafe: parseIntSafe,
    valid: dataValid,
    childById: dataChildById,
    labelText: labelText,
    classesWithClass: classesWithClass
};

dataLog('module loaded');
}