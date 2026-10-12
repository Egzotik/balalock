'use strict';

// ─────────────────────────────────────────────────────────────────────────────────
// pm_text.js - every user-visible string, in Russian, and the number formatting.
//
// Panorama's localisation for addon panels was never verified on this build, and an
// unresolved #Token renders as its own key. So the wording lives here as literals and
// switching language means editing one table.
//
// This is also the whole language layer. pm_analysis.js emits facts and keys
// (levelOf returns 'good' / 'mid' / 'bad'); this file turns them into sentences. That is
// what makes translation a one-file change instead of a hunt through the maths, and it
// is why no Russian string appears anywhere else in the mod.
//
// ES3 CONSTRAINT: keys avoid ES3 reserved words (close, open, class) and object literals
// carry no trailing comma. Panorama's parser accepts both; tools/test_analysis.js runs
// this file under Windows Script Host, which does not, and the stricter parser wins.
// ─────────────────────────────────────────────────────────────────────────────────

var PM = ($.PM = $.PM || {});

var TEXT = {
    // ── шапка ─────────────────────────────────────────────────────────────────────
    subtitle: 'Разбор матча',
    sourceBadge: 'В игре',
    closeButton: 'Закрыть',
    statusLoading: 'Читаю данные матча...',
    statusReady: 'Матч ',
    statusNoMatch: 'Нет данных матча. Доиграйте катку или откройте разбор с экрана итогов.',
    rowPlayers: 'игроков',
    statusOpeningTable: 'Открываю таблицу состава...',
    statusNeedScoreboardTab: 'Откройте вкладку «Таблица», затем снова нажмите POSTMORTEM.',
    statusNoHistory: 'История матчей ещё не загрузилась. Она приходит вместе с профилем; ' +
                     'попробуйте «View All» на странице профиля.',

    // ── секции ────────────────────────────────────────────────────────────────────
    sectionMatch: 'Этот матч',
    sectionAgainstLobby: 'Против лобби',
    sectionChart: 'Ты против медианы лобби',
    sectionBreakdown: 'Разбор',
    sectionAdvice: 'Вердикт и советы',
    sectionStatLine: 'Статистика против лобби',
    sectionLobby: 'Лобби по урону по героям',
    sectionTeamTotals: 'Команды',
    sectionDiagnostics: 'Диагностика',

    // ── герой и вердикт ───────────────────────────────────────────────────────────
    heroUnknown: 'Герой неизвестен',
    noMatchData: 'Недоступно без сети',
    notAvailable: 'нет данных',
    won: 'ПОБЕДА',
    lost: 'ПОРАЖЕНИЕ',
    mvp: 'MVP',
    noLocalPlayer: 'Ни одна строка таблицы не помечена как ваша, поэтому разбирать некого. ' +
                   'Откройте вкладку «Таблица» и попробуйте снова.',

    verdictGood: 'Сыграно хорошо',
    verdictGoodNote: 'Провалов почти нет. Ниже - что можно улучшить, если захочется.',
    verdictMid: 'Ровная игра',
    verdictMidNote: 'Без провалов не обойтись. Ниже - конкретные причины и что делать.',
    verdictBad: 'Слабая игра',
    verdictBadNote: 'Разбор по причинам: сначала что было не так, потом что делать.',

    // ── метрики ───────────────────────────────────────────────────────────────────
    mSouls: 'души',
    mHeroDamage: 'урон по героям',
    mKillParticipation: 'участие в убийствах, %',
    mObjectiveDamage: 'урон по объектам',
    mHealing: 'лечение',
    mDeaths: 'смерти',

    tagFarm: 'ФАРМ',
    tagFights: 'ДРАКИ',
    tagObjectives: 'ОБЪЕКТЫ',
    gapPrefix: 'Главный провал:',

    // ── заголовки таблиц ──────────────────────────────────────────────────────────
    rowStat: 'показатель',
    rowHero: 'герой',
    rowKda: 'К / Д / П',
    colYou: 'ты',
    colMedian: 'медиана лобби',
    colRank: 'место',
    colSouls: 'души',
    colYouShort: 'ты',
    colMedianShort: 'медиана',
    colChartLabel: 'показатель',

    // ── награды ────────────────────────────────────────────────────────────────────
    awardSouls: 'больше всех душ в команде',
    awardKills: 'больше всех убийств в команде',
    awardAssists: 'больше всех помощи в команде',
    awardPlayerDmg: 'больше всего урона по героям в команде',
    awardObjDmg: 'больше всего урона по объектам в команде',
    awardHealing: 'больше всего лечения в команде',
    awardNone: 'наград команды в этом матче не было',
    ignoredNote: 'не в счёт: ',

    // ── сводка по командам ─────────────────────────────────────────────────────────
    rowKills: 'убийства',
    rowDeaths: 'смерти',
    rowHeroDamage: 'урон по героям',
    rowObjectiveDamage: 'урон по объектам',
    rowHealing: 'лечение',
    teamMine: 'ВАША КОМАНДА',
    teamTheirs: 'ПРОТИВНИК',

    // ── диагностика ───────────────────────────────────────────────────────────────
    diagRun: 'Проверка транспорта',
    diagRunButton: 'Запустить',
    diagRunning: 'Идёт... это занимает до 12 секунд.',
    wrongHeader: 'ПРОБЛЕМЫ С ДАННЫМИ (разбор выше построен без них)',
    wrongNone: 'ПРОБЛЕМ С ДАННЫМИ НЕТ - все поля на этом экране прочитаны',

    footerNote: 'напечатано утром после'
};

