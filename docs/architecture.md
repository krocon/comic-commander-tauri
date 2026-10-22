# Architektur – Comic Commander (Tauri)

> Überblick, Entscheidungen und Abhängigkeiten. Regeln für die Arbeit am Code: `CLAUDE.md` §4.
> Architektur-Vorbild: `files-and-folders-tauri` (gleicher Autor, MIT) – Abweichungen stehen hier unter
> „Entscheidungen“.

## Überblick

```
┌──────────────────────────── WebView (Angular 22, zoneless, Signals) ───────────────────────────┐
│ features/*  Komponenten (OnPush) + Stores: CategoriesStore (Root), CategoryStore (je Ansicht)  │
│ core/*      Fassaden CategoriesApi, ScanApi, CoversApi, BooksApi, AboutApi ── einzige Stelle   │
│             mit invoke(): core/backend/call.ts; Channel in ScanApi; Cover-URLs in CoversApi    │
│ testing/    Fakes der Fassaden für Vitest                                                      │
└───────────────┬───────────────────────────────────────────────────────┬────────────────────────┘
                │ invoke (JSON, camelCase) + Channel<ScanEvent>          │ <img src="cccover://…">
┌───────────────▼────────────── Rust (Tauri 2) ─────────────────────────▼────────────────────────┐
│ commands.rs   dünn: validieren, spawn_blocking, FsError; AppState (Kategorien, ScanHub)        │
│ categories.rs categories.json (sanitize, Ids)   legacy_import.rs  alte config.json → Vorschau │
│ scan.rs       Walk (rein)   scan_cache.rs  App-Cache + Diff   scan_hub.rs  ein Scan je Ziel    │
│ model.rs ↔ core/scan/scan.models.ts   categories.rs ↔ core/categories/categories.models.ts     │
│ error.rs ↔ core/errors/fs-error.ts    book_registry.rs  Buch-Ids der Scans → Pfade             │
│ book/   ZIP/RAR/7z/TAR nach Inhalt, Liste + ein Eintrag mit Grenzen (RAR: unrar-ng-sys, FFI)   │
│ cover/  Wahl, Decoder, Sidecars, Plattencache, LIFO-Pool, Schema cccover    reader/ (005) …    │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
 Dateien:  <app config>/categories.json        <app cache>/scans/<fnv64(baseDir+Endungen)>.json
           <app cache>/covers/<xx>/<fnv64(Pfad, Größe, mtime, B×H)>.jpg
```

- **Kein HTTP-Server** wie in der Vorlage (legacy §1): Daten über Tauri-Commands, lange Läufe mit
  `tauri::ipc::Channel`, Bilder (Cover, Seiten) über ein eigenes, asynchrones URI-Schema mit Tokens (ab Prompt 003).
- Das Frontend kennt **keine Dateisystemlogik**: Pfade sind opake Strings aus Rust.
- **Nichts in den Comic-Ordnern**: Konfiguration im App-Config-, Scan-Ergebnisse im App-Cache-Ordner
  (macOS `~/Library/Application Support/…` bzw. `~/Library/Caches/io.github.krocon.comiccommander`).

## Entscheidungen

