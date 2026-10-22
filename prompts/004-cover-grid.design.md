# Design 004 – Cover-Grid mit der GuiExpert Table

> Status: umgesetzt · freigegeben 22.10.2026 · Branch `feat/cover-grid`
> Auftrag: [`004-cover-grid.md`](004-cover-grid.md) (mit „Zielbild“ nach Marcs Screenshot) · Vorlage: legacy §6 ·
> Table: `CLAUDE.md` §5, `@guiexpert/table` 1.1.102 (Quellen im Mono-Repo gelesen)

## Entscheidungen auf einen Blick

| Nr. | Frage | Empfehlung |
|---|---|---|
| E1 | Titel unter dem Cover? | **Nein** (Zielbild): Name als Tooltip und für Screenreader; Titel-Option später in 009 |
| E2 | Größen | Stufen aus `thumbsDims` der Kategorie (Select „Thumb size“, `Ctrl/⌘ +/−` schaltet die Stufe); **randlos auf Fensterbreite gestreckt** (s. E6); Bilddatei nach Bedarf × `devicePixelRatio` (Retina → `_xl`) |
| E3 | Tippen im Grid | springt in den **Filter** (wie Vorlage); Schnellsuche à la Total Commander später |
| E4 | Sortierung | im Frontend vor dem Modell (`book-order.ts`, Daten liegen schon dort): Name (natürlich, Default), Ordner, Datum, Größe; je Kategorie gemerkt |
| E5 | „Mit Standard-App öffnen“ / „Im Finder zeigen“ | zwei schmale Commands mit **Kategorie-Id + Buch-Id** (Rust löst den Pfad über `BookRegistry` auf – kein Pfad vom Frontend); `open` crate bzw. `platform/desktop.rs::reveal` aus fnf (Argument-Arrays, keine Shell). Das ist eine bewusste, enge Ausnahme von „keine externen Programme“ (`open -R`, `explorer /select,`, D-Bus `ShowItems`) → CLAUDE.md §4 präzisieren |
| E6 | Spalten und Breite | `cols = max(1, floor(Breite / Stufenbreite))`, Coverbreite = `floor(Breite / cols)`, Höhe im Seitenverhältnis der Stufe → kein Streifen rechts (die Vorlage ließ bis zu einer Coverbreite frei) |
| E7 | Fokus/Cursor | eigenes Cursor-Modell im Store (Index in der gefilterten Liste) – der Cover-Grid-Modus hat kein Fokus-/Auswahlmodell (`CoverGridTableModel.getSelectionModel() = undefined`); Renderer setzt die Klasse, Scrollen per `scrollToPixel` |
| E8 | ARIA | Host `role="listbox"` + `aria-activedescendant` → gerenderte Zelle `role="option"` mit `id`, `aria-posinset/-setsize`, `aria-label` = Name; der Fokus-Eintrag ist immer gerendert, weil wir zu ihm scrollen |
| E9 | Ansichtszustand je Kategorie (Filter, Stufe, Sortierung, Position) | `localStorage` (Schlüssel je Kategorie-Id, try/catch, versioniert) – Bequemlichkeit, kein Datenverlust; Umzug in die Einstellungen (Rust) in 009 |
| E10 | Position merken | **Buch-Id des Fokus-Covers + erstes sichtbares Buch** statt Pixel (Pixel stimmen nach Größen-/Breitenwechsel nicht); Wiederherstellen beim Öffnen der Kategorie und nach dem Leser (005) |

## Bestand

