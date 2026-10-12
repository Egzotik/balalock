/**
 * balalock bridge worker — Cloudflare Workers, no dependencies.
 *
 * Deploy: wrangler deploy  (see bridge/README.md)
 * Public base: https://balalock.egz0tikys99.workers.dev
 *
 * WHY THIS EXISTS
 * Panorama has no fetch/XHR. The only way out is a CitadelHTMLPanel (real Chromium)
 * talking to an https page, pushing data back through document.title (max 4096 chars).
 * api.deadlock-api.com cannot be fetched directly from that page reliably:
 * old CEF TLS + CORS. So every Panorama request goes to THIS worker (same origin as
 * the bridge page, modern TLS, no CORS problem), and the worker talks to the API.
 *
 * Two route families:
 *   /api/*    raw passthrough to https://api.deadlock-api.com/* (debug / future)
 *   /slim/*   compact projections: the worker strips a 50-200KB match metadata down
 *             to ~3-6KB so it fits in 1-2 title slices instead of 30+.
 *   /         the bridge page itself (bridge.html embedded below to keep one file).
 *   /health   liveness.
 */

var UPSTREAM = 'https://api.deadlock-api.com';
var CACHE_TTL = 120;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=' + CACHE_TTL
  };
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders())
  });
}

async function passthrough(request, apiPath) {
  var url = UPSTREAM + apiPath;
  var res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  var text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders())
  });
}

async function upstreamJSON(apiPath) {
  var res = await fetch(UPSTREAM + apiPath, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) { return { error: 'upstream ' + res.status, path: apiPath }; }
  return res.json();
}

function num(v, fallback) {
  return (typeof v === 'number' && isFinite(v)) ? v : fallback;
}

function slimPlayerRow(p) {
  return {
    account_id: p.account_id || null,
    name: p.player_name || p.name || null,
    hero_id: num(p.hero_id, null),
    kills: num(p.kills, null),
    deaths: num(p.deaths, null),
    assists: num(p.assists, null),
    net_worth: num(p.net_worth, null),
    hero_damage: num(p.hero_damage, null),
    objective_damage: num(p.objective_damage, p.objective_damage_mitigated != null ? null : null),
    healing: num(p.player_healing, num(p.healing, null)),
    last_hits: num(p.last_hits, null),
    denies: num(p.denies, null)
  };
}

async function slimMatch(matchId) {
  var meta = await upstreamJSON('/v1/matches/' + matchId + '/metadata');
  if (meta.error) { return meta; }
  var matchInfo = meta.match_info || {};
  var players = meta.players || [];
  return {
    match_id: num(matchInfo.match_id, null),
    game_mode: matchInfo.game_mode || null,
    match_mode: matchInfo.match_mode || null,
    duration_s: num(matchInfo.duration_s, num(matchInfo.game_time_s, null)),
    winning_team: num(matchInfo.winning_team, null),
    average_badge: num(matchInfo.average_badge, null),
    players: players.map(slimPlayerRow)
  };
}

async function slimHistory(accountId, limit) {
  var list = await upstreamJSON('/v1/players/' + accountId + '/match-history');
  if (list.error) { return list; }
  var arr = Array.isArray(list) ? list : (list.matches || list.history || []);
  return arr.slice(0, limit).map(function (m) {
    return {
      match_id: num(m.match_id, null),
      hero_id: num(m.hero_id, null),
      player_kills: num(m.player_kills, null),
      player_deaths: num(m.player_deaths, null),
      player_assists: num(m.player_assists, null),
      net_worth: num(m.net_worth, null),
      match_duration_s: num(m.match_duration_s, null),
      match_result: num(m.match_result, null),
      start_time: num(m.start_time, null),
      game_mode: m.game_mode || null
    };
  });
}

async function slimPlayerCard(accountId) {
  var card = await upstreamJSON('/v1/players/' + accountId + '/card');
  var rank = await upstreamJSON('/v1/players/' + accountId + '/rank');
  if (card.error && rank.error) { return { error: 'player not found', account_id: accountId }; }
  return {
    account_id: accountId,
    name: (card && (card.player_name || card.name)) || null,
    matches: card ? num(card.matches_played ?? card.match_count, null) : null,
    win_rate: card ? num(card.win_rate, null) : null,
    rank_tier: (rank && (rank.rank_tier ?? rank.tier)) ?? null,
    rank_subtier: (rank && (rank.rank_subtier ?? rank.subtier)) ?? null,
    leaderboard_place: (rank && (rank.top_placement ?? rank.leaderboard_place)) ?? null
  };
}