| Nr. | Entscheidung | Begründung | Prompt |
|---|---|---|---|
| A1 | Tauri 2 + Angular 22 (zoneless, Signals, Standalone, OnPush) + Rust, Struktur wie files-and-folders-tauri | gleiche Werkzeuge, Code und Rezepte wiederverwendbar | 001 |
| A2 | Kein Tauri-Plugin mit breitem Dateisystem-/Shell-Zugriff; jede Fähigkeit als schmaler Command | Sicherheit, Prüfbarkeit | 001 |
| A3 | Commands nie synchron (`async fn`), Test `commands::command_rules` | synchrone Commands laufen auf dem Main-Thread (files-and-folders 029 E11) | 001 |
| A4 | Scan überspringt versteckte Einträge und `._*`; Ordner-Symlinks nie, Datei-Symlinks ja (002 E2) | Zyklen (legacy §10.1), `.Panels`-Sidecars sind keine Bücher | 001, 002 |
| A5 | Natürliche Sortierung: Rust `scan::natural_cmp` nur für deterministischen Cache; Anzeige im Frontend mit `Intl.Collator` (numeric, base) | `Band 2` vor `Band 10`; NFC = NFD (002 E6) | 001, 002 |
| A6 | ~~Skelett-Liste rendert höchstens 500 Zeilen~~ → ersetzt durch das Cover-Grid (A23) | – | 001, 004 |
| A7 | Dev-Server auf Port **1430** (files-and-folders: 1420) | beide Apps parallel entwickeln | 001 |
| A8 | `BookFormat` = Containerart nach Endung (`.zip` → `cbz` …); Inhalt prüft der Leser (003) | „falsche“ Endungen (8 × CBR = ZIP bei Marc) | 001, 002 |
| A9 | **Kategorien** wie die Vorlage (`baseDir`, `bookExtensions` je Kategorie, `title`, `icon`, `thumbsDims`, `dimIndex`, `initialFilter` + `id`), zur Laufzeit verwaltet | Marcs Konfiguration: „Comics“ (`.cbz/.cbr`) und „Make“ (`.pdf`) | 002 E10 |
| A10 | Endungen je Kategorie aus der Liste lesbarer Formate (`.cbz .cbr .cb7 .cbt .pdf .zip .rar .7z .tar`), ohne Groß-/Kleinschreibung | Vorlage verglich exakt und erlaubte Unlesbares | 002 E3 |
| A11 | Ordner-/Dateidialog über die **Rust-API** von `tauri-plugin-dialog`; keine `dialog:`-Capability | die WebView kann keine Dialoge öffnen, Pfade gehen durch `validate_input_path` | 002 E1 |
| A12 | Scan-Cache als JSON je Ziel (`baseDir` + Endungen) im App-Cache; stale-while-revalidate; nur vollständige Scans schreiben; `save_categories` räumt Caches entfernter Ziele weg | Messung unten; legacy §3/§10.2 | 002 E5 |
| A13 | `ScanHub`: ein Scan je Ziel auf eigenem Thread, max. 4 parallel, späte Öffner hängen sich an (bekommen die bisherigen Bücher als ein Batch); Wechsel der Kategorie bricht nicht ab | legacy §3 `runningScansPromises`; Cache wird trotzdem fertig | 002 E9 |
| A14 | Import der alten `config.json`: Vorschau mit Hinweisen, gespeichert wird erst nach Bestätigung; Material-Icons → Font Awesome | nichts ohne Bestätigung ändern; Marcs zwei Kategorien in einem Schritt | 002 E7, E4 |
| A15 | Font Awesome 4.5.0 (nur `woff2`) wie files-and-folders | einheitlich, Lizenz geprüft | 002 E4 |
| A16 | Ordner-Überwachung verschoben; Neu-Scan beim Öffnen + `Mod+R` | Netzlaufwerke melden Änderungen unzuverlässig | 002 E8 |
| A17 | Cover über das asynchrone URI-Schema **`cccover`**, Pfad `/<Kategorie-Id>.<Buch-Id>.<dimIndex>?v=<mtime>`; die Buch-Id (`fnv64(Pfad)`) kommt aus dem Scan, `BookRegistry` kennt nur gelistete Bücher – kein Vorab-`invoke`, kein Pfad in der URL | kein Base64 über IPC, nichts außerhalb der Kategorien auslieferbar | 003 E1 |
| A18 | Containerart nach **Inhalt** (Magic Bytes); ZIP `zip`, TAR `tar`, 7z `sevenz-rust2` hinter fnfs fail-closed Header-Prüfung, RAR über UnRAR (`unrar-ng-sys`, einziges `unsafe`); Grenzen: 200 000 Einträge, ZIP-Verzeichnis ≤ 64 MiB (vor dem Parsen geprüft), 64 MiB je Eintrag, Wörterbuch ≤ 256 MiB, ≤ 512 MiB vor der Titelseite überspringen (solid), 20 s je Buch, Bilder ≤ 16 384 px / 64 MP | 8 × CBR = ZIP bei Marc; Bücher sind feindlich | 003 E6, E7 |
| A19 | Titelseite: Bilder ohne versteckte/`__MACOSX`; `cover.` im Namen → weniger Ordnerebenen → natürliche Reihenfolge | Vorlage + natürliche Sortierung | 003 E8 |
| A20 | Alte Sidecars (`Band.jpg`, `Band_xl.jpg` …) werden **gelesen**, nie geschrieben; erzeugte Cover als JPEG q80 im App-Cache (Grenze 2 GiB, älteste zuerst weg); bleibende Fehler (kein Bild, kaputt, verschlüsselt …) je Sitzung gemerkt, Zeitlimit/I/O nicht | nichts in die Comic-Ordner (legacy §10.2) | 003 E4, E5 |
| A21 | Eigener Cover-Pool: min(4, Kerne − 1) Threads, **LIFO**, gleiche Schlüssel zusammengelegt, > 2 000 wartende → älteste 503 | sichtbare Cover zuerst nach schnellem Scrollen | 003 E9 |
| A22 | Status: 404 kein Bild/unbekannt, 415 Format (PDF bis 006), 422 kaputt/verschlüsselt/zu groß/Zeitlimit, 503 voll, 500 Panik; 200 mit `immutable`, sonst `no-store` | Frontend zeigt bei Fehler das Format-Kürzel und fragt nach 2 s/4 s noch zweimal (`&retry=n`) | 003 E10 |
| A23 | **Cover-Grid**: GuiExpert `CoverGridTableModel`, einmal gebaut, Daten über `bodyModel.items`; Renderer ohne Angular (`.cc-cover`, global gestylt); randlos: `cols = floor(B / Stufe)`, Coverbreite `floor(B / cols)`; Toolbar schwebt (`GRID_TOP` = `firstRowPaddingTop` = 56 px) | Zielbild (Marcs Screenshot), 50 000 Bücher flüssig | 004 E6 |
| A24 | Eigener Cursor im `GridStore` (Buch-Id), Tastatur im Capture-Listener des Grids, Table-Shortcuts aus; Screenreader über Live-Region | Cover-Grid der Table hat kein Fokusmodell und setzt `aria-activedescendant` zurück | 004 E7, E8 |
| A25 | Filter/Sortierung/Größe im `GridStore` (rein: `filter-logic`, `series-filter`, `grid-math`, `sortBooksBy`); Ansichtszustand je Kategorie in `localStorage` (`cc.view.<id>`, v1), Position als Buch-Ids | Pixel stimmen nach Größenwechsel nicht; Einstellungen ziehen in 009 nach Rust | 004 E4, E9, E10 |
| A26 | Bücher außerhalb der App nur über Kategorie-Id + Buch-Id (`open_book_external`, `reveal_book`); Pfad aus der `BookRegistry`; Dateimanager per Argument-Array (`/usr/bin/open -R`, `explorer.exe /select,`, D-Bus `ShowItems`) – enge Ausnahme von „keine externen Programme“ | kein Pfad aus der WebView | 004 E5 |
| A27 | Scan-Ereignisse mit Büchern in Teilen ≤ 2000 (`cached` + `cachedMore`, große `diff`, späte Öffner); Frontend zeigt Cache-Teile sofort (außer beim Neu-Scan derselben Kategorie), sammelt Diff-Teile bis `done` und sortiert einmal | 11 MB in einer Nachricht ~20 s im Debug-Build; erste Cover nach ~2 s | 004 |

