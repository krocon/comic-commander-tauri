# Architektur – Comic Commander (Tauri)

> Überblick, Entscheidungen und Abhängigkeiten. Regeln für die Arbeit am Code: `CLAUDE.md` §4.
> Architektur-Vorbild: `files-and-folders-tauri` (gleicher Autor, MIT) – Abweichungen stehen hier unter
> „Entscheidungen“.

## Überblick

```
┌──────────────────────────── WebView (Angular 22, zoneless, Signals) ───────────────────────────┐
│ features/*  Komponenten (OnPush) + Stores: CategoriesStore (Root), CategoryStore (je Ansicht)  │
│ core/*      typisierte Fassaden CategoriesApi, ScanApi, AboutApi ── einzige Stelle mit         │
│             invoke(): core/backend/call.ts; der Channel für Scan-Ereignisse entsteht in ScanApi │
│ testing/    Fakes der Fassaden für Vitest                                                      │
└───────────────┬───────────────────────────────────────────────────────┬────────────────────────┘
                │ invoke (JSON, camelCase) + Channel<ScanEvent>          │ <img src="…">  (ab 003)
┌───────────────▼────────────── Rust (Tauri 2) ─────────────────────────▼────────────────────────┐
│ commands.rs   dünn: validieren, spawn_blocking, FsError; AppState (Kategorien, ScanHub)        │
│ categories.rs categories.json (sanitize, Ids)   legacy_import.rs  alte config.json → Vorschau │
│ scan.rs       Walk (rein)   scan_cache.rs  App-Cache + Diff   scan_hub.rs  ein Scan je Ziel    │
│ model.rs ↔ core/scan/scan.models.ts   categories.rs ↔ core/categories/categories.models.ts     │
│ error.rs ↔ core/errors/fs-error.ts    covers/ (003) reader/ (005) pdf/ (006) jobs/ (007)        │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
 Dateien:  <app config>/categories.json        <app cache>/scans/<fnv64(baseDir+Endungen)>.json
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
| A6 | Skelett-Liste rendert höchstens 500 Zeilen | Platzhalter bis zum virtualisierten Cover-Grid (004) | 001 |
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

## DTO-Vertrag

| Rust | TypeScript | Hinweis |
|---|---|---|
| `model::BookFormat` (`lowercase`) | `BookFormat` in `scan.models.ts` | `'cbz' \| 'cbr' \| 'cb7' \| 'cbt' \| 'pdf'` |
| `model::BookEntry` | `BookEntry` | `path` opak, `relPath` nur Anzeige/Filter/Sortierung |
| `model::ScanStats` | `ScanStats` | |
| `scan_hub::ScanEvent` (`tag = "kind"`) | `ScanEvent` | `cached`, `started`, `batch`, `progress`, `diff`, `done`, `cancelled`, `failed` |
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
| `vitest`, `jsdom`, `eslint`, `angular-eslint`, `typescript-eslint`, `prettier` | dev | Tests, Lint, Format | 001 |

Übernommen aus files-and-folders-tauri (MIT, gleicher Autor): `config_file.rs`, `fs_atomic.rs` (ohne `backup_copy`),
`shared/dialog/modal.ts` + `dialog.service.ts` (gekürzt).

Geplant (Entscheidung im jeweiligen Prompt): `zip`, `sevenz-rust2`, `tar`, `unrar-ng-sys` (003), `image` (003),
PDF-Renderer (006), `trash` (010).
