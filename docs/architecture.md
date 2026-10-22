# Architektur – Comic Commander (Tauri)

> Überblick, Entscheidungen und Abhängigkeiten. Regeln für die Arbeit am Code: `CLAUDE.md` §4.
> Architektur-Vorbild: `files-and-folders-tauri` (gleicher Autor, MIT) – Abweichungen stehen hier unter
> „Entscheidungen“.

## Überblick

```
┌──────────────────────────── WebView (Angular 22, zoneless, Signals) ───────────────────────────┐
│ features/*  Komponenten (OnPush) + Stores (Signals, je Ansicht im Komponenten-Provider)        │
│ core/*      typisierte Fassaden  LibraryApi, AboutApi, …  ── einzige Stelle mit invoke():     │
│             core/backend/call.ts                                                               │
│ testing/    Fakes der Fassaden für Vitest                                                      │
└───────────────┬───────────────────────────────────────────────────────┬────────────────────────┘
                │ invoke (JSON, camelCase)                              │ <img src="ccimg://…">  (ab 003)
┌───────────────▼────────────── Rust (Tauri 2) ─────────────────────────▼────────────────────────┐
│ commands.rs   dünn: validieren (paths.rs), spawn_blocking, FsError                             │
│ library.rs    Scan (rein, std)        covers/ (003)  reader/ (005)  pdf/ (006)  jobs/ (007)    │
│ model.rs ↔ src/app/core/library/library.models.ts   error.rs ↔ src/app/core/errors/fs-error.ts │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Kein HTTP-Server** wie in der Vorlage (legacy §1): Daten über Tauri-Commands, lange Läufe als Jobs mit
  `tauri::ipc::Channel`, Bilder (Cover, Seiten) über ein eigenes, asynchrones URI-Schema mit Tokens (ab Prompt 003).
- Das Frontend kennt **keine Dateisystemlogik**: Pfade sind opake Strings aus Rust.

## Entscheidungen

| Nr. | Entscheidung | Begründung | Prompt |
|---|---|---|---|
| A1 | Tauri 2 + Angular 22 (zoneless, Signals, Standalone, OnPush) + Rust, Struktur wie files-and-folders-tauri | gleiche Werkzeuge, Code und Rezepte wiederverwendbar | 001 |
| A2 | Kein Tauri-Plugin mit breitem Dateisystem-/Shell-Zugriff; jede Fähigkeit als schmaler Command | Sicherheit, Prüfbarkeit | 001 |
| A3 | Commands nie synchron (`async fn`), Test `commands::command_rules` | synchrone Commands laufen auf dem Main-Thread (files-and-folders 029 E11) | 001 |
| A4 | Scan folgt keinen symbolischen Links, überspringt versteckte Einträge und `._*` | Zyklen (legacy §10.1), `.Panels`-Sidecars sind keine Bücher | 001 |
| A5 | Natürliche Sortierung in Rust (`library::natural_cmp`) | `Band 2` vor `Band 10` (legacy §10.5) | 001 |
| A6 | Skelett-Liste rendert höchstens 500 Zeilen | Platzhalter bis zum virtualisierten Cover-Grid (004) | 001 |
| A7 | Dev-Server auf Port **1430** (files-and-folders: 1420) | beide Apps parallel entwickeln | 001 |
| A8 | Formate über die Endung: `cbz cbr cb7 cbt pdf`; Inhalt wird beim Lesen geprüft (003) | wie Vorlage, erweitert; „falsche“ Endungen (CBR = ZIP) erkennt erst der Leser | 001 |

Offene Entscheidungen stehen in den Prompts (Abschnitt „Entscheidungsfragen“) und wandern nach der Freigabe hierher.

## DTO-Vertrag

| Rust (`model.rs`) | TypeScript | Hinweis |
|---|---|---|
| `BookFormat` (`lowercase`) | `BookFormat` in `library.models.ts` | `'cbz' \| 'cbr' \| 'cb7' \| 'cbt' \| 'pdf'` |
| `BookEntry` | `BookEntry` | `path` opak, `relPath` nur Anzeige/Filter/Sortierung |
| `LibraryScan` | `LibraryScan` | `books` natürlich sortiert |
| `AppInfo` | `AppInfo` in `about.models.ts` | |
| `FsError { code, message, path }` | `FsError` in `fs-error.ts` | Codes `snake_case`; UI-Text nur aus `describeFsError()` |

## Commands

| Command | Parameter | Rückgabe | Fehler |
|---|---|---|---|
| `get_app_info` | – | `AppInfo` | – |
| `default_library_root` | – | `string` (`~/Comics` oder Home) | `no_home_directory` |
| `scan_library` | `root: string` | `LibraryScan` | `invalid_path`, `not_found`, `not_a_directory`, `permission_denied`, `io` |

## Abhängigkeiten

Neue npm-Pakete oder Crates nur mit Begründung in dieser Tabelle (CLAUDE.md §4).

| Paket | Seite | Wofür | Seit |
|---|---|---|---|
| `tauri`, `tauri-build`, `@tauri-apps/api`, `@tauri-apps/cli` | beide | Desktop-Gerüst | 001 |
| `serde`, `serde_json` | Rust | DTOs | 001 |
| `tempfile` (dev) | Rust | Tests mit echtem Dateisystem | 001 |
| `@angular/*` 22, `rxjs`, `tslib` | Frontend | UI | 001 |
| `@guiexpert/table` 1.1.102, `@guiexpert/angular-table` 22.1.102 | Frontend | Cover-Grid (ab 004; schon gepinnt) | 001 |
| `vitest`, `jsdom`, `eslint`, `angular-eslint`, `typescript-eslint`, `prettier` | dev | Tests, Lint, Format | 001 |

Geplant (Entscheidung im jeweiligen Prompt): `zip`, `sevenz-rust2`, `tar`, `unrar-ng-sys` (003), `image` (003),
PDF-Renderer (006), `trash` (010).
