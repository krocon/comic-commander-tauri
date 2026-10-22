# Design 002: Kategorien und Scan mit Cache

> **Status: umgesetzt** (freigegeben 22.10.2026, Rev. 2) · Datum: 22.10.2026 · Branch `feat/kategorien-scan`
> Auftrag: [`002-kategorien-scan.md`](002-kategorien-scan.md) · Regeln: [`000-arbeitsweise.md`](../000-arbeitsweise.md)
> Vorlage: legacy §2, §3, §9 · Übernahme aus files-and-folders-tauri: `config_file.rs`, `fs_atomic.rs`,
> Batch-Muster aus `jobs/search.rs` (≤ 500 / 50 ms), `shared/dialog/`, Font Awesome 4.5.0.
>
> Rev. 2 (Marc, 22.10.2026): Begriff und Modell der Vorlage – **Kategorien** mit eigenem `baseDir` und eigenen
> `bookExtensions` (Beispiel „Make“: nur `.pdf`), zur Laufzeit verwaltbar. Rev. 1 hatte „Bibliotheken“ mit fester
> Endungsliste.

## Entscheidungen auf einen Blick

| Nr. | Frage | Empfehlung |
|---|---|---|
| E1 | Ordner-/Dateidialog | Rust-Commands über die **Rust-API** von `tauri-plugin-dialog`; die WebView bekommt **keine** `dialog:`-Berechtigung |
| E2 | Symlinks | Links auf **Dateien** folgen, Links auf **Ordner** überspringen (gezählt, im Status sichtbar) |
| E3 | Endungen | **je Kategorie** frei aus der Liste der lesbaren Formate (`.cbz .cbr .cb7 .cbt .pdf .zip .rar .7z .tar`), mind. eine, Vergleich ohne Groß-/Kleinschreibung |
| E4 | Icons | Font Awesome 4.5.0 aus files-and-folders, Auswahl aus 24 Icons; Material-Namen der Vorlage werden beim Import abgebildet |
| E5 | Cache | JSON je Kategorie im App-Cache, Schlüssel = `baseDir` + Endungen |
| E6 | Unicode (NFC/NFD) | Anzeige-Reihenfolge und Filter im Frontend (`Intl.Collator`, `normalize('NFC')`); Rust sortiert nur deterministisch |
| E7 | Alte Konfiguration | **Import** der `config.json` (Datei wählen → Vorschau → hinzufügen); die alte `files.json` im Comic-Ordner wird nicht gelesen |
| E8 | Ordner-Überwachung | verschoben (Folge-Idee); Ersatz: Neu-Scan beim Öffnen + `Mod+R` |
| E9 | Laufende Scans | ein Scan je Kategorie („Hub“), weitere Öffner hängen sich an; Wechsel der Kategorie bricht nicht ab |
| E10 | Feldnamen | wie die Vorlage: `baseDir`, `bookExtensions`, `title`, `icon`, `thumbsDims` (`width`, `height`, `nameExtension`), `dimIndex`, `initialFilter`; neu nur `id` |

## Bestand und reale Daten

**Marcs Konfiguration der Vorlage** (macOS): zwei Kategorien – „Comics“ (`…/_done/comics.nosync`, `.cbz`/`.cbr`) und
„Make“ (`…/_done/ct Make`, nur `.pdf`), beide `thumbsDims` 200×300 (`""`) + 800×1200 (`"_xl"`), `dimIndex` 1, Icon
`stars`. Sie wird Testfall des Imports (als Fixture mit neutralisierten Pfaden) und Abnahme auf dem Mac. Die Pfade
stehen nirgends im Code.

**Kategorie „Comics“** (gelesen am 22.10.2026, nur lesend; „Make“ noch nicht angesehen):

