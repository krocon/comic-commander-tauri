# Design 008 – Aktionen, Tastaturkürzel und Menüleiste

> Status: umgesetzt 23.10.2026 · freigegeben 23.10.2026 (Marc: „bearbeite Prompt 008 selbstständig“ – Empfehlungen gelten als freigegeben) ·
> Branch `feat/aktionen-menue` (auf `feat/thumbs-generieren`) · Auftrag:
> [`008-aktionen-menue-tastatur.md`](008-aktionen-menue-tastatur.md) · Vorlage: legacy §6, §7, §9

## Entscheidungen auf einen Blick

| Nr. | Frage | Entscheidung |
|---|---|---|
| E1 | Befehlspalette | **jetzt** (`Mod+Shift+P`): mit dem Katalog ist sie klein – Dialog mit Suchfeld + Liste (APG-Combobox), nur aktive Aktionen, Kürzel daneben |
| E2 | Kürzel-Editor | **nur Override-Datei** `<app config>/keymap.json` (`{version: 1, bindings: {<Aktion>: ["Mod+Shift+X", …]}}` – ersetzt die Kürzel dieser Aktion, `[]` entfernt sie); Rust prüft Größe und Syntax, unbekannte Aktionen ignoriert das Frontend mit Hinweis in der Konsole. Editor mit 009 (Einstellungen) |
| E3 | Übernahme aus files-and-folders | Die fnf-Quellen sind in dieser Sitzung nicht lesbar (nur dieser Repo-Ordner ist verbunden). **Eigene, schlanke Umsetzung** mit denselben Begriffen (`action-catalog`, `ActionService`, `KeyboardDispatcher`, `menu-model`, `app_menu.rs`); keine Modifier-Sätze, keine TC-Auswahl |
| E4 | Kontexte | `global`, `grid` (Fokus im Cover-Grid), `reader` (Leser offen; danach `global`). Ein Dialog ist offen → der Dispatcher tut nichts (Modal/Palette führen selbst) |
| E5 | Eingabefelder | im Text-/Suchfeld nur **Kürzel mit `Mod`** (z. B. `Mod+R`, `Mod+1`); `Esc`, Pfeile, Buchstaben bleiben beim Feld. Schaltflächen behalten `Space`/`Enter`, Schieberegler seine Pfeile. Widgets mit eigener Tastatur nach APG (Menüs, Listen, Modal-Fokusfalle) behalten ihre Element-Handler – verboten ist nur `document:keydown` außerhalb des Dispatchers |
| E6 | Notation | `Mod` = ⌘ (macOS) bzw. Ctrl; Reihenfolge `Mod+Ctrl+Alt+Shift+Taste`; Taste = `e.key` (Buchstaben klein, `Space`, `ArrowRight`, `F11` …); bei Satzzeichen zählt `Shift` nicht (`Mod++` trifft `Ctrl+Shift+=` der US-Tastatur). Anzeige macOS `⌘⇧P`, sonst `Ctrl+Shift+P` |
| E7 | Keymaps | JSON je Kontext: `keymap.base.json` + `keymap.mac.json`/`keymap.other.json` (Vollbild `Mod+Ctrl+F` vs. `F11`, Einstellungen `Mod+,`), dann Override |
| E8 | Menüleiste | **ein Modell** (`menu-model.ts`, rein): Ablage · Ansicht · Kategorie · Lesen · Hilfe; macOS **nativ** über `set_app_menu(spec)` (Rust baut `tauri::menu`, App-Menü + Bearbeiten (Kopieren/Einfügen in Feldern!) + Fenster vordefiniert, Klick → Ereignis `menu-action`), Zustände (aktiv/abgehakt) durch Neuaufbau (entprellt). Windows/Linux **HTML-Menüleiste** (APG `menubar`, `F10`/`Alt` fokussiert) über der Kategorie-Ansicht. Native Kürzel nur für Akkorde mit Modifier oder F-Tasten (sonst fingen Menü-Kürzel Pfeile/Leertaste ab) |
| E9 | Kontextmenü am Cover | das `BookMenu` aus 004 bleibt (APG, `Shift+F10`/Menütaste/Rechtsklick), seine Einträge sind Aktionen mit Kürzeln |
| E10 | About | Dialog mit Name, Version, Plattform, Lizenz (MIT), Repo-Adresse als Text |
| E11 | Beenden | Command `quit_app` (`AppHandle::exit(0)`); Einstellungen bis 009 deaktiviert |

## Aktionen (Auszug)