| Baustein | wofür | Stand |
|---|---|---|
| `CoverGridFactory.createCoverGridModel(items, renderer, w, h, width, paddingTop)` | Modell | passt; `items`/`filteredItems` öffentlich |
| `bodyModel.externalFilterChanged(fn)` / `tableApi.externalFilterChanged()` | Filter | passt (Option `externalFilterFunction`) |
| `setParentWidth` + `recalcHeightAndPadding` + `repaintHard` | Breite | passt; Auslöser `ResizeObserver` statt `window:resize` |
| `bodyModel.coverWidth/coverHeight` | Größe | passt (E6 setzt beides) |
| Neue Bücher aus dem Scan | ohne Neuaufbau | `bodyModel.items = neu` + Filter neu anwenden + `recalcHeightAndPadding` + `repaint` – kein Core-Eingriff nötig |
| `TableSignalComponent` `[(tableApi)]`, `mouseClicked`, `contextMenu`, `scroll` | Ereignisse | passt; `GeMouseEvent` → Zeile/Spalte → Index `row × cols + col` |
| `scrollToPixel(x, y)`, `getYPosByRowIndex` | Cursor sichtbar halten, Position | passt |
| Fokus/Auswahl im Cover-Grid | Cursor | **fehlt** → E7 im Store |
| `getRowCount()` = `floor(n / cols) + 1` | Zeilen | **Lücke** (mono `TODO.md`: leere Extrazeile bei voller letzter Zeile, `Infinity` bei 0 Spalten) → wir halten `cols ≥ 1` (E6); Extrazeile hinnehmen, `// TODO(guiexpert)` |
| `CellRendererIf.render(cellDiv, row, col, area, model, value, dom)` | Renderer ohne Angular | passt; Aufräumfunktion als Rückgabe |
| fnf `opener.rs`, `platform/desktop.rs::reveal` | E5 | übernehmen (gekürzt: ohne Terminal, ohne `tools`) |
| fnf G1–G14 | Erfahrungen | G11 (`ResizeObserver` in jsdom), G12 (Debug-Log auf localhost) betreffen uns; Rest gilt der Zeilentabelle |
| 003: Cover-URL, Wiederholungen | Bilder | `CoversApi.coverUrl` + Fehlerlogik aus `CategoryView` → reine Klasse `CoverRetries` für den Renderer |
| 002: `CategoryStore`, `book-order.ts`, Kategorie-Menü | Daten, Sortierung, Menü | passt; Liste wird ersetzt |

## Oberfläche

```
┌───────────────────────────────────────────────────────────────────────────────┐  Toolbar schwebt
│ ☰ Comics ▾  [Filter …………… 12/584 ✕]  [Thumb size 200×300 ▾]  [Name ▾]  ↻  ⤒ ⤓ │  (halbtransparent,
├───────────────────────────────────────────────────────────────────────────────┤   backdrop-blur)
│▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓│  ← erste Zeile mit
│▓ Cover ▓│▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓│    firstRowPaddingTop
│▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓│╔══════╗│▓▓▓▓▓▓▓▓│ CBR    │▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓│    = Toolbar-Höhe
│▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓│║Fokus ║│▓▓▓▓▓▓▓▓│(Platzh.)▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓│
└───────────────────────────────────────────────────────────────────────────────┘
 Scan-Status/Fehler: schmales Band unter der Toolbar (aria-live), nur wenn es etwas zu sagen gibt
```

- Toolbar: Kategorie-Menü (002, mit ☰), Filter (Label „gefiltert / gesamt“, `✕` leert), „Thumb size“ (nur bei > 1
  Stufe, wie Vorlage), Sortierung, Neu scannen (002), nach oben / nach unten. Dunkler Grundton auch im hellen Schema
  (Cover sind bunt), Kontraste in beiden Schemata geprüft.
- Fokus-Reihenfolge: Menü → Filter → Größe → Sortierung → Neu scannen → oben → unten → Grid. `Tab` aus dem Grid
  zurück in die Toolbar.
- Aktions-Menü (Klick, `Space`, Kontextmenü): **Lesen** (005, bis dahin deaktiviert), **Mit Standard-App öffnen**,
  **Im Finder/Explorer zeigen**, **Serie filtern**, **Pfad kopieren** – Menü nach APG (wie das Kategorie-Menü),
  am Cover verankert, `Esc` zurück ins Grid. Doppelklick / `Enter` = Lesen (ab 005; bis dahin Standard-App).
- Leer/Ladezustände aus 002 bleiben (Erststart, „scanning…“, Fehler).

## Tastatur (macOS `⌘`, sonst `Ctrl`)

| Taste | Wirkung |
|---|---|
| `←↑→↓` | Cursor im Raster |
| `Home` / `End` | erstes / letztes Buch (auch `Mod+↑/↓`) |
| `PgUp` / `PgDn` | eine Bildschirmhöhe |
| `Enter` | Lesen (005) – bis dahin Standard-App |
| `Space`, `Shift+F10`, Kontextmenü-Taste | Aktions-Menü |
| Buchstabe/Ziffer | in den Filter springen, Zeichen übernehmen (E3) |
| `Esc` | Filter leeren (im Filter: leeren, dann zurück ins Grid) |
| `Mod +` / `Mod −` | nächste / vorige Größenstufe |
| `Mod+F` | Filter fokussieren |
| `Mod+R`, `Mod+1…9` | wie 002 |

Kürzel ruhen, solange ein Dialog offen ist (DialogService, 002).

## Filter und Serie (reine Funktionen)

