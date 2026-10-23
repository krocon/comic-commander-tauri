# CLAUDE.md – Comic Commander (Tauri)

> Leitfaden für Claude (und Menschen) zur Arbeit an **Comic Commander**: einem Comic-Browser für macOS, Windows und
> Linux, der eine Comic-Sammlung (CBZ, CBR, CB7, CBT, PDF) als **Raster aus Cover-Thumbnails** zeigt und die Bücher in
> einem eingebauten Leser öffnet.
> Autor: Marc Kronberg · Repo: https://github.com/krocon/comic-commander-tauri · MIT
>
> Neuauflage des Comic-Servers **comiccommander** (Angular 22 + NestJS, lokal `~/WebstormProjects/comiccommander`)
> als **Desktop-App**: Tauri 2 + Angular 22 (zoneless, Signals) + Rust. Architektur wie
> **files-and-folders-tauri** (`~/WebstormProjects/files-and-folders-tauri`, gleicher Autor, MIT). Das Cover-Raster ist
> eine **GuiExpert Table** im Cover-Grid-Modus (`@guiexpert/table`, Mono-Repo `guiexperttable/mono`, gleicher Autor).

---

## 1. Stand

- **Prompt 001 (Grundgerüst)** und **Prompt 002 (Kategorien + Scan-Cache)** sind fertig: Kategorien wie in der alten
  `config.json` (`baseDir`, `bookExtensions`, `thumbsDims`, …) zur Laufzeit verwalten, alte Konfiguration importieren,
  Scan in Rust mit Cache im App-Cache (stale-while-revalidate), Kategorie-Menü, Liste der Bücher (Platzhalter für das
  Cover-Grid). Design: `prompts/done/002-kategorien-scan.design.md`.
- **Prompt 003 (Cover)** ist fertig: Bücher nach Inhalt lesen (ZIP/RAR/7z/TAR, Grenzen), Titelseite wählen, alte
  Sidecars lesen, Thumbnails im App-Cache, LIFO-Pool, URI-Schema `cccover`; die Liste zeigt kleine Cover. Design:
  `prompts/done/003-cover-thumbnails.design.md`.
- **Prompt 004 (Cover-Grid)** ist fertig: GuiExpert Cover-Grid randlos mit schwebender Toolbar (Filter `+/-`,
  Größe, Sortierung), eigener Cursor + Tastatur, Aktionsmenü (Standard-App, Finder, Serie filtern, Pfad kopieren),
  Ansichtszustand je Kategorie, Scan-Ereignisse in Teilen. Design: `prompts/done/004-cover-grid.design.md`.
- **Prompt 005 (Leser)** ist fertig: Seiten direkt aus dem Buch (ZIP/TAR/nicht-solides RAR) bzw. einmal in den
  App-Cache entpackt (7z, solides RAR), Schema `ccpage` mit Token, Einzelseite/fortlaufend, Manga, Vollbild,
  Lesestand in `reading-state.json` + Balken am Cover. Design: `prompts/done/005-leser.design.md`.
- **Prompt 006 (PDF)** ist fertig: `pdf/` mit `hayro` (reines Rust), Cover und Leser-Seiten, Schnellweg für Scan-PDFs
  (eingebettetes JPEG), Render-Threads mit Grenzen. Design: `prompts/done/006-pdf.design.md`.
- **Prompt 007 (Thumbnails im Stapel)** ist fertig: schlanke Job-Engine `jobs/` (ein Lauf je Art, Pause, Abbruch,
  Drosselung), fehlende Cover aller Größen mit niedriger Decoder-Priorität, Dialog + Toolbar-Anzeige. Design:
  `prompts/done/007-thumbs-generieren.design.md`.
- **Prompt 008 (Aktionen, Menü, Tastatur)** ist fertig: Aktionskatalog + `ActionService`, ein `KeyboardDispatcher`,
  Keymaps je OS (JSON) + Override `keymap.json`, ein Menümodell (macOS nativ über `set_app_menu`, sonst HTML-Menüleiste
  nach APG), Befehlspalette, About. Design: `prompts/done/008-aktionen-menue-tastatur.design.md`.