## DTO-Vertrag

| Rust | TypeScript | Hinweis |
|---|---|---|
| `model::BookFormat` (`lowercase`) | `BookFormat` in `scan.models.ts` | `'cbz' \| 'cbr' \| 'cb7' \| 'cbt' \| 'pdf'` |
| `model::BookEntry` | `BookEntry` | `path` opak, `relPath` nur Anzeige/Filter/Sortierung, `id` = `fnv64(path)` hex (003; Scan-Cache `VERSION = 2`) |
| `model::ScanStats` | `ScanStats` | |
| `scan_hub::ScanEvent` (`tag = "kind"`) | `ScanEvent` | `cached` (+`complete`), `cachedMore`, `started`, `batch`, `progress`, `diff`, `done`, `cancelled`, `failed`; Bücher je Ereignis ≤ `MESSAGE_BOOKS` (2000) |
| `categories::{Category, ThumbsDim, CategoriesConfig, CategoriesLoaded}` | `categories.models.ts` | Feldnamen wie die alte `config.json` |
| `legacy_import::{LegacyImport, ImportNote}` | `categories.models.ts` | `ImportNote.index = null` = Kategorie ausgelassen |
| `config_file::ConfigWarning` | `ConfigWarning` | `broken` / `unreadable` |
| `model::AppInfo` | `AppInfo` in `about.models.ts` | |
| `FsError { code, message, path }` | `FsError` in `fs-error.ts` | Codes `snake_case`; UI-Text nur aus `describeFsError()` |