async function slimSearch(query, limit) {
  var list = await upstreamJSON('/v1/players/steam-search?search_query=' +
    encodeURIComponent(query) + '&limit=' + (limit || 8));
  if (list.error) { return list; }
  var arr = Array.isArray(list) ? list : (list.results || list.players || []);
  return arr.slice(0, limit || 8).map(function (p) {
    return {
      account_id: num(p.account_id, null),
      name: p.player_name || p.name || p.persona_name || null,
      matches: num(p.matches_played ?? p.match_count, null),
      rank: num(p.best_rank ?? p.rank, null)
    };
  });
}

async function slimCounters(heroId) {
  var list = await upstreamJSON('/v1/analytics/hero-counter-stats?hero_ids=' + heroId);
  if (list.error) { return list; }
  var arr = Array.isArray(list) ? list : [];
  arr.sort(function (a, b) { return (a.win_rate || 0) - (b.win_rate || 0); });
  return arr.slice(0, 8).map(function (r) {
    return {
      hero_id: num(r.enemy_hero_id ?? r.hero_id, null),
      win_rate: num(r.win_rate, null),
      matches: num(r.matches_played ?? r.match_count, null)
    };
  });
}

async function slimItems(heroId) {
  var list = await upstreamJSON('/v1/analytics/item-stats?hero_id=' + heroId);
  if (list.error) { return list; }
  var arr = Array.isArray(list) ? list : [];
  arr.sort(function (a, b) { return (b.win_rate || 0) - (a.win_rate || 0); });
  return arr.slice(0, 10).map(function (r) {
    return {
      item_id: r.item_id ?? r.item ?? null,
      win_rate: num(r.win_rate, null),
      matches: num(r.matches_played ?? r.match_count, null)
    };
  });
}

var BRIDGE_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>balalock bridge</title></head><body><script>' +
'var pmSeq=0,pmCache={};' +
'function pmTitle(s){document.title=s;}' +
'function pmReply(kind,body){try{pmHandle(kind,String(body));}catch(e){pmTitle("PM1|"+kind+"|0|err "+((e&&e.name)||"threw")));}}' +
'function pmHandle(kind,body){' +
'if(body.indexOf("slim ")===0){var path=body.substring(5);' +
'fetch(path,{headers:{"Accept":"application/json"}}).then(function(r){return r.text();}).then(function(t){' +
'var chunks=[];for(var i=0;i<t.length;i+=3500){chunks.push(t.substring(i,i+3500));}' +
'pmCache[kind]={chunks:chunks};' +
'pmTitle("PM1|"+kind+"|0|"+JSON.stringify({chunks:chunks.length,len:t.length}));' +
'}).catch(function(e){pmTitle("PM1|"+kind+"|0|err "+((e&&e.name)||"fetch-fail"));});return;}' +
'if(body.indexOf("slice ")===0){var parts=body.split(" ");var tag=parts[1];var idx=parseInt(parts[2],10);' +
'var entry=pmCache[tag];' +
'if(!entry){pmTitle("PM1|"+kind+"|0|err no-cache");return;}' +
'pmTitle("PM1|"+kind+"|0|"+(entry.chunks[idx]||""));return;}' +
'pmTitle("PM1|"+kind+"|0|err bad-command");}' +
'pmTitle("PM1|boot|0|bridge-ready");' +
'</scr' + 'ipt></body></html>';

export default {
  async fetch(request, env) {
    var url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    if (url.pathname === '/health') {
      return jsonResponse({ ok: true, upstream: UPSTREAM });
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(BRIDGE_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' }
      });
    }
    if (url.pathname.indexOf('/slim/search') === 0) {
      return jsonResponse(await slimSearch(url.searchParams.get('q') || '', 8));
    }
    if (url.pathname.indexOf('/slim/history/') === 0) {
      var account = url.pathname.split('/')[3];
      return jsonResponse(await slimHistory(account, 10));
    }
    if (url.pathname.indexOf('/slim/match/') === 0) {
      return jsonResponse(await slimMatch(url.pathname.split('/')[3]));
    }
    if (url.pathname.indexOf('/slim/player/') === 0) {
      return jsonResponse(await slimPlayerCard(url.pathname.split('/')[3]));
    }
    if (url.pathname.indexOf('/slim/counters') === 0) {
      return jsonResponse(await slimCounters(url.searchParams.get('hero_id') || ''));
    }
    if (url.pathname.indexOf('/slim/items') === 0) {
      return jsonResponse(await slimItems(url.searchParams.get('hero_id') || ''));
    }
    if (url.pathname.indexOf('/slim/board/') === 0) {
      var region = url.pathname.split('/')[3] || 'europe';
      return jsonResponse(await upstreamJSON('/v1/leaderboard/' + region));
    }
    if (url.pathname.indexOf('/api/') === 0) {
      return passthrough(request, url.pathname.substring(4) + url.search);
    }
    return jsonResponse({ error: 'not found' }, 404);
  }
};