- **Prompt 014 (Zoom, Drehen, Leser-Toolbar)** ist fertig: Fit width/height/page, Full size, freier Zoom (Regler,
  `+`/`-`, Mausrad), Drehen je Buch (CSS, Lesestand), Zeilen-Lesen großer Seiten, dezente Toolbar mit Zoom-Menü in
  schmalen Fenstern, Aus-/Einblenden über die Zone oben. Design: `prompts/done/014-zoom-modi.design.md`.
- **Prompt 011 (Metadaten, Serien, Ordner)** ist fertig: `comic_info.rs` liest `ComicInfo.xml` (quick-xml, Grenzen) in
  einer Phase `meta` nach dem Scan, Metadaten im Scan-Cache (v3); im Frontend Serie/Nummer aus ComicInfo oder Name
  (`book-info.ts` + Katalog), Ansichten flach/Serie/Ordner im selben Grid (`grouping.ts`, Ebenen, Breadcrumb), Filter
  `series:`/`year:`/`writer:`/`publisher:`, Sortierung „Serie“, Manga aus ComicInfo. Design:
  `prompts/done/011-metadaten-serien.design.md`.
- Als Nächstes: **009** (Einstellungen, i18n). Reihenfolge und Status: `prompts/README.md`.
- **Fachliche Vorlage/SOLL:** `docs/legacy-analysis.md` („legacy §N“) – Analyse von comiccommander. Abweichungen
  (Desktop statt Server, Cache nicht in die Comic-Ordner, kein Shell-Aufruf, natürliche Sortierung) sind dort in §10
  begründet.
- Weiterentwicklung über **Feature-Prompts** in `prompts/` (gemeinsame Regeln: `prompts/000-arbeitsweise.md`);
  erledigte Prompts samt Design-Dokument liegen in `prompts/done/`. Kürzel wie „003 E4“ im Code verweisen auf
  Entscheidungen in den Design-Dokumenten.

## 2. Befehle (Root, pnpm 10 via `packageManager`, Node ≥ 22.22.3, Rust stable ≥ 1.93)

| Zweck | Befehl |
|---|---|
| Install | `pnpm install` |
| App starten (Dev) | `pnpm tauri dev` (Angular-Dev-Server auf **Port 1430** + Fenster) |
| Nur Frontend im Browser | `pnpm start` (kein Backend → Hinweis „desktop backend is not available“) |
| Frontend-Tests | `pnpm test` (Vitest + jsdom über `ng test`), `pnpm test:watch` |
| Lint / Format | `pnpm lint`, `pnpm format`, `pnpm format:check` |
| Frontend-Build | `pnpm build` |
| Rust | `pnpm rust:fmt`, `pnpm rust:lint` (clippy `-D warnings`), `pnpm rust:test` |
| Alles prüfen | `pnpm check` |
| Debug-App ohne Bundle | `pnpm tauri build --debug --no-bundle` → `src-tauri/target/debug/comic-commander-tauri` |
| Icons neu erzeugen | `pnpm tauri icon src-tauri/icons/source/app-icon.svg -o src-tauri/icons` (danach `android/`, `ios/` löschen) |
| Release-Build | `pnpm tauri build` (Signierung/Notarisierung: Prompt 012) |

Nicht ausführbare Checks im Abschlussbericht mit Grund nennen. `pnpm tauri dev` braucht ein Fenster – in einer
Container-Sitzung ohne Display: Debug-Build und die Binary unter `Xvfb` starten (Screenshot mit
`import -window root`, Tasten mit `xdotool`), s. §9.

## 3. Layout

