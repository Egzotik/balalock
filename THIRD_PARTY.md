# THIRD PARTY — кредиты и лицензии

## Valve

Deadlock, Source 2 Panorama. Мод переиспользует игровые ресурсы: стили, шрифты,
компоненты, текстовые токены, нативные панели табло. Это тот же пайплайн, что и у любого
Deadlock-мода: переопределение layout и включение собственных ассетов.

Deadlock и логотип Deadlock — товарные знаки Valve Corporation. Проект не связан с Valve.

## Образцы и источники

Ниже — проекты, чьи находки, измерения и паттерны использованы при разработке. Для
публикации на GameBanana те же кредиты пойдут в описание страницы.

### Predi-i/Deadlock-UI-Mods

<https://github.com/Predi-i/Deadlock-UI-Mods>

Использовано:

- `Commend-Everyone-Button/panorama/layout/post_game/citadel_db_page_post_game_new.xml` —
  рабочий образец переопределения **того же** файла, что переопределяет этот мод.
  Именно из него взят вывод, что `<include>` в переопределении пишется с суффиксом `_c`.
- `HTML_TRANSPORT_HANDOFF.md` и `DL-Arcade-Cloudflare/ARCHITECTURE.md` — протокол
  CEF-моста, измеренные ограничения (4096 символов, дедуп по содержимому, «только точное
  значение успеха», «каждый терминальный путь зовёт колбэк»), ловушка с
  `typeof localStorage` в `data:`-документе.
- `DL-Arcade-Cloudflare/panorama/scripts/hud_lookup.js` — приём обхода панелей вместо
  подписки на события движка.
- `tools/build_mod.ps1`, `tools/update_mods.py`, `tools/upstream.json` — схема
  организации сборки и автосинхронизации с ванилью.

Код не копировался; использованы выводы и паттерны. Лицензию проверить перед любым
дословным заимствованием.

### Chaps-Competitive-LTD/deadlock-spectator-rotation-addon

<https://github.com/Chaps-Competitive-LTD/deadlock-spectator-rotation-addon> — MIT

Приём разбора собранных данных из консоли игры (`$.Msg('[TAG]' + JSON.stringify(...))`).
Использован как запасной путь получения точных значений, когда нативные Label отдают
только форматированные строки вида `12.3k`.

### SteamTracking/GameTracking-Deadlock

<https://github.com/SteamTracking/GameTracking-Deadlock>

Распакованные ресурсы игры: `panorama/layout/post_game/citadel_db_page_post_game_new.xml`,
`citadel_dashboard_footer_bar.xml`, `citadel_db_page_profile.xml`,
`citadel_match_history_block_large.xml`, `match_details_graphs.xml`,
`citadel_db_post_game_scoreboard_new.xml`. Оттуда взяты точка интеграции (карусель
пост-матч экрана), список нативных биндингов и мер в лобби.

## Данные

`api.deadlock-api.com` — публичный API матчей. Используется только в той части мода,
где игра отдаёт недостаточно данных. Не аффилировано с Valve.

## Инструменты

| Инструмент | Назначение | Лицензия |
|---|---|---|
| Reduced CSDK 12 | компиляция Panorama-ассетов | community toolkit; сам содержит бинарники CS2 Workshop Tools |
| ValvePython/vpk | чтение и упаковка VPK | MIT |
| lz4 | чтение скомпилированных ассетов | BSD |

## AI

Разработка велась с участием ИИ-ассистента: генерация и рефакторинг кода, отладка,
исследование документации и ресурсов игры. При публикации на GameBanana это раскрывается
в поле AI Usage Disclosure с указанием конкретного сервиса — того требует политика
GameBanana об AI-контенте (gamebanana.com/wikis/2175, раздел «Disclosure»): формулировка
«использовался ИИ» не проходит проверку, нужно объяснить, какой именно.

Оригинальный мод `POSTMORTEM` (GameBanana 703342) был удалён именно за отсутствие такого
раскрытия. Этот проект существует в том числе затем, чтобы не повторить ошибку.