| Merkmal | Wert | Folge für das Design |
|---|---|---|
| Bücher | 584 (571 `.cbr`, 13 `.cbz`), 112 GB | Scan lokal < 1 s; der Cache lohnt sich vor allem für Netzlaufwerke/große Sammlungen |
| Ordner / Tiefe | 79 Ordner, max. 4 Ebenen; Ordnernamen wie `3951`, `bl` | Ordnernamen sind keine verlässliche Serie (→ 011) |
| Sonstige Dateien | 544 `.jpg` (272 × `Band.jpg` + 272 × `Band_xl.jpg` = Sidecars der Vorlage), 12 `.mkv`, 6 `.nfo`, `files.json`, `.DS_Store` | Scan ignoriert sie (Endungen der Kategorie); Sidecars nutzt 003 über `nameExtension` |
| Symlinks | 0 | E2 ohne Wirkung für Marc |
| **Unicode** | 62 Namen mit **NFD**-Umlauten (`u` + U+0308), 78 mit **NFC** (`ü`) – gemischt | E6 |
| Archiv-Inhalt | 8 der „`.cbr`“ sind ZIP (`PK\3\4`), 563 echte RAR | 003: Format nach Inhalt |

**Code:**

| Baustein | wofür | Stand |
|---|---|---|
| `library.rs` (`scan`, `natural_cmp`, `format_of`) | Walk | wird zu `scan.rs`: Endungen als Parameter, Abbruch, Rückrufe für Batches, Datei-Symlinks |
| `paths.rs` (`validate_input_path`, `rel_display`) | `baseDir` prüfen | passt |
| `commands.rs` (`scan_library`) | Skelett-Command | entfällt, ersetzt durch `open_category` |
| `LibraryApi`/`LibraryStore`/`LibraryView` | Skelett | umbenannt in `ScanApi`/`CategoryStore`/`CategoryView`, ereignisgetrieben |
| fnf `config_file.rs`, `fs_atomic.rs` | Lader / atomar / `.bad` | **übernehmen** (mit Tests) |
| fnf `jobs/search.rs` | Batch-Muster | Muster übernehmen, keine Job-Engine (kommt in 007) |
| fnf `shared/dialog/` (`DialogService`, `Modal`, Fokusfalle) | Dialog „Kategorien“ | **übernehmen**, gekürzt |
| fnf `src/assets/font-awesome-4.5.0/` | Icons | **übernehmen** (nur `css` + `woff2`) |

## E1 – Ordner- und Dateidialog

- A: `tauri-plugin-dialog` im Frontend (`dialog:allow-open`) – die WebView könnte Dialoge beliebig öffnen, Pfade kämen
  ungeprüft zurück.
- B: eigener Command mit `rfd` – dasselbe wie A unter der Haube, eine Abhängigkeit mehr.
- **C (Empfehlung):** Commands `pick_folder(start?)` und – für den Import – `import_legacy_config()`, die intern
  `app.dialog().file()…blocking_pick_folder()/blocking_pick_file()` aus dem Plugin aufrufen (Rust-API, **keine**
  Capability). Läuft in `spawn_blocking`; der gewählte Pfad geht durch `validate_input_path`. Die WebView bekommt keine
  neue Berechtigung, Regel A2 bleibt gewahrt. Pfade bleiben eintippbar.

## E2 – Symlinks

Die Vorlage folgte allen Links ohne Zyklusschutz (legacy §10.1). Empfehlung: **Datei-Links folgen** (kein Zyklus
möglich; Ziel per `metadata` geprüft, kaputte Links gezählt), **Ordner-Links nicht** (Zyklen, Ausbruch aus dem
`baseDir`, doppelte Bücher). Der Status zeigt „3 linked folders skipped“. Bei Bedarf später eine Option je Kategorie
mit Besucht-Menge (Gerät + Inode).

## E3 – Endungen je Kategorie

Die Vorlage erlaubte beliebige Strings und verglich exakt (`.CBR` wurde nicht gefunden). Empfehlung:
- Auswahl per Checkboxen aus den Formaten, die 003/006 lesen können: `.cbz .cbr .cb7 .cbt .pdf` und die Container-
  Endungen `.zip .rar .7z .tar` (manche Sammlungen nutzen sie für Comics). Was wir nicht lesen können, würde nur als
  leeres Cover erscheinen.
- Gespeichert wie die Vorlage (`".cbz"`, mit Punkt, klein); `sanitize` normalisiert (`CBR` → `.cbr`), entfernt
  Unbekanntes und Doppeltes; leer → Fehler beim Speichern.