```
src/                          Angular 22 (zoneless, Signals, OnPush, Standalone)
  main.ts, index.html
  styles.css                  Design-Tokens light/dark (einzige Stelle für Farben/Größen), .btn/.input, FA-Import
  assets/font-awesome-4.5.0/  Font Awesome 4.5.0 (nur woff2), wie files-and-folders
  app/app.ts, app.config.ts   Root: Kategorie-Ansicht + Dialoge (@switch DialogService.open); Fassaden-Bindung
  app/core/backend/call.ts    einzige Stelle mit invoke() (+ isTauri-Prüfung, Fehler → FsError)
  app/core/errors/            FsError, toFsError, describeFsError (Codes = Rust error.rs)
  app/core/categories/        DTOs (= Rust categories.rs/legacy_import.rs), CategoriesApi
  app/core/scan/              DTOs (= Rust model.rs/scan_hub.rs: BookEntry, ScanStats, ScanEvent), ScanApi (Channel)
  app/core/about/             AppInfo, AboutApi
  app/core/covers/            CoversApi: Cover-URL (Schema cccover, `<cat>.<book>.<dim>?v=<mtime>`)
  app/core/books/             BooksApi: Buch mit Standard-App öffnen / im Dateimanager zeigen (nur Ids)
  app/core/reader/            ReaderApi: open/close (Token, Channel ReaderEvent), pageUrl (Schema ccpage), Lesestand,
                              Vollbild; DTOs = Rust reader/model.rs, reading_state.rs
  app/features/categories/    CategoriesStore (Root: Konfig, aktive Kategorie, Import), category-form.ts (rein: Listen
                              = Rust, Prüfung), Dialog „Manage categories“, ImportDialog, Texte
  app/features/category/      CategoryStore (je Ansicht, ereignisgetrieben, Cache in Teilen), CategoryView (schwebende
                              Toolbar: Menü, Filter, Größe, Sortierung; Status, Hinweise, Erststart), CategoryMenu
                              (Menü-Button nach APG), book-order.ts (Intl.Collator, Sortierarten, NFC-Filterschlüssel)
  app/features/grid/          Cover-Grid (004): GridStore (Filter, Sortierung, Größe, Cursor, Aktionen, Ansichtszustand),
                              CoverGrid (TableSignalComponent, Tastatur, Live-Region), cover-renderer.ts (DOM, .cc-cover
                              in styles.css), BookMenu, rein: filter-logic (+ .cases.json, Felder series:/year:),
                              book-info (Serie/Nummer, + .cases.json), grouping (Ansichten, Ebenen), grid-math,
                              view-state (v2), cover-retries
  app/core/actions/           Aktionen (008): action-catalog (Ids, Kontexte, Texte), keymap.{base,mac,other}.json +
                              keymap.ts (Override), shortcut.ts (Akkord/Anzeige je OS), ActionService (Handler,
                              enabled/checked), KeyboardDispatcher (der eine keydown-Listener), platform.ts (OS-Token)
  app/core/menu/              MenuApi (set_app_menu, Ereignis menu-action, quit_app), KeymapApi (load_keymap_overrides)
  app/features/menus/         menu-model (rein: Menüs je OS), MenuService (nativ entprellt / HTML), MenuBar (APG),
                              CommandPalette (APG-Combobox), AboutDialog, AppActions (globale Aktionen), Texte
  app/core/jobs/              JobsApi (Channel JobEvent), DTOs = Rust jobs/thumbs.rs
  app/features/jobs/          ThumbsJobStore (Root), GenerateThumbsDialog, job-time (rein), Texte
  app/features/reader/        Leser (005): ReaderService (Root: Sitzung = Buchliste + Index, Lesestände, closedOn),
                              ReaderStore (je Leser: Buch, Seite, Größen, Einstellungen, Position speichern), Reader
                              (Ebene über der Kategorie-Ansicht, Aktionen im Kontext `reader`), ZoomMenu (APG, 014),
                              rein: reader-logic (Zoom, Drehung, Boxen, Schritte), reader-settings
  app/shared/dialog/          Modal (Fokusfalle, Esc), DialogService (ein Dialog, Fokus zurück) – aus files-and-folders
  testing/keyboard.ts         wireKeyboard(): Dispatcher wie in app.ts für Komponenten-Tests
  testing/                    Fakes (FakeCategoriesApi, FakeScanApi, FakeCoversApi, FakeBooksApi, FakeReaderApi, FakeJobsApi), Fixtures – nie im
                              Produktivcode importieren
  test-setup.ts               Vitest-Setup (ResizeObserver für jsdom, fnf G11)
public/                       favicon.png
src-tauri/                    Rust (Tauri 2), Crate `comic-commander-tauri`, Lib `cc_lib`
  src/lib.rs                  Modulübersicht, Builder (Dialog-Plugin, AppState, Schema cccover), Commands
  src/commands.rs             dünne Command-Schicht (AppState: Kategorien, ScanHub, BookRegistry, CoverService),
                              serve_cover, Test command_rules
  src/categories.rs           categories.json: sanitize (streng beim Speichern, nachsichtig beim Laden), Ids, Icons,
                              Endungen, fnv64
  src/legacy_import.rs        alte config.json → Vorschau mit Hinweisen (feindliche Eingabe, ≤ 1 MiB)
  src/scan.rs                 Walk (rein, std): Endungen je Kategorie, Abbruch, Datei-Symlinks, natural_cmp
  src/scan_cache.rs           <app cache>/scans/<key>.json, Diff, Aufräumen
  src/book/                   Bücher nach Inhalt (Magic): zip_book, tar_book, sevenz (+ sevenz_header, fnf), rar (UnRAR-
                              FFI, fnf); Budget (Zeit/Abbruch), Grenzen; tests.rs mit Generatoren (cbz/cbt/cb7/cbr4)
  src/cover/                  choose (Titelseite), image (Decoder mit Limits, JPEG), sidecar (alte Thumbs lesen),
                              cache (App-Cache, 2 GiB), pool (LIFO), mod.rs (URL parsen, CoverService, Status)
  src/app_menu.rs             MenuSpec prüfen (feindlich: Größe, Tiefe, Ids, Texte), Kürzel → Accelerator, natives Menü
                              (macOS, Main-Thread), Ereignis menu-action (008)
  src/keymap_file.rs          <app config>/keymap.json laden (≤ 64 KiB, Syntax geprüft, 008)
  src/jobs/                   Jobs (007): mod.rs (JobHub, Control, Reporter), thumbs.rs (fehlende Cover im Stapel)
  src/reader/                 Leser (005): mod.rs (ReaderService: Sitzungen/Token, Durchlauf Maße/Entpacken, serve,
                              Gate, LRU), page_cache (App-Cache pages/, trim), image (sniff, Maße, skalieren), url, model
  src/reading_state.rs        reading-state.json (≤ 5 000 Bücher)
  src/comic_info.rs           ComicInfo.xml finden/lesen/parsen (011, quick-xml, fail-closed); Phase `meta` in scan_hub
  src/pdf/                    PDF (006): mod.rs (PdfBook, page_image, thumbnail), guard (Vorprüfung gegen Bomben),
                              fast (Schnellweg JPEG), render
                              (2 Threads, 64 MiB Stack, Zeitlimit), tests (PDF-Generator von Hand)
  src/book_registry.rs        Buch-Ids der Scans → Pfade (nur Gelistetes wird ausgeliefert/geöffnet)
  src/opener.rs               Buch auflösen (Registry) + mit Standard-App öffnen (fnf, `open` crate)
  src/platform/desktop.rs     reveal je OS (Finder/Explorer/D-Bus, Argument-Arrays, fnf)
  src/scan_hub.rs             ein Scan je Ziel (Thread, max. 4), Ereignisse an Abonnenten, Messung (ignored-Test)
  src/config_file.rs, fs_atomic.rs  Lader mit .bad / atomar schreiben (aus files-and-folders)
  src/paths.rs                Eingabepfade prüfen (~, absolut, NUL, Länge), rel_display
  src/model.rs, error.rs      DTOs (serde camelCase), FsError { code, message, path }
  src/about.rs                AppInfo (Version aus tauri.conf.json → package.json)
  testdata/legacy-config.json alte config.json (Marcs Struktur, Pfade neutralisiert)
  testdata/archives/          RAR/7z-Testdateien + Generatoren aus files-and-folders (Bomben, Slip, verschlüsselt)
  testdata/pdf/               encrypted.pdf + Generator (reportlab); andere Test-PDFs schreibt pdf/tests.rs
  capabilities/default.json   nur core:default
  icons/source/app-icon.svg   Quelle des App-Icons
docs/                         architecture.md (Entscheidungen, DTOs, Commands, Messungen, Abhängigkeiten),
                              legacy-analysis.md (Vorlage comiccommander)
prompts/                      Feature-Prompts (Index README.md, Regeln 000-arbeitsweise.md), done/
```

