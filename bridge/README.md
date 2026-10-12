# Bridge — воркер и страница для API

Мод читает сеть только через `CitadelHTMLPanel` (см. `docs/TRANSPORT.md`).
Страница моста и API-прокси живут на одном воркере — это закрывает CORS
и старый TLS CEF разом: страница ходит за данными на свой же origin.

База: `https://balalock.egz0tikys99.workers.dev`
(`BRIDGE_URL` в `panorama/scripts/postmortem/pm_net.js` уже указывает туда).

## Деплой

```powershell
cd bridge
npm i -g wrangler
wrangler login
wrangler deploy
```

Проверка:

```
curl https://balalock.egz0tikys99.workers.dev/health
curl "https://balalock.egz0tikys99.workers.dev/slim/search?q=Abrams"
```

## Маршруты

| Путь | Что |
|---|---|
| `/` | bridge-страница (`pmReply(kind, body)`, чанки по 3500 символов в `document.title`) |
| `/health` | `{ok:true}` |
| `/slim/search?q=` | поиск игроков по нику (8) |
| `/slim/history/<account_id>` | последние 10 каток, ужатые поля |
| `/slim/match/<match_id>` | метаданные матча, ужатые до ~3–6 КБ |
| `/slim/player/<account_id>` | карточка + ранг |
| `/slim/counters?hero_id=` | топ-8 контер-пиков |
| `/slim/items?hero_id=` | топ-10 предметов по винрейту |
| `/slim/board/<region>` | лидерборд региона |
| `/api/*` | сырой прокси `api.deadlock-api.com` (отладка) |

Протокол Panorama → страница (`panel.SetURL('javascript:...')`):

```
pmReply('<tag>/meta', 'slim /slim/search?q=Abrams')
  -> title 'PM1|<tag>/meta|0|{"chunks":1,"len":512}'

pmReply('<tag>/s0', 'slice <tag> 0')
  -> title 'PM1|<tag>/s0|0|<кусок JSON>'
```

Каждый запрос — один ответ (так устроен `PM.Net.request`).
Слайсы тянутся строго по очереди, не параллельно.