- Default einer neuen Kategorie: `.cbz .cbr .cb7 .cbt .pdf`.
- `BookFormat` (DTO) bleibt die **Containerart** nach Endung: `.zip` → `cbz`, `.rar` → `cbr`, `.7z` → `cb7`,
  `.tar` → `cbt`. Die echte Art erkennt 003 am Inhalt.

## E4 – Icons

Font Awesome 4.5.0 wie in files-and-folders: `font-awesome.min.css` + `fontawesome-webfont.woff2` (~70 KB) nach
`src/assets/font-awesome-4.5.0/`. Auswahl im Dialog aus 24 Icons (`book`, `star`, `bookmark`, `rocket`, `flag`,
`heart`, `fire`, `bolt`, `globe`, `university`, `child`, `user-secret`, `paw`, `magic`, `diamond`, `trophy`, `film`,
`camera`, `music`, `car`, `plane`, `ship`, `tree`, `moon-o`). Gespeichert ohne `fa-`; Rust prüft gegen dieselbe Liste
(unbekannt → `book`). Import: Material-Namen der Vorlage per Tabelle (`stars`/`star` → `star`, `book`/`menu_book` →
`book`, `rocket`/`rocket_launch` → `rocket`, `favorite` → `heart`, `movie` → `film`, `public` → `globe`, `school` →
`university`, `pets` → `paw`, `auto_awesome` → `magic`, …), Rest → `book`.

## E5 – Cache

- Ort: `app_cache_dir()/scans/<fnv64(baseDir + "\0" + Endungen sortiert) hex>.json` – Schlüssel ist, **was** gescannt
  wird, nicht die Id: andere Endungen oder anderer Ordner → neuer Cache.
- Inhalt: `{ "version": 1, "baseDir": "…", "bookExtensions": […], "scannedAt": <ms>, "books": [BookEntry…],
  "stats": {…} }`; beim Laden werden `baseDir`/Endungen verglichen; falsche Version/kaputt → wie nicht vorhanden
  (Datei → `.bad`, Lader aus `config_file.rs`).
- Atomar geschrieben (`fs_atomic::write_atomic`) nach jedem vollständigen Scan; **abgebrochene oder fehlgeschlagene**
  Scans schreiben nicht. Caches entfernter Kategorien räumt `save_categories` weg.
- Lesegrenze 256 MiB (≈ 1 Mio. Bücher). Messung mit 50 000 Büchern in Phase 2 → `docs/architecture.md`; erst bei
  > 300 ms Binärformat erwägen.
- Nie im Comic-Ordner (legacy §10.2). „Cache leeren“ kommt mit 009.

## E6 – Unicode-Normalisierung

macOS liefert Namen so, wie sie gespeichert wurden – bei Marc gemischt NFC/NFD. Pfade bleiben **unverändert** (sonst
findet Rust die Datei nicht mehr). Für Menschen:
- **Filter** (004): Suchtext und `relPath` werden vor dem Vergleich `normalize('NFC').toLowerCase()`; der Schlüssel
  wird einmal je Buch im Store berechnet (Textoperation, kein Pfad-Split – Regel bleibt gewahrt).
- **Anzeige-Reihenfolge** im Frontend: `new Intl.Collator(locale, { numeric: true, sensitivity: 'base' })` – natürlich
  (`2` < `10`), ohne Groß-/Kleinschreibung, NFC = NFD. 004 braucht ohnehin weitere Sortierungen. Messung: 50 000
  Bücher < 150 ms, sonst Schlüssel in Rust vorberechnen.
- **Rust** sortiert weiter mit `natural_cmp` – nur damit Cache und Diffs deterministisch sind (keine neue Crate für
  Normalisierung).

## E7 – Import der alten Konfiguration

- Command `import_legacy_config()` öffnet den Dateidialog (`*.json`), liest höchstens 1 MiB und liefert eine
  **Vorschau**: `LegacyImport { categories: Category[] (id leer), notes: ImportNote[] }`. Übernommen: `title`,
  `baseDir`, `bookExtensions` (→ E3, Unbekanntes als Hinweis), `icon` (→ E4), `thumbsDims` (geprüft: 32–2000 px,
  `nameExtension` ≤ 20 Zeichen ohne Pfadtrenner), `dimIndex`, `initialFilter`. Ignoriert: `port`, `tempDir`,
  `apiUrl`, `selectedCategoryIndex`, `scrollOffset`.