// ─────────────────────────────────────────────────────────────────────────────────
// Причины и решения.
//
// The shape the user asked for: not "you had low souls" but "here is why, and here is
// what to do about it". Every entry is { cause, fix }. `good` entries exist on purpose -
// a good match still has a second-worst statistic worth naming, and an advice screen
// that only ever criticises reads as broken rather than as honest.
// ─────────────────────────────────────────────────────────────────────────────────

var GUIDES = {
    souls: {
        good: {
            cause: 'Фарм сильный - вы в верхней трети лобби.',
            fix: 'Дальше конвертируйте излишек в предметы: к 10:00 у всех должен быть 4-5 ' +
                 'уровень, иначе вы отстаёте по таймингам.'
        },
        bad: {
            cause: 'Душ мало: вы в нижней трети лобби, и это почти всегда и есть причина ' +
                   'всех остальных провалов.',
            fix: 'Держите линию до 10:00 и добивайте крипов. Ориентир - 1000+ душ в минуту.'
        }
    },
    heroDamage: {
        good: {
            cause: 'Урон по героям хороший.',
            fix: 'Попробуйте добавить урона по танкам - часть игроков наносит его ' +
                 'случайно и потом удивляется, почему не может сдвинуть шпиль.'
        },
        bad: {
            cause: 'Мало урона по героям: вы били мимо цели или слишком далеко стояли.',
            fix: 'Играйте ближе к команде, фокусируйте одну цель, не разменивайтесь с ' +
                 'танками - на них урон тратится впустую.'
        }
    },
    killParticipation: {
        good: {
            cause: 'Вы участвуете в большинстве убийств команды.',
            fix: 'С этим можно играть агрессивнее: враги уже знают, что вы придёте.'
        },
        bad: {
            cause: 'Редко участвуете в убийствах: команда собиралась без вас.',
            fix: 'Приходите на драку до её начала, а не после. И не фармите дальнюю линию, ' +
                 'когда команда уже собралась.'
        }
    },
    objectiveDamage: {
        good: {
            cause: 'Хорошее давление по объектам.',
            fix: 'Можно рискнуть и взять шпиль на себя - у вас уже есть для этого позиция.'
        },
        bad: {
            cause: 'Мало урона по объектам: вы заканчивали на врагах, а не на целях.',
            fix: 'После выигранной драки идите на шпиль или босса, а не на базу. Именно это ' +
                 'открывает доступ к следующему рубежу.'
        }
    },
    healing: {
        good: {
            cause: 'Лечение на уровне или выше медианы лобби.',
            fix: 'Помните, что лечение лечит только союзников рядом. Часто выгоднее лечить ' +
                 'двух, чем одного полностью.'
        },
        bad: {
            cause: 'Лечения почти нет. Для героя поддержки это главный показатель, для ' +
                   'остальных - нейтральный.',
            fix: 'Если это не ваша роль - нормально. Если поддержка - стройтесь на ' +
                 'расстояние 600-900 и кастуйте, когда союзник ниже 60%.'
        }
    },
    deaths: {
        good: {
            cause: 'Смертей мало - вы держитесь в игре.',
            fix: 'Раз выживаете чаще всех, можно рисковать больше: у вас есть запас на ' +
                 'плохой размен.'
        },
        bad: {
            cause: 'Слишком много смертей: вас находят и разбирают поодиночке.',
            fix: 'Перед пушем проверяйте миникарту и не оставайтесь один. Шесть смертей ' +
                 'за катку - это уже не хаос, а система.'
        }
    }
};