| Kontext | Aktionen (Standard-Kürzel) |
|---|---|
| global | `app.palette` (Mod+Shift+P), `app.category.1…9` (Mod+1…9), `app.manageCategories`, `app.importConfig`, `app.generateThumbs`, `app.settings` (Mod+, – aus), `app.about`, `app.quit` (Mod+Q), `app.rescan` (Mod+R), `view.focusFilter` (Mod+F), `view.sizeUp/Down` (Mod++ / Mod+=, Mod+-), `view.sort.path/name/date/size`, `view.toTop/toBottom` |
| grid | `grid.left/right/up/down`, `grid.pageUp/Down`, `grid.home/end` (+ Mod+↑/↓), `grid.read` (Enter), `grid.menu` (Space, Shift+F10, ContextMenu), `grid.escape` (Esc), `book.openExternal` (Mod+O), `book.reveal` (Mod+Shift+R), `book.filterSeries`, `book.copyPath` (Mod+Shift+C); Tippen → Filter (Rückfall, keine Aktion) |
| reader | `reader.next` (↓ n Space PgDn), `reader.prev` (↑ b Shift+Space PgUp), `reader.right/left` (→ ←, Manga-gespiegelt), `reader.first/last` (Home End Mod+←/→/↑/↓), `reader.toggleMode` (s), `reader.toggleFit` (w), `reader.toggleRtl` (m), `reader.nextBook/prevBook` (] [), `reader.fullscreen` (F11 bzw. Mod+Ctrl+F), `reader.close` (Esc) |

`repeat: false` für Umschalter, Buchwechsel, Lesen, Schließen (gehaltene Taste wirkt einmal).

## Verträge

| Command | Parameter | Rückgabe | Fehler |
|---|---|---|---|
| `set_app_menu` | `spec: MenuSpec` | `void` (außer macOS: nichts) | `invalid_menu` (neu) |
| `load_keymap_overrides` | – | `{ bindings: Record<string, string[]>, warning: ConfigWarning \| null }` | – |
| `quit_app` | – | – | – |

Ereignis `menu-action` (`{ id }`) – das Frontend hört über `MenuApi.onAction` (einzige Stelle mit `listen`).
`MenuSpec = { menus: [{ label, items: [{ kind: 'action', id, label, accelerator?, enabled, checked? } | { kind: 'separator' } | { kind: 'submenu', label, items }] }] }`;
Rust prüft: ≤ 12 Menüs, ≤ 400 Einträge, Tiefe ≤ 3, Ids `^[a-z][A-Za-z0-9.]{0,63}$`, Texte ≤ 120 Zeichen,
Kürzel über `Accelerator::from_str` (ungültig → ohne Kürzel).

## Frontend

```
core/actions/   shortcut.ts (Parser, Akkord aus KeyboardEvent, Anzeige je OS), action-catalog.ts, keymap.*.json,
                keymap.ts (zusammenführen + Override), action.service.ts (Handler je Aktion, enabled/checked als
                Signals), keyboard-dispatcher.ts (der eine keydown-Listener), platform.ts
core/menu/      MenuApi (set_app_menu, menu-action, quit_app), KeymapApi (load_keymap_overrides)
features/menus/ menu-model.ts (rein), menu-bar.ts (HTML, APG menubar), native-menu.ts (Spec → Rust, entprellt),
                command-palette.ts, about-dialog.ts
```

Grid, Kategorie-Ansicht und Leser registrieren ihre Handler beim `ActionService` (mit `DestroyRef`) statt eigener
`keydown`-Listener.

## Tests

- Kürzel: Parser/Normalisierung (Mod je OS, Shift bei Satzzeichen, Space), Anzeige; Keymap: Zusammenführen,
  Override, Konflikte; Dispatcher: Kontexte, Eingabefeld (nur Mod), Button/Slider, Dialog offen, Wiederholung,
  Rückfall Tippen; Menümodell (rein: Einträge, Kürzel, Zustände, Kategorien); Palette (Suche, Enter, nur aktive);
  Menüleiste (Tastatur nach APG); Rust: Spec-Prüfung, Override-Datei.
- Ende-zu-Ende: HTML-Menüleiste (Linux), alle bisherigen Tasten im Grid und Leser, Palette, About. macOS nativ: nur
  auf dem Mac prüfbar.

## Ende-zu-Ende (Linux, Xvfb, Debug-Build, 1 001 Bücher)

- HTML-Menüleiste: `F10` fokussiert „File“, `→` `↓` öffnet „View“ mit Kürzeln und abgehakter Sortierung, „Bigger
  covers“ wirkt; Kategorie-Menü listet die Kategorien.
- Palette `Ctrl+Shift+P`, „about“ filtert auf „About Comic Commander“, `Enter` öffnet About (Version 0.1.0,
  linux · x86_64, MIT, Repo-Adresse).