- Hinweise je Kategorie: „Ordner existiert nicht“, „Endung `.epub` wird nicht unterstützt“, „schon vorhanden“
  (gleicher `baseDir` + gleiche Endungen → standardmäßig nicht angehakt).
- Der Dialog zeigt die Vorschau mit Checkbox je Kategorie; „Hinzufügen“ hängt die gewählten an und speichert über
  `save_categories`. Nichts wird ohne Bestätigung geändert.
- Die alte `files.json` im Comic-Ordner wird weder gelesen noch angefasst (ein Scan ist schnell genug, der alte
  Server kann parallel weiterlaufen).

## E8 – Ordner-Überwachung

Verschoben. Netzlaufwerke melden Änderungen nicht zuverlässig (fnf `watch/netfs.rs`); Neu-Scan beim Öffnen plus
`Mod+R` reicht für Sammlungen, die sich selten ändern. Eintrag unter „Folge-Ideen“.

## E9 – Scan-Hub

- Rust-State `ScanHub`: `Map<cacheKey, RunningScan { cancel: Arc<AtomicBool>, subscribers: Vec<Channel<ScanEvent>> }>`.
- `open_category(id, onEvent)`: sendet sofort `cached` (falls Cache), startet einen Scan – oder hängt den Kanal an
  einen laufenden Scan desselben Schlüssels (legacy §3 „runningScansPromises“).
- Kategorie wechseln bricht nicht ab: der alte Scan läuft zu Ende und schreibt seinen Cache; das Frontend verwirft
  dessen Ereignisse (Sequenz). Abbruch nur ausdrücklich (`cancel_scan`, „Cancel“ beim Erstscan).
- Ein Worker-Thread je Scan (`std::thread`, nicht der Async-Runtime-Thread); höchstens 4 gleichzeitig, weitere warten.

## Verträge

### DTOs (`model.rs`/`categories.rs` ↔ `categories.models.ts`/`scan.models.ts`)

```ts
interface ThumbsDim { width: number; height: number; nameExtension: string }   // wie Vorlage
interface Category {                     // categories.json
  id: string;                            // 'c' + 12 hex, von Rust vergeben (leer = neu)
  title: string;                         // 1–100 Zeichen; leer → Ordnername (rechnet Rust)
  baseDir: string;                       // absolut nach ~-Expansion; muss beim Speichern NICHT existieren
  bookExtensions: string[];              // E3, ≥ 1, z. B. ['.cbz', '.cbr']
  icon: string;                          // E4, Default 'book'
  thumbsDims: ThumbsDim[];               // 1–5, Default [200×300 '', 800×1200 '_xl'] (wie Vorlage)
  dimIndex: number;                      // gültiger Index in thumbsDims, Default 0
  initialFilter: string;                 // ≤ 500 Zeichen (Wirkung in 004)
}
interface CategoriesConfig { version: 1; activeId: string | null; categories: Category[] }  // ≤ 50
interface CategoriesLoaded { config: CategoriesConfig; warning: ConfigWarning | null }       // ConfigWarning wie fnf
interface ImportNote { index: number; code: 'missing_dir' | 'unsupported_extension' | 'duplicate' | 'invalid_dims';
                       detail: string | null }
interface LegacyImport { file: string; categories: Category[]; notes: ImportNote[] }

interface ScanStats { books: number; dirs: number; unreadableDirs: number; skippedEntries: number;
                      skippedDirLinks: number; brokenLinks: number; truncated: boolean; durationMs: number }

type ScanEvent =
  | { kind: 'cached'; books: BookEntry[]; scannedAt: number; stats: ScanStats }
  | { kind: 'started'; firstScan: boolean }
  | { kind: 'batch'; books: BookEntry[] }                                         // nur beim Erstscan
  | { kind: 'progress'; books: number; dirs: number }                            // ≤ 4/s
  | { kind: 'diff'; added: BookEntry[]; removed: string[]; changed: BookEntry[] } // nach Scan mit Cache
  | { kind: 'done'; scannedAt: number; stats: ScanStats }
  | { kind: 'cancelled' }
  | { kind: 'failed'; error: FsError; cacheKept: boolean };                      // z. B. Laufwerk ausgehängt
```