## 4. Architekturregeln (verbindlich)

- **Frontend ruft das Backend nur über typisierte Fassaden** (`CategoriesApi`, `ScanApi`, `AboutApi` und künftige
  `*Api` in `app/core/`); `invoke()` steht nur in `core/backend/call.ts`, `Channel`s entstehen in der Fassade.
  Komponenten und Stores rufen nie `invoke()`. Tests ersetzen die Fassade (`FakeCategoriesApi`, `FakeScanApi`).
- **DTO-Vertrag**: Rust `model.rs` ↔ TS `*.models.ts` von Hand synchron; jede Änderung auf beiden Seiten + Test.
  Fehler immer als `FsError { code: snake_case, message, path }`; neue Codes in `error.rs`, `fs-error.ts` und
  `describeFsError()`. Im UI nie Rusts `message` zeigen.
- **Pfade sind opake Strings** aus dem Backend. Kein Split/Join mit `/` oder `\` im Frontend; Eltern, Segmente,
  Zielpfade rechnet Rust (`std::path`). `relPath` ist nur Anzeige/Filter/Sortierung. Kein `canonicalize` für
  Navigation.
- **Zustand**: Signals; Stores je Ansicht `@Injectable()` ohne `providedIn: 'root'` im Komponenten-Provider;
  Globales (Einstellungen, Jobs, Kategorien) in Root-Services. `OnPush` überall, kein zone.js.
- **Veraltete Antworten verwerfen** (Request-Sequenz wie in `CategoryStore.open`) – bei Scan, Cover, Seiten.
- **Commands nie synchron**: `async fn` + `spawn_blocking` für blockierende I/O; der Test
  `commands::command_rules` prüft das. Logik in reinen Modulen ohne Tauri, Command-Schicht dünn.
- **Lange Operationen sind Jobs** (`jobs/`, ab Prompt 007): `JobHub::start(kind)` (ein Lauf je Art), Fortschritt über
  `tauri::ipc::Channel` mit `Reporter` (≤ 10/s), `Control` für Abbruch/Pause; nie auf dem Async-Runtime-Thread
  blockieren. Hintergrund-Threads, die Bilder dekodieren, setzen `cover::image::set_low_priority(true)`.
- **Bilder** (Cover, Seiten) kommen über ein eigenes **asynchrones URI-Schema** mit Tokens (ab 003), nie als
  Base64 über `invoke`, nie über einen HTTP-Server. Parallelität begrenzen (Semaphor, sonst 503).
- **Fremde Dateien sind feindlich**: Archive und Bilder aus der Sammlung werden mit Grenzen gelesen (Einträge,
  Größen, Kompressionsrate, Pixel), fail-closed, Decoder in `catch_unwind`. Kein Entpacken ins Dateisystem außer in
  den App-Cache, Namen werden geprüft (Zip-Slip). Vorlage: files-and-folders `archive/`, `duplicates/images.rs`.
- **Nichts in die Comic-Ordner schreiben**, außer der Nutzer schaltet es ausdrücklich ein (legacy §10.2): Caches und
  Thumbnails liegen im App-Cache (`app_cache_dir`), Einstellungen im App-Config-Ordner (`app_config_dir`).
- **Sicherheit**: keine Tauri-Plugins mit breitem Dateisystem- oder Shell-Zugriff; kein Shell-Aufruf, keine externen
  Programme (`unar`/`7z` der Vorlage werden durch Rust-Crates ersetzt). Einzige Ausnahme: der Dateimanager des OS für
  „Im Finder zeigen“ (`platform/desktop.rs`, Argument-Array, Pfad aus der Registry – 004 E5). CSP strikt (`style-src 'unsafe-inline'`
  wegen Angulars Laufzeit-Styles). Keine Dateiinhalte oder vollständigen Nutzerpfade unnötig loggen.
- **Destruktives** (Löschen von Duplikaten, Cache leeren) wird im Rust-Backend validiert und getestet; Standard beim
  Löschen ist der Papierkorb.
- **Plattformcode** hinter `cfg`-Funktionen bzw. einem Modul `platform/` mit gleicher Signatur je OS.
- **Neue Abhängigkeiten** (npm oder crates) nur mit kurzer Begründung in `docs/architecture.md` („Abhängigkeiten“).
  Keine UI-Frameworks (Material o. ä.); Styling mit CSS (natives Nesting) + Tokens aus `src/styles.css` – kein SCSS.
- **Unicode**: Dateinamen kommen in NFC und NFD vor (macOS, Marcs Sammlung gemischt). Pfade nie normalisieren;
  Anzeige-Reihenfolge mit `book-order.ts` (`Intl.Collator`), Filter über `filterKey()` (NFC, klein).
- **Tastatur nur über Aktionen** (008): jede Funktion ist eine Aktion im `action-catalog.ts`; Komponenten registrieren
  Handler beim `ActionService` (mit `DestroyRef`), Kürzel stehen in `keymap.*.json`. Einziger globaler
  `keydown`-Listener ist der `KeyboardDispatcher` – kein `document:keydown`/`window:keydown` anderswo. Widgets mit
  eigener Tastatur nach APG (Menüs, Listen, Fokusfalle) behalten Element-Handler und rufen `preventDefault`.
  Native Menü-Kürzel nur mit Modifier oder F-Taste.
- **Modale Dialoge** über `DialogService` (ein Dialog zur Zeit) + `Modal`; Tastaturkürzel der Ansicht ruhen, solange
  ein Dialog offen ist (der Dispatcher tut dann nichts).
- **Texte** nur aus Katalogen (`*-texts.ts`, Englisch = Quelle; Deutsch + Umschalten zur Laufzeit in Prompt 009).
- **Barrierefreiheit**: sichtbarer Fokus, alles per Tastatur, Dialoge mit `role="dialog"`/`aria-modal` und
  Fokusfalle, Live-Region für Statusmeldungen, Kontraste in light und dark.

## 5. GuiExpert Table als Cover-Grid (ab Prompt 004)

- Pakete: `@guiexpert/table` 1.1.102 + `@guiexpert/angular-table` 22.1.102 (**gleiche Major wie Angular**). Wir
  nutzen die signal-native **`TableSignalComponent`** (`guiexpert-table-signal`): Signal-Inputs `tableModel`,
  `tableOptions`, `loading`, API per **`[(tableApi)]="api"`** mit `api = signal<TableApi | undefined>(undefined)`,
  verdrahtet in einem `effect()` – **kein `tableReady`**. Die klassische `TableComponent` nicht verwenden.
- Cover-Grid: `CoverGridFactory.createCoverGridModel(items, cellRenderer, coverWidth, coverHeight, width,
  firstRowPaddingTop)` → `CoverGridTableModel<T>`; Breite ändern: `setParentWidth(w)` + `recalcHeightAndPadding()` +
  `tableApi.repaintHard()`; Cover-Größe: `bodyModel.coverWidth/coverHeight` + `recalcHeightAndPadding()`. Wir
  filtern im `GridStore` und setzen `bodyModel.items = filteredItems = Liste` (004). Vorlage: legacy §6.
- Erfahrungen aus 004: Cover-Grid hat kein Fokusmodell (eigener Cursor, Live-Region), die Table setzt `role="grid"`
  und entfernt `aria-activedescendant` je Durchgang; ihr Fokus-Zellrahmen umfasst die ganze Zeile 0 → CSS-Variablen
  `--ge-table-focus-*` transparent; Renderer-DOM global stylen (`::ng-deep` + Nesting greift nicht);
  `shortcutActionsDisabled`, `overlayOptions.autoNoRows: false`, `overflowY: 'scroll'`.
- Renderer ohne Angular (`CellRendererIf`) sind schneller als Angular-Komponenten; Dateinamen nie unescaped in
  `innerHTML` (Nutzerdaten!). Host braucht eine feste Höhe (Flex-Kind mit `min-height: 0`).
- **Referenz für jede API-Aussage**: das Mono-Repo (lokal `~/WebstormProjects/video/2026/guiexpert-table/mono`, sonst
  https://github.com/guiexperttable/mono: `CLAUDE.md`, `packages/angular-table/instructions.md`,
  `packages/table/src/lib/table/…`) bzw. die `.d.ts` in `node_modules/@guiexpert/table`. Namen nicht raten.
- Erfahrungen mit der Table aus files-and-folders (Workarounds G1–G14): dort
  `prompts/done/001-guiexpert-dateiliste.design.md`.
- **Lücken in der Table** nicht hier umgehen, wenn es sauber nur im Core geht: im Mono-Repo nach dessen Regeln lösen
  oder in `mono/TODO.md` vorschlagen und hier mit `// TODO(guiexpert): …` markieren.