Die Listen `SUPPORTED_EXTENSIONS`, `DEFAULT_EXTENSIONS`, `ICONS` stehen in `categories.rs` und `category-form.ts`;
`category-form.spec.ts` vergleicht sie mit der Rust-Quelle.

## Commands

| Command | Parameter | Rückgabe | Fehler |
|---|---|---|---|
| `get_app_info` | – | `AppInfo` | – |
| `default_comics_dir` | – | `string \| null` (`~/Comics`, nur wenn vorhanden) | – |
| `load_categories` | – | `CategoriesLoaded` | – (Probleme als `warning`) |
| `save_categories` | `config` | `CategoriesConfig` (bereinigt, Ids/Titel vergeben) | `invalid_categories`, `io` |
| `pick_folder` | `start?` | `string \| null` | `invalid_path`, `not_found` |
| `import_legacy_config` | – | `LegacyImport \| null` | `invalid_legacy_config`, `io` |
| `open_category` | `id`, `onEvent: Channel<ScanEvent>` | `void` (alles weitere als Ereignis) | `unknown_category` |
| `cancel_scan` | `id` | `void` | – |
| `open_book_external` | `categoryId`, `bookId` | `void` | `unknown_book`, `not_found`, `io` |
| `reveal_book` | `categoryId`, `bookId` | `void` | `unknown_book`, `not_found`, `program_not_found`, `io` |

**URI-Schema `cccover`** (kein Command, A17): `convertFileSrc('<cat>.<book>.<dim>', 'cccover')` + `?v=<mtime>` →
`cccover://localhost/…` (macOS/Linux) bzw. `http://cccover.localhost/…` (Windows). Antwort `image/jpeg`/`image/png`
oder Status nach A22. CSP: `img-src 'self' data: cccover: http://cccover.localhost`.

## Messungen

**Scan (Design 002, 22.10.2026)** – Container (2 Kerne, ext4), Release-Build,
`cargo test --release --lib -- --ignored --nocapture measure`: 50 000 leere `.cbr` in 2 500 Ordnern.

| Schritt | Zeit | Größe |
|---|---|---|
| Erstscan inkl. Sortieren + Cache schreiben | 0,52 s | Cache-Datei 11,5 MB |
| Cache lesen + prüfen | 30 ms | |
| Ereignis `cached` serialisieren | 25 ms | 11,5 MB JSON über den Channel |

JSON reicht (Schwelle 300 ms aus E5). Marcs Sammlung „Comics“ (584 Bücher, Spiegel aus leeren Dateien mit
denselben Namen): Erstscan und Anzeige < 1 s im Debug-Build. Netzlaufwerke: noch nicht gemessen (Mac).

**Cover (Design 003, 22.10.2026)** – Container, Release-Build, `CC_REAL_BOOKS=<dir> cargo test --release --lib --
--ignored --nocapture real_books`, drei echte Bücher aus Marcs Sammlung (nur im Scratch-Ordner):

| Buch | erstes Cover 200×300 | aus dem Cache | 800×1200 (`_xl`) |
|---|---|---|---|
| RAR4 (Goofy Magazin, 18 MB) | 38 ms | 0,05 ms | 113 ms |
| ZIP als CBR | 84 ms | 0,05 ms | 140 ms |
| RAR5 | 77 ms | 0,05 ms | 165 ms |