// Совет, который не про метрику, но полезнее любого места в таблице.
var DEATHS_ADVICE = {
    cause: 'Итог катки: {deaths} смертей за {minutes} минут.',
    fix: 'Соберите сопротивление под главный источник урона: духовная броня против ' +
         'магов, пулевая против стрелков.'
};

// ─────────────────────────────────────────────────────────────────────────────────
// Форматирование чисел
//
// Panorama JS has no Intl and no dependable toLocaleString, so grouping is done by hand.
// Doing it by hand is exactly the sort of thing that is subtly wrong and obviously fine,
// which is why tools/test_analysis.js asserts every one of these.
//
// The separator is U+00A0, not a plain space: Russian groups thousands with a space, but a
// plain one is a wrapping opportunity, and "42" over "000" on two lines is worse than no
// grouping at all.
// ─────────────────────────────────────────────────────────────────────────────────

function group(intPart) {
    var out = '';
    var count = 0;
    for (var i = intPart.length - 1; i >= 0; i--) {
        out = intPart.charAt(i) + out;
        count++;
        if (count % 3 === 0 && i > 0) { out = '\u00a0' + out; }
    }
    return out;
}

// null и undefined печатаются как «нет данных», а не как 0: значение, которое не
// удалось прочитать, это не то же самое, что ноль, и печать нуля выдумала бы результат.
function f(value, unit) {
    if (value === null || value === undefined || typeof value !== 'number' ||
        !isFinite(value)) {
        return TEXT.notAvailable;
    }
    var neg = value < 0;
    var s = String(Math.abs(value));
    var dot = s.indexOf('.');
    var intPart = (dot === -1) ? s : s.substring(0, dot);
    var frac = (dot === -1) ? '' : s.substring(dot);
    if (frac.length > 3) { frac = frac.substring(0, 3); }
    var out = group(intPart) + frac;
    if (neg) { out = '-' + out; }
    return unit ? (out + ' ' + unit) : out;
}

function int(value, unit) {
    if (value === null || value === undefined || typeof value !== 'number' ||
        !isFinite(value)) {
        return TEXT.notAvailable;
    }
    return f(Math.round(value), unit);
}

// Процент - это суффикс, а не единица измерения: «59,1%», а не «59,1 %».
function pct(value) {
    if (value === null || value === undefined || typeof value !== 'number' ||
        !isFinite(value)) {
        return TEXT.notAvailable;
    }
    return f(Math.round(value * 10) / 10, '') + '%';
}

// «место 3 из 12». Когда ранг вычислить не удалось, размер выборки всё равно показан:
// прятать его - значит намекать, что данных был один.
function place(stat, total) {
    var of = (stat && stat.of) ? stat.of : total;
    if (!stat || stat.rank === null || stat.rank === undefined) {
        return 'место ' + TEXT.notAvailable + ' из ' + int(of);
    }
    return 'место ' + int(stat.rank) + ' из ' + int(of);
}

function awardLabel(key) {
    var map = {
        souls: TEXT.awardSouls,
        kills: TEXT.awardKills,
        assists: TEXT.awardAssists,
        heroDamage: TEXT.awardPlayerDmg,
        objectiveDamage: TEXT.awardObjDmg,
        healing: TEXT.awardHealing
    };
    return map[key] || key;
}