## 6. Tests & Verifikation

- **Rust**: Unit-Tests neben dem Code (`#[cfg(test)]`), Dateisystem mit `tempfile`; Unicode, Leerzeichen, Emoji,
  Symlinks, fehlende Rechte (als root greifen Rechte nicht – bedingt testen), nicht-UTF-8 (Linux). Für Archive und
  Bilder: kleine Testdateien unter `src-tauri/testdata/` (+ Generator), auch kaputte und feindliche (Bomben, Zip-Slip).
- **Angular**: Vitest (`*.spec.ts` neben dem Code), Store-Tests mit Fakes, Komponenten-Tests für Zustände (Laden,
  leer, Fehler, Tastatur). Die GuiExpert Table rendert in jsdom nur eingeschränkt: Logik in Stores/Adaptern testen,
  Grid-Verhalten im echten Fenster prüfen.
- **Ende-zu-Ende**: echte App starten und die Akzeptanzkriterien des Prompts durchklicken; Screenshots beschreiben.
  Testsammlung mit Umlauten, Emoji, verschachtelten Ordnern, kaputten Archiven, CBR, das eigentlich ZIP ist, PDF.
- Jeder Bugfix bekommt zuerst einen roten Test.

## 7. Git & Zusammenarbeit

- Pro Prompt ein Branch `feat/<slug>` von `main`. Commits nach jeder grünen Phase (Conventional Commits: `feat:`,
  `fix:`, `docs:`, `test:`, `chore:`), immer mit grünem `pnpm check` bzw. begründeter Ausnahme.