`BookEntry` bleibt wie in 001. `changed` = gleicher Pfad, andere Größe oder mtime; `removed` = Pfade.

### Commands (alle `async`)

| Command | Parameter | Rückgabe | Fehler |
|---|---|---|---|
| `load_categories` | – | `CategoriesLoaded` | – (Probleme als `warning`) |
| `save_categories` | `config` | `CategoriesConfig` (bereinigt, Ids/Titel vergeben) | `invalid_categories`, `io` |
| `pick_folder` | `start?: string` | `string \| null` | `invalid_path` |
| `import_legacy_config` | – | `LegacyImport \| null` (Abbruch im Dialog) | `invalid_legacy_config`, `io` |
| `default_comics_dir` | – | `string \| null` (`~/Comics`, nur wenn vorhanden) | – |
| `open_category` | `id`, `onEvent: Channel<ScanEvent>` | `void` (alles weitere als Ereignis) | `unknown_category` |
| `cancel_scan` | `id` | `void` | – |

`scan_library` und `default_library_root` (001) entfallen. Neue Fehlercodes `invalid_categories`,
`invalid_legacy_config`, `unknown_category` in `error.rs`, `fs-error.ts`, `describeFsError()`.

### Module

- Rust: `categories.rs` (Konfig, sanitize, Ids, Icons, Endungen; rein), `legacy_import.rs` (Parser + Abbildung; rein),
  `scan.rs` (bisher `library.rs`: Walk mit Endungen, Rückrufen, Abbruch-Flag), `scan_cache.rs` (Schlüssel,
  Lesen/Schreiben, Diff; rein), `scan_hub.rs` (Threads, Abonnenten), `config_file.rs` + `fs_atomic.rs` (übernommen),
  `commands.rs` (+ Dialog-Commands).
- Frontend: `core/categories/` (`CategoriesApi`, Modelle), `core/scan/` (`ScanApi.open(id, onEvent)` – der `Channel`
  entsteht in der Fassade –, `cancel`), `features/categories/` (`CategoriesStore` Root, Dialog „Manage categories“,
  Import-Vorschau, `category-form.ts` reine Prüfung), `features/category/` (`CategoryStore` je Ansicht,
  `CategoryView`; `book-order.ts` Collator + NFC-Schlüssel, rein), `shared/dialog/`.

## UI

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ [★ Comics ▾]  [⟳]                       584 books · updated 3 min ago   (role=status) │  Toolbar
├──────────────────────────────────────────────────────────────────────────────────────┤
│  Liste wie 001 (→ Cover-Grid in 004), beim Erstscan wächst sie                        │
└──────────────────────────────────────────────────────────────────────────────────────┘
 Menü „★ Comics ▾“ (Menü-Button nach APG): ★ Comics ✓ · ★ Make · ─── · Manage categories… · Import old config…