function metricLabel(key) {
    var map = {
        souls: TEXT.mSouls,
        heroDamage: TEXT.mHeroDamage,
        killParticipation: TEXT.mKillParticipation,
        objectiveDamage: TEXT.mObjectiveDamage,
        healing: TEXT.mHealing,
        deaths: TEXT.mDeaths
    };
    return map[key] || key;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Тексты разбора
// ─────────────────────────────────────────────────────────────────────────────────

// Три строки разбора из настольного приложения.
//
// Скорость душ в минуту требует длительности матча. Без неё честная подпись - итог:
// «8 200 souls/min» для 26-минутной катки - это не ошибка форматирования, это число,
// ошибочное на порядок.
function breakdown(report) {
    if (!report.ok) { return null; }
    var f2 = report.focus;
    var n = report.lobby.length;
    var farmStat = PM.Analysis.byKey(report, 'souls');
    var fightsStat = PM.Analysis.byKey(report, 'killParticipation');
    var deathsStat = PM.Analysis.byKey(report, 'deaths');
    var objStat = PM.Analysis.byKey(report, 'objectiveDamage');

    var rate = (report.minutes && report.minutes > 0)
        ? Math.round((f2.souls / report.minutes) * 10) / 10
        : null;
    var farmHead = (rate === null)
        ? f(f2.souls, TEXT.mSouls)
        : f(rate, 'душ/мин');

    return {
        farm: farmHead + ' - ' + place(farmStat, n) + '; ' + pct(f2.shareTeamSouls) +
              ' всех душ команды.',
        fights: pct(f2.killParticipation) + ' участие в убийствах (' +
                 place(fightsStat, n) + '); ' + int(f2.deaths, TEXT.rowDeaths) + ' (' +
                 place(deathsStat, n) + ').',
        objectives: f(f2.objectiveDamage, TEXT.mObjectiveDamage) + ' - ' +
                     place(objStat, n) + '.'
    };
}

// Карточки советов. Каждая - причина и решение, а не только «вы были плохи».
//
// Порядок задаёт shortlist(): сначала провалы, потом середина, и последней - лучший
// показатель, потому что «сыграно хорошо, вот что можно улучшить» - тоже ответ на
// вопрос пользователя.
function advice(report, limit) {
    if (!report.ok) { return []; }
    var picks = PM.Analysis.shortlist(report, limit || 4);
    var out = [];
    for (var idx = 0; idx < picks.length; idx++) {
        var p = picks[idx];
        var guide = GUIDES[p.key];
        if (!guide) { continue; }
        var set = guide[p.level] || guide.bad || guide.good;
        out.push({
            key: p.key,
            label: metricLabel(p.key),
            level: p.level,
            place: place(p, p.of),
            cause: set.cause,
            fix: set.fix
        });
    }

    // Совет про смерти не про метрику, но полезнее любого места в таблице.
    var deathsFinding = null;
    var all = PM.Analysis.findings(report);
    for (var idx2 = 0; idx2 < all.length; idx2++) {
        if (all[idx2].key === 'deaths') { deathsFinding = all[idx2]; }
    }
    if (deathsFinding && deathsFinding.level === 'bad' &&
        report.focus.deaths >= 6 && out.length < (limit || 4) + 1) {
        out.push({
            key: 'resist',
            label: 'сопротивление',
            level: 'bad',
            place: '',
            cause: DEATHS_ADVICE.cause
                .replace('{deaths}', int(report.focus.deaths))
                .replace('{minutes}', int(report.minutes)),
            fix: DEATHS_ADVICE.fix
        });
    }
    return out;
}

function verdict(report) {
    if (!report.ok) { return { key: 'unknown', title: '', note: '' }; }
    var map = {
        GOOD: { key: 'good', title: TEXT.verdictGood, note: TEXT.verdictGoodNote },
        MIXED: { key: 'mid', title: TEXT.verdictMid, note: TEXT.verdictMidNote },
        BAD: { key: 'bad', title: TEXT.verdictBad, note: TEXT.verdictBadNote }
    };
    return map[report.verdict] || map.MIXED;
}

PM.Text = {
    TABLE: TEXT,
    f: f,
    int: int,
    pct: pct,
    place: place,
    metricLabel: metricLabel,
    awardLabel: awardLabel,
    breakdown: breakdown,
    advice: advice,
    verdict: verdict
};