- **Pushen ist erlaubt** (Marc, 22.10.2026). Kein Force-Push, kein `git reset --hard`, keine Releases ohne
  ausdrückliche Anweisung. Fremde Änderungen nie verwerfen.
- README, `docs/architecture.md`, `prompts/README.md` (Status) bei relevanten Änderungen mitpflegen.

## 8. Lizenzen & Referenzen

- Eigene Lizenz: **MIT** (`LICENSE`, `license` in `package.json`, `Cargo.toml`, `bundle.license` in
  `tauri.conf.json`).
- **files-and-folders-tauri** (MIT, gleicher Autor): Code **darf übernommen werden** – mit Herkunftsvermerk im
  Modulkopf (`//! Übernommen aus files-and-folders-tauri <datei> (Design NNN)`) und den zugehörigen Tests.
  Besonders passend:
  - `src-tauri/src/archive/` (ZIP/TAR/7z/RAR-Index mit Grenzen, `sanitize`/Zip-Slip, RAR über `unrar-ng-sys` als
    einziges FFI, Passwörter nur im Speicher), `archive/view.rs` (App-Cache),
  - `duplicates/comic.rs` (Seiten eines Comics, `natural_cmp`, Titelseite), `duplicates/images.rs` (Decoder mit
    Limits, Semaphor), `duplicates/thumbs.rs` (JPEG-Thumbnails im Speicher, Token), `duplicates/phash.rs`,
  - `preview/` (asynchrones URI-Schema `fnfpreview` mit Tokens, `register_asynchronous_uri_scheme_protocol` in
    `lib.rs`), `jobs/` (Engine: Warteschlange, Fortschritt, Abbruch), `opener.rs`, `platform/desktop.rs`,
    `fs_atomic.rs`, `settings.rs`, `core/i18n/`, `core/theme/`.
  Nur übernehmen, was der Prompt braucht – kein Ballast (kein Dual-Pane, keine Dateioperationen).