- `filter-logic.ts`: `parseFilter(text) → { ors, musts, nots }`, `matches(key, parsed)`; Schlüssel = `filterKey(relPath)`
  (NFC, klein – 002) einmal je Buch vorberechnet. Verhalten wie `cc-overview-filter.service.ts` (Wörter ODER, `+` muss,
  `-` darf nicht; einzelne `+`/`-` ignoriert). Testkatalog `filter-logic.cases.json` mit den 13 Fällen der Vorlage +
  Umlaut NFC/NFD + Emoji. Entprellt 150 ms (Vorlage 333 ms – lokal schnell genug), Ziel < 50 ms bei 50 000 Büchern.
- `series-filter.ts`: `extractSeriesFilter(relPath)` wie Vorlage (Endung und Pfad weg, alles vor erster Zahl/` -`/` (`/
  `_<zahl>`, `_` → Leerzeichen, jedes Wort als `+wort`). Pfad-Segmente ermittelt Rust nicht – die Funktion arbeitet nur
  auf der **Anzeige** `relPath` (erlaubt: Anzeige/Filter, CLAUDE.md §4), Trenner `/` und `\`.

## Verträge

**Rust (neu)**

| Command | Parameter | Rückgabe | Fehler |
|---|---|---|---|
| `open_book_external` | `categoryId`, `bookId` | `void` | `unknown_book`, `not_found`, `io` |
| `reveal_book` | `categoryId`, `bookId` | `void` | `unknown_book`, `not_found`, `io` |

Neuer Code `unknown_book` (Buch nicht in der Registry, z. B. nach Neu-Scan gelöscht) in `error.rs`, `fs-error.ts`,
`describeFsError()`. Module: `opener.rs` (fnf, gekürzt: `check_openable` ohne Ausführbares-Erlauben, `open` crate),
`platform/desktop.rs` (nur `reveal`, `file_uri` + Tests). Neue Abhängigkeit: `open` 5 (fnf).

**Frontend**

- `core/books/books-api.ts`: `BooksApi.openExternal(cat, bookId)`, `reveal(cat, bookId)` + `FakeBooksApi`.
- `features/grid/`: `GridStore` (je Ansicht: sortierte + gefilterte Bücher, Filtertext, Stufe, Sortierung, Cursor,
  `cols`; reine Rechenfunktionen `grid-math.ts` für E6/E10 und Cursor-Bewegung), `cover-renderer.ts`
  (`CellRendererIf`, nur DOM-API, `textContent`), `cover-retries.ts` (aus 003), `CoverGrid` (Komponente mit
  `guiexpert-table-signal`, `ResizeObserver`), `GridToolbar`, `BookMenu`, `view-state.ts` (E9), `filter-logic.ts`,
  `series-filter.ts`, `grid-texts.ts`.
- `CategoryView` behält Erststart/Status/Fehler, ersetzt die Liste durch `CoverGrid`; `MAX_LIST_ROWS` entfällt.
- Ansichtszustand: `cc.view.<categoryId>` = `{ v: 1, filter, dimIndex, sort, focusId, topId }`; Filter beim ersten
  Öffnen = `initialFilter` der Kategorie.

## Tests

- **Rust:** Registry-Auflösung (unbekannt → `unknown_book`), `check_openable` (Ordner, fehlt), `file_uri` (fnf-Tests),
  `command_rules` für die zwei Commands. Das tatsächliche Öffnen nur Ende-zu-Ende (Mac).
- **Frontend (Vitest):** `filter-logic` + `series-filter` (Kataloge), `grid-math` (Spalten/Breite, Cursor an Rändern,
  `PgUp/PgDn`, Position aus Ids nach Breiten-/Filterwechsel), `GridStore` (Scan-Ereignisse inkl. Diff ohne
  Neuaufbau, Filter + Zähler, Sortierung, Stufe, veraltete Scans, Ansichtszustand speichern/laden, kaputter
  `localStorage`), `cover-renderer` (Escaping von `<img src=x onerror=…>`-Namen, Platzhalter, Fokus-Klasse, ARIA),
  `BookMenu` (Tastatur, Aktionen → Fake-API), `CoverGrid` mit Table-Doppelgänger, wo jsdom nicht reicht (G11).
- **Performance:** Fake-Scan mit 50 000 Büchern: Filter-Zeit (Vitest-Messung) und Scrollen im echten Fenster
  (Debug- und Release-Build im Container) → Zahlen in `docs/architecture.md`.
- **Ende-zu-Ende:** Testsammlung aus 003 + 50 000 leere Bücher (Spiegel): randlos, Größen, Filter `+asterix -album`,
  Serie filtern, Tastatur komplett, light/dark, Neustart → gleiche Stelle. Auf dem Mac (Marc): Standard-App, Finder.

## Offene Risiken

- Rendert die Table bei jedem Scroll-Schritt alle sichtbaren Zellen neu, entstehen viele `<img>`; die Bilder kommen
  aus dem WebView-Cache (`immutable`), der Renderer setzt `src` nur, wenn sich das Buch der Zelle ändert. Messen.
- `devicePixelRatio`-Wahl (E2) lädt auf Retina die `_xl`-Cover (200–300 KB) – bei 584 Büchern unkritisch, bei
  50 000 nur die sichtbaren (LIFO-Pool aus 003).

## Abweichungen bei der Umsetzung

- **E8 ARIA:** kein `role="listbox"` + `aria-activedescendant` – die Table setzt in jedem Zeichendurchgang
  `role="grid"` auf ihren Host und entfernt `aria-activedescendant` (der Cover-Grid-Modus hat kein Fokusmodell).
  Stattdessen sagt eine Live-Region (`aria-live="polite"`) das Fokus-Buch an („Name, 3 of 584“); der Host trägt
  `aria-label`. → Vorschlag für `mono/TODO.md`: Fokusmodell/ARIA im Cover-Grid.
- **Filter:** Der `GridStore` filtert selbst (Zähler, Cursor und Serie brauchen die Liste ohnehin) und gibt dem Modell
  die fertige Liste (`items = filteredItems`), statt `externalFilterFunction` + `externalFilterChanged()`.
- **Filter-Syntax:** nur das führende `+`/`-` wird entfernt (die Vorlage entfernte jedes `-`: `-spider-man` suchte
  `spiderman`). **Serie:** `_` bleibt wie in der Vorlage (`Die_alten_Knacker_08` → `+Die_alten_Knacker`).
- **Toolbar** ist die Toolbar der `CategoryView` (schwebt, sobald es Bücher gibt); Höhe `GRID_TOP` = 56 px =
  `firstRowPaddingTop`. Das Cover sitzt unten in seiner Zelle (Zeile 0 ist 56 px höher).
- **Table-Einstellungen:** `shortcutActionsDisabled`, `overflowY: 'scroll'` (Breite ohne Scrollbalken rechnen),
  `overlayOptions.autoNoRows: false` (eigene Hinweise), CSS-Variablen für Hintergrund, Rahmen und den eigenen
  Fokusrahmen der Table auf `transparent` (der Fokus-Zellrahmen der Table reichte über die ganze Zeile 0 bis in die
  Toolbar). Renderer-Stile (`.cc-cover`) stehen global in `styles.css` – verschachtelte Regeln unter `::ng-deep`
  bekommen sonst wieder das Komponenten-Attribut.
- **Nach Größen-/Breitenwechsel** bleibt das Fokus-Buch (sonst das oberste) im Blick (E10 erweitert).
- **Scan-Ereignisse in Teilen (Fund im E2E-Test):** Bei 50 000 Büchern brauchte das eine `cached`-Ereignis (11 MB)
  im Container rund 20 s durch die IPC (Debug-Build: Rust 0,7 s, Frontend 40 ms – der Rest ist Transport, ~0,5 MB/s;
  im Release-Build sind alle 50 000 nach 2,6 s da).
  Jetzt `cached` + `cachedMore` mit je ≤ 2000 Büchern (`complete` am letzten), große `diff` und späte Öffner ebenso
  in Teilen; das Frontend zeigt die Teile sofort (Reihenfolge von Rust) und sortiert einmal am Ende → erste Cover
  nach ~2 s. DTO geändert (Rust + TS + Tests). Zunächst hielt ich die eine große Nachricht für „hängengeblieben“ –
  das lag an zehn versehentlich parallel laufenden App-Instanzen im Test (`pkill -x` mit 14 von 15 Zeichen); mit
  einer Instanz kommt auch die große Nachricht an, nur langsam.
- **Test-Setup:** `src/test-setup.ts` (ResizeObserver-Doppelgänger für jsdom, fnf G11), in `angular.json`
  `test.options.setupFiles`.

## Fortschritt

- [x] Phase 1: Design – freigegeben 22.10.2026
- [x] Phase 2: Rust (zwei Commands, `opener`, `reveal`; Scan-Ereignisse in Teilen)
- [x] Phase 3: Frontend
- [ ] Phase 4: Ende-zu-Ende
- [ ] Phase 5: Doku
- [ ] Phase 6: Abschlussprüfung