```

- Status: `cached` → „584 books · updated 3 min ago · refreshing…“; Erstscan → „Scanning… 1 234 books in 56 folders“
  + „Cancel“; `failed` mit Cache → „Folder not reachable – showing the state of 22.10. 14:32“.
- **Dialog „Manage categories“** (`role="dialog"`, `aria-modal`, Fokusfalle, Fokus zurück an den Menü-Button):

```
┌ Manage categories ─────────────────────────────────────────────────────────────┐
│ ┌──────────────┐  Title        [Comics                                    ]    │
│ │★ Comics     │  Folder       [/Users/…/comics.nosync          ] [Choose…]    │
│ │★ Make       │  Extensions   [x].cbz [x].cbr [ ].cb7 [ ].cbt [ ].pdf          │
│ │             │               [ ].zip [ ].rar [ ].7z  [ ].tar                  │
│ │             │  Icon         ( 6×4 Icons, Radiogruppe )                        │
│ │             │  Thumb sizes  200 × 300  suffix ""      (•) default  [−]        │
│ │             │               800 × 1200 suffix "_xl"   ( ) default  [−]  [+]   │
│ └──────────────┘  Initial filter [                                        ]    │
│ [+ Add] [Remove] [Import old config…]                       [Cancel] [Save]    │
└────────────────────────────────────────────────────────────────────────────────┘
```
  Liste als `listbox` (↑/↓, `Alt+↑/↓` verschieben); Prüfung live (leerer Ordner, keine Endung, Größen außerhalb
  32–2000 px); Ordner existiert nicht → Warnung, Speichern erlaubt (Laufwerk evtl. gerade nicht verbunden).
  `Mod+Enter` speichert, `Esc` verwirft (mit Rückfrage bei Änderungen).
- **Import-Vorschau** (eigener Dialog): Tabelle Titel · Ordner · Endungen · Größen · Hinweise, Checkbox je Zeile,
  „Add selected“.
- **Erster Start** (keine Kategorie): „No category yet“ mit „Create category…“, „Import old config…“ und – falls
  `~/Comics` existiert – „Use ~/Comics“.
- Tasten (bis 008 im zentralen Handler der Ansicht): `Mod+R` neu scannen, `Mod+1…9` Kategorie wählen.

## Tests

**Rust**
- `categories.rs`: sanitize (leerer/zu langer Titel → Ordnername bzw. gekürzt, relativer `baseDir`, Endungen
  normalisieren/unbekannt/leer, `thumbsDims` außerhalb der Grenzen, `nameExtension` mit `/`, `dimIndex` außerhalb,
  doppelte Ids, unbekanntes Icon, > 50 Kategorien, `activeId` ungültig → erste), Id-Vergabe, Rundreise JSON, kaputte
  Datei → `.bad` + Warnung.
- `legacy_import.rs`: Marcs Konfiguration (Fixture, Pfade neutralisiert) → zwei Kategorien mit allen Feldern;
  Material-Icon-Abbildung; unbekannte Endung, fehlender Ordner, Duplikat → Hinweise; kaputtes JSON, falscher Typ,
  > 1 MiB → `invalid_legacy_config`; fremde Felder ignoriert.
- `scan.rs`: Endungen je Kategorie (nur `.pdf`; `.CBR` gefunden), Abbruch mitten im Walk, Batches, Datei-Symlink
  gefolgt, kaputter Link gezählt, Ordner-Link übersprungen + gezählt, NFC/NFD-Namen beide gefunden.
- `scan_cache.rs`: Schlüssel (Ordner/Endungen), Rundreise, andere Version/kaputt/fremder Schlüssel → `None`, Diff
  (neu, entfernt, geändert per Größe/mtime), abgebrochener Scan schreibt nicht, Aufräumen entfernter Kategorien.
- `scan_hub.rs`: zweiter Öffner hängt sich an (ein Walk), Abbruch, fehlender `baseDir` mit/ohne Cache
  (`cacheKept`), höchstens 4 parallel.
- Messung: 50 000 Dateien in 2 500 Ordnern (Generator) – Erstscan, Cache lesen, Diff → `docs/architecture.md`.
  Zusätzlich eine **Spiegel-Sammlung** aus Marcs 584 Namen (leere Dateien, gleiche Ordner, gleiche NFC/NFD-Formen;
  nur im Scratch-Ordner, nicht im Repo).

**Frontend**
- `CategoriesStore`: laden (mit Warnung), speichern, aktive wählen, Import übernehmen.
- `CategoryStore`: Folgen `cached → started → diff → done`, `started → batch* → done`, `cached → failed` (Cache
  bleibt), veraltete Ereignisse nach Wechsel verworfen, Abbruch; geänderte Endungen → neuer Scan.
- `category-form.ts` (Prüfung), `book-order.ts` (natürlich, NFC = NFD, Groß/klein, Filter-Schlüssel).
- Dialoge: Tastatur (Liste, Verschieben, Esc/Mod+Enter), Fokusfalle, Prüftexte, Import-Vorschau; Menü-Button nach
  APG.

**Ende-zu-Ende** (Container): Test-Sammlung + Spiegel-Sammlung, zwei Kategorien (eine nur PDF), Import einer
`config.json`, Neustart, Ordner umbenennen (= „ausgehängt“), Erstscan abbrechen. **Auf dem Mac** (Marc): Abnahme mit
dem Import seiner alten Konfiguration – Schritte im Abschlussbericht.

## Neue Abhängigkeiten

| Paket | Seite | Wofür |
|---|---|---|
| `tauri-plugin-dialog` (nur Rust-API, keine Capability) | Rust | nativer Ordner-/Dateidialog (E1, E7) |
| Font Awesome 4.5.0 (Assets, kein npm-Paket) | Frontend | Kategorie-Icons (E4) |

## Akzeptanzkriterien (aus dem Auftrag, präzisiert)

- [ ] Zwei Kategorien anlegen (eine nur `.pdf`), wechseln, bearbeiten, entfernen – überlebt einen Neustart.
- [ ] Import von Marcs alter `config.json` ergibt „Comics“ und „Make“ mit Ordnern, Endungen, Thumb-Größen, `dimIndex`.
- [ ] Zweites Öffnen zeigt die Bücher aus dem Cache sofort (< 300 ms bei 50 000); neue Dateien erscheinen nach dem
      Hintergrund-Scan ohne Neuladen der Ansicht; geänderte Endungen lösen einen neuen Scan aus.
- [ ] Im Comic-Ordner entsteht keine Datei (auch keine `files.json`).
- [ ] Nicht erreichbarer Ordner: Cache + verständlicher Hinweis; ohne Cache: Fehler mit „Choose folder…“.
- [ ] Filter-Schlüssel und Reihenfolge behandeln `ü` (NFC) und `u` + U+0308 (NFD) gleich.
- [ ] Mac: „Comics“ zeigt 584 Bücher in natürlicher Reihenfolge, zweiter Start sofort.

## Fortschritt

- [x] Phase 1: Design (Rev. 2) – freigegeben von Marc („go“, 22.10.2026)
- [x] Phase 2: Rust – `categories.rs`, `legacy_import.rs`, `scan.rs` (aus `library.rs`), `scan_cache.rs`, `scan_hub.rs`,
      Commands; `config_file.rs`/`fs_atomic.rs` übernommen. 51 Tests + Messung (ignored).
- [x] Phase 3: Frontend – Fassaden, Stores, Dialoge, Menü-Button, Erststart; 53 Specs.
- [x] Phase 4: Ende-zu-Ende im Container (Xvfb, Debug-Build) mit der Spiegel-Sammlung (584 Namen aus `comics.nosync`,
      leere Dateien) und einer Test-„Make“ (PDF): Erststart → Import der alten `config.json` über den GTK-Dialog →
      Vorschau → 584 Bücher; Menü → „Make“; Dialog: Icon + `.cbz` dazu → neuer Cache-Schlüssel, alter Cache gelöscht;
      Ordner umbenannt → „Folder not reachable – showing the state of …“; Neustart → letzte Kategorie, neue Datei per
      Diff (585); Dark-Mode. Bilder: `002-screenshots/`.
- [x] Phase 5: Doku – `docs/architecture.md` (A4–A16, DTOs, Commands, Messung), README, CLAUDE.md, Index.
- [x] Phase 6: `pnpm check` grün, Debug-Build, Review durch separaten Agenten (Rust).

**Abweichungen vom Entwurf**
- `ImportNote.index` ist `number | null` (statt immer gesetzt) und es gibt zwei Codes mehr – `invalid_dir`,
  `no_extension` –, für Kategorien, die beim Import ausgelassen werden.
- `pick_folder` liefert nur existierende Ordner (sonst `not_found`) – im E2E-Test gab GTK nach Autovervollständigung
  einen nicht vorhandenen Pfad zurück.
- Kategorie-Menü: `Enter` auf einem Eintrag wird verbraucht (`preventDefault`), der Fokus geht danach an den Button –
  sonst öffnete WebKit das Menü sofort wieder (E2E-Befund, Spec ergänzt).
- Batches werden bis 5 000 Bücher bei jedem Eintreffen sortiert, darüber einmal bei `done` (`SORT_WHILE_SCANNING`).

**Nicht im Container prüfbar** (Abnahme auf dem Mac): echte Sammlung `comics.nosync` und „ct Make“, macOS-Ordnerdialog,
Cache-Ort `~/Library/Caches/io.github.krocon.comiccommander`, Netzlaufwerk-Verhalten.