- **comiccommander** (Marc): fachliche Vorlage für Verhalten, Konfiguration und UI (`docs/legacy-analysis.md`); der
  Code (NestJS/Material) passt nicht und wird nicht übernommen.
- GuiExpert Table: MIT.
- Externe Formate: RAR über die UnRAR-Quellen (unRAR-Lizenz: Entpacken erlaubt, kein RAR-Erzeugen) – in Prompt 012
  in `docs/licenses.md` dokumentieren.

## 9. Arbeitsumgebung für Claude (Remote-Sitzung) – zuerst lesen, spart Zeit

**Wo was läuft**
- Das Repo liegt auf Marcs Mac (`~/WebstormProjects/comic-commander-tauri`). Die Geräte-Shell (`device_bash`) ist eine
  Linux-VM ohne pnpm/cargo – dort keine Checks, nur `git` und Lesen. Die Vorlagen liegen daneben
  (`~/WebstormProjects/comiccommander`, `~/WebstormProjects/files-and-folders-tauri`) – per `device_bash` lesen.
- `git` auf dem Gerät braucht **Löschrechte** (Lock-Dateien): einmal je Sitzung `device_request_delete_permission`
  für den Repo-Ordner. Dort gibt es keine Git-Identität: Commits mit
  `git -c "user.name=Marc Kronberg" -c user.email=krocon@gmail.com …`.