- Grid: Klick/Pfeile bewegen den Cursor, `Shift+F10` öffnet das Buchmenü mit Kürzeln (Ctrl+O, Ctrl+Shift+R,
  Ctrl+Shift+C). **Fund:** WebKitGTK legte sein eigenes Kontextmenü (Back, Reload, Inspect Element) darüber → jetzt
  außer in Textfeldern unterdrückt (A41, roter Test zuerst).
- Tippen „ha“ → Filter (0 Treffer), `Esc` `Esc` zurück, `Enter` liest, `n` blättert, `s` fortlaufend, `]` nächstes
  Buch, `Esc` zurück ins Raster mit dem Cursor am zuletzt gelesenen Buch.
- macOS (natives Menü, ⌘-Kürzel, Main-Thread): **nur auf dem Mac prüfbar** – offen für Marc: Menü erscheint, Häkchen
  folgen dem Zustand, ⌘-Kürzel laufen genau einmal (WKWebView gibt `preventDefault`-te Tasten nicht ans Menü weiter),
  bei offenem Dialog passiert nichts.

## Review (eigener Agent, 23.10.2026)

| # | Befund | Schwere | Umgang |
|---|---|---|---|
| 1 | Natives Menü/⌘-Kürzel liefen bei offenem Dialog (Dialog ersetzt, Rescan, Buch hinter dem Modal) | hoch (macOS) | `MenuService.onAction` ignoriert Klicks bei offenem Dialog (außer Beenden); Test |
| 2 | muda schaltet Häkchen beim Klick selbst um; ohne Zustandsänderung kein Neuaufbau | mittel (macOS) | Zähler je Klick im Effekt → Menü wird nach jedem Klick neu gesetzt; Test |
| 3 | Manga: `Mod+←/→` nicht mehr gespiegelt (005-Regression) | mittel | `reader.leftEnd/rightEnd` (spiegeln mit `rtl`); Test über `wireKeyboard` – schon vor dem Review im E2E bemerkt |
| 4 | Kategorie-Titel mit Steuerzeichen → `invalid_menu` → gar kein Menü | mittel (macOS) | `menuLabel()` in `toSpec` (Steuerzeichen → Leerzeichen, ≤ 120 Zeichen); Rust bleibt streng; Test |
| 5 | Ansicht-/Kategorie-Aktionen (`Mod+F`, `Mod+=`, `Mod+R`, `Mod+1…`) liefen unter dem Leser | mittel | **Gate** im `ActionService` (`setGate`, gesetzt in `app.ts`): beim Lesen nur `reader.*` + Palette/About/Einstellungen/Beenden; Tasten fallen dann weiter; Test |
| 6 | Palette bot Grid-/Buch-Aktionen beim Lesen an | mittel | dasselbe Gate; Test |
| 7 | Palette: aktive Option nicht im Blick; Home/End gehören dem Textfeld | niedrig | `scrollIntoView({block:'nearest'})` per `afterRenderEffect`; Home/End entfernt |
| 8 | Kategorien/Sortierung sind `menuitemcheckbox` statt `menuitemradio`; `F10` im Filterfeld wirkungslos; „Lesen“ unter Windows/Linux immer grau | niedrig | `menuitemradio` (`isRadio`); F-Tasten wirken auch aus Textfeldern; „Lesen“ bleibt (Kürzel-Übersicht), `Alt` allein öffnet nicht (kollidiert mit AltGr) |
| 9 | `keymap.json`: Rust verwarf `Cmd+P`/`Shift+Mod+P`, die TS versteht | niedrig | Rust prüft nur noch Text (Länge, Steuerzeichen), TS normalisiert und meldet; Test |
| 10 | Shift+Pfeile im Grid, `N`/`B` im Leser wirkten nicht mehr; `[`/`]` auf deutscher Tastatur (Alt/AltGr) | niedrig | Shift-Varianten in `keymap.base.json`; `chordOf` ignoriert Alt/AltGr bei Satzzeichen; Test |
| 11 | Deaktivierte Aktion schluckt die Taste statt weiterzureichen | niedrig | bewusst: eine Taste mit Aktion im Kontext tut nichts anderes (Leer-Grid: `Enter` tippt nicht); gesperrte Aktionen (Gate) reichen weiter |
| 12 | `setFallback('grid', null)` beim Zerstören löschte ggf. den Rückfall eines neueren Grids | niedrig | `clearFallback(ctx, fn)` nur für den eigenen; Test |
| 13 | Beenden lief Rust → JS → `quit_app` (hängt die WebView, geht ⌘Q nicht) | niedrig | `on_menu_event` beendet bei `app.quit` direkt |

## Fortschritt

- [x] Phase 1 Design
- [x] Phase 2 Rust
- [x] Phase 3 Frontend
- [x] Phase 4 Ende-zu-Ende (Linux; macOS offen, s. o.)
- [x] Phase 5 Doku
- [x] Phase 6 Review + Abschluss