Cover 200×300 ≈ 10–25 KB, `_xl` ≈ 200–300 KB (mehr als die geschätzten 120 KB; 2 GiB reichen trotzdem für > 7 000
`_xl`-Cover). Im Debug-Build dauert ein RAR-Cover 1–3 s – im Fenster zuerst das Format-Kürzel, dann das Cover.

**Cover-Grid (Design 004, 22.10.2026)** – Container, Xvfb, 50 000 leere `.cbz` in 2 500 Ordnern:

| Schritt | Debug-Build | Release-Build |
|---|---|---|
| Neustart mit Cache: erste 2 000 Bücher sichtbar | ~2 s | 2,3 s (Fenster nach 1,7 s) |
| alle 50 000 Bücher (25 Teile) | ~21 s | 2,6 s |
| Hintergrund-Scan fertig | ~22 s | 2,9 s |

Filter über 50 000 Bücher (Vitest, `filter-logic.perf.spec.ts`) deutlich < 50 ms; 30 × Bild-ab in 1,3 s inkl.
`xdotool` (Debug); `Ctrl+End` sofort. Im Debug-Build ist der IPC-Transport der Engpass (~0,5 MB/s; Rust 0,7 s,
Frontend 40–60 ms je Ereignis). Auf dem Mac nachmessen.

## Abhängigkeiten

Neue npm-Pakete oder Crates nur mit Begründung in dieser Tabelle (CLAUDE.md §4).

| Paket | Seite | Wofür | Seit |
|---|---|---|---|
| `tauri`, `tauri-build`, `@tauri-apps/api`, `@tauri-apps/cli` | beide | Desktop-Gerüst | 001 |
| `serde`, `serde_json` | Rust | DTOs, Konfig, Cache | 001 |
| `tempfile` (dev) | Rust | Tests mit echtem Dateisystem | 001 |
| `tauri-plugin-dialog` 2 (nur Rust-API, **keine** Capability) | Rust | nativer Ordner-/Dateidialog (A11) | 002 |
| `@angular/*` 22, `rxjs`, `tslib` | Frontend | UI | 001 |
| `@guiexpert/table` 1.1.102, `@guiexpert/angular-table` 22.1.102 | Frontend | Cover-Grid (ab 004; schon gepinnt) | 001 |
| Font Awesome 4.5.0 (Assets `src/assets/font-awesome-4.5.0/`, CSS MIT, Font SIL OFL 1.1) | Frontend | Icons (A15) | 002 |
| `zip` 9 (`deflate-flate2`) | Rust | CBZ und ZIP-als-CBR lesen | 003 |
| `tar` 0.4 | Rust | CBT lesen | 003 |
| `unrar-ng-sys` =0.7.7 (vendierte UnRAR-Quellen, C++, unRAR-Lizenz → `docs/licenses.md` in 012) | Rust | CBR (RAR4/RAR5), einziges FFI | 003 |
| `sevenz-rust2` 0.24 (`bzip2`, `ppmd`), `lzma-rust2` 0.23, `crc32fast` | Rust | CB7, fail-closed Header-Prüfung aus fnf | 003 |
| `image` 0.25 (`jpeg png gif webp bmp`) | Rust | dekodieren mit Limits, verkleinern, JPEG | 003 |
| `open` 5 (wie fnf) | Rust | Buch mit der Standard-App öffnen (`that_detached`, ohne Shell) | 004 |
| `vitest`, `jsdom`, `eslint`, `angular-eslint`, `typescript-eslint`, `prettier` | dev | Tests, Lint, Format | 001 |

Übernommen aus files-and-folders-tauri (MIT, gleicher Autor): `opener.rs`, `platform/desktop.rs` (nur `reveal`, 004),
`config_file.rs`, `fs_atomic.rs` (ohne `backup_copy`),
`shared/dialog/modal.ts` + `dialog.service.ts` (gekürzt), `book/rar.rs`, `book/sevenz_header.rs`, Teile von
`book/sevenz.rs` (ohne Passwörter) und die Archiv-Testdateien unter `src-tauri/testdata/archives/`.

Geplant (Entscheidung im jeweiligen Prompt): PDF-Renderer (006), `trash` (010).