- Gebaut und getestet wird in der **Cloud-Umgebung** (Klon des Repos über `add_repo`).

**Container einrichten (einmal je Sitzung, im Hintergrund starten und währenddessen lesen)**
- `apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev xdotool imagemagick`
  (Xvfb ist da), `pnpm install`, `cd src-tauri && CARGO_INCREMENTAL=0 cargo build --tests` (~4 min beim ersten Mal).
- Node im Container ist zu alt für die Angular-CLI (22.22.0 < 22.22.3): `npm pack node-linux-x64@22.23.3` (npm-Registry
  ist erreichbar, nodejs.org nicht) in den Scratch-Ordner entpacken und dessen `package/bin` vorn in den `PATH`
  stellen (die System-Binary nicht überschreiben).

**Übergabe auf den Mac**
- Pushen aus dem Container kann scheitern (GitHub-App ohne Schreibrecht für das Repo, Stand 22.10.2026). Dann:
  Container `git bundle create /mnt/user-data/outputs/<slug>.bundle <basis>..<branch>` (beim ersten Mal `--all`) →
  `device_commit_files` nach `.tmp-bundle/<slug>.bundle` → Gerät: `git pull --ff-only .tmp-bundle/<slug>.bundle <branch>`
  → Push vom Mac (Marc: `git push`). `.tmp-bundle/` ist in `.gitignore`.

**Ende-zu-Ende im Container**
- `pnpm tauri build --debug --no-bundle`, dann `Xvfb :99 &`, `DISPLAY=:99 src-tauri/target/debug/comic-commander-tauri &`,
  Screenshot `DISPLAY=:99 import -window root shot.png`. `GTK_THEME=Adwaita:dark` schaltet `prefers-color-scheme: dark`.
  `xdotool click` geht im WebKitGTK-Fenster manchmal verloren – `mousedown`, kurz warten, `mouseup`; `xdotool type`
  kann keine Mehrbyte-Zeichen – solche Namen per Datei anlegen.
- Platte ist knapp: `export CARGO_INCREMENTAL=0`, `df -h /` im Blick, `target/release` nach Messungen löschen.

**Sparsam lesen** – Einstieg: `docs/architecture.md` (Entscheidungen, Commands), dann der Prompt und das Design-Dokument
des Vorgängers. Aus `docs/legacy-analysis.md` nur die im Prompt genannten Abschnitte.
