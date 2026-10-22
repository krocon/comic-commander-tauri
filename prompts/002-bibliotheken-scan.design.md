# Design 002: Bibliotheken und Scan mit Cache

> **Status: Entwurf – wartet auf Freigabe 🛑** · Datum: 22.10.2026 · Branch `feat/bibliotheken-scan`
> Auftrag: [`002-bibliotheken-scan.md`](002-bibliotheken-scan.md) · Regeln: [`000-arbeitsweise.md`](000-arbeitsweise.md)
> Vorlage: legacy §2, §3, §9 · Übernahme aus files-and-folders-tauri: `config_file.rs`, `fs_atomic.rs`,
> Batch-Muster aus `jobs/search.rs` (≤ 500 / 50 ms).

## Entscheidungen auf einen Blick

| Nr. | Frage | Empfehlung |
|---|---|---|
| E1 | Ordnerdialog | Rust-Command `pick_folder` über die **Rust-API** von `tauri-plugin-dialog`; die WebView bekommt **keine** `dialog:`-Berechtigung |
| E2 | Symlinks | Links auf **Dateien** folgen, Links auf **Ordner** weiter überspringen (gezählt, im Status sichtbar) |
| E3 | Endungen konfigurierbar? | Nein – feste Liste `cbz cbr cb7 cbt pdf` |
| E4 | Icons | Font Awesome 4.5.0 aus files-and-folders, feste Auswahl von 24 Icons |
| E5 | Cache-Format | JSON (serde), versioniert, eine Datei je Bibliothek im App-Cache |
| E6 | Unicode (NFC/NFD) | Anzeige-Reihenfolge und Filter im Frontend mit `Intl.Collator`/`normalize('NFC')`; Rust sortiert nur deterministisch |
| E7 | Alte `files.json` der Vorlage | nicht lesen, nicht anfassen |
| E8 | Ordner-Überwachung | verschoben (Folge-Idee); Ersatz: Neu-Scan beim Öffnen + `Mod+R` |
| E9 | Laufende Scans | ein Scan je Bibliothek („Hub“), weitere Öffner hängen sich an; Wechsel der Bibliothek bricht nicht ab |

## Bestand und reale Sammlung

**Marcs Sammlung** `/Users/marckronberg/FilmeOut.nosync/_done/comics.nosync` (gelesen am 22.10.2026, nur lesend) –
wird die Abnahme-Bibliothek dieses Prompts (auf dem Mac; der Pfad steht nirgends im Code):

| Merkmal | Wert | Folge für das Design |
|---|---|---|
| Bücher | 584 (571 `.cbr`, 13 `.cbz`), 112 GB | Scan dauert lokal < 1 s; der Cache lohnt sich vor allem für Netzlaufwerke/große Sammlungen |
| Ordner / Tiefe | 79 Ordner, max. 4 Ebenen; Ordnernamen wie `3951`, `bl` | Ordnernamen sind keine verlässliche Serie (→ 011) |
| Sonstige Dateien | 544 `.jpg` (272 × `Band.jpg` + 272 × `Band_xl.jpg` – Sidecars der Vorlage), 12 `.mkv`, 6 `.nfo`, `files.json`, `.DS_Store` | Scan ignoriert sie; Sidecars nutzt 003 |
| Symlinks | 0 | E2 ist für Marc ohne Wirkung |
| **Unicode** | 62 Namen mit **NFD**-Umlauten (`u` + U+0308), 78 mit **NFC** (`ü`) – gemischt | E6: Filter `ü` muss beide finden, Sortierung darf sie nicht trennen |
| Archiv-Inhalt | 8 der „`.cbr`“ sind ZIP (`PK\3\4`), 563 echte RAR | betrifft 003 (Erkennung nach Inhalt) |
| `files.json` (Vorlage) | 584 Einträge im Comic-Ordner | E7 |

**Code:**

| Baustein | wofür | Stand |
|---|---|---|
| `library.rs` (`scan`, `natural_cmp`, `format_of`) | Walk | passt; wird um Abbruch, Batches, Datei-Symlinks erweitert |
| `paths.rs` (`validate_input_path`, `rel_display`) | Wurzel prüfen | passt |
| `commands.rs` (`scan_library`) | Skelett-Command | wird durch `open_library` ersetzt |
| `LibraryStore`/`LibraryView` | Skelett | Store wird ereignisgetrieben, View bekommt Toolbar mit Bibliotheks-Menü |
| fnf `config_file.rs`, `fs_atomic.rs` | Lader/atomar schreiben/`.bad` | **übernehmen** (mit Tests) |
| fnf `jobs/search.rs` | Batch-Muster | Muster übernehmen, keine Job-Engine (die kommt in 007) |
| fnf `shared/dialog/` (`DialogService`, `Modal`, Fokusfalle) | Dialog „Bibliotheken“ | **übernehmen**, gekürzt |
| fnf `src/assets/font-awesome-4.5.0/` | Icons | **übernehmen** (nur `css` + `woff2`) |

## E1 – Ordnerdialog

- **A: `tauri-plugin-dialog` im Frontend** (`dialog:allow-open`): einfach, aber die WebView könnte Dialoge beliebig
  öffnen; der Pfad käme ungeprüft zurück.
- **B: eigener Command mit `rfd`**: dasselbe wie A unter der Haube, aber eine Abhängigkeit mehr zu pflegen.
- **C (Empfehlung): Command `pick_folder(start?)`**, der intern `app.dialog().file().blocking_pick_folder()` aus dem
  Plugin aufruft (Rust-API; braucht **keine** Capability). Läuft in `spawn_blocking`, Ergebnis geht durch
  `validate_input_path`. Die WebView bekommt keine neue Berechtigung, Regel A2 bleibt gewahrt.
- Texteingabe des Pfads bleibt möglich (Dialog „Bibliotheken“).

## E2 – Symlinks

Die Vorlage folgte allen Links ohne Zyklusschutz (legacy §10.1). Empfehlung: **Datei-Links folgen** (kein Zyklus
möglich; Ziel wird per `metadata` geprüft, kaputte Links gezählt), **Ordner-Links nicht** (Zyklen, Ausbruch aus der
Bibliothek, doppelte Bücher). Die Statuszeile zeigt „3 verknüpfte Ordner übersprungen“, damit niemand rätselt. Bei
Bedarf später eine Option je Bibliothek mit Besucht-Menge (Gerät + Inode).

## E3 – Endungen

Feste Liste wie 001 (`cbz cbr cb7 cbt pdf`). Begründung: Marcs Konfiguration nutzt nur `.cbz/.cbr`; `.zip`/`.rar`
wären in gemischten Ordnern meist keine Comics; das Format erkennt 003 ohnehin am Inhalt. Spätere Erweiterung über
`BOOK_EXT` ist eine Zeile.

## E4 – Icons

Font Awesome 4.5.0 wie in files-and-folders (Lizenz SIL OFL/MIT, bereits geprüft): `font-awesome.min.css` +
`fontawesome-webfont.woff2` (~70 KB) nach `src/assets/font-awesome-4.5.0/`. Auswahl im Dialog aus 24 Icons (`book`,
`star`, `bookmark`, `rocket`, `flag`, `heart`, `fire`, `bolt`, `globe`, `university`, `child`, `user-secret`, `paw`,
`magic`, `diamond`, `trophy`, `film`, `camera`, `music`, `car`, `plane`, `ship`, `tree`, `moon-o`). Gespeichert wird der
Name ohne `fa-`; Rust prüft gegen dieselbe Liste (unbekannt → `book`).

## E5 – Cache

- Ort: `app_cache_dir()/libraries/<fnv64(root) hex>.json` – Schlüssel ist die **Wurzel**, nicht die Id (Ordner
  geändert → neuer Cache; zwei Bibliotheken auf denselben Ordner teilen ihn).
- Inhalt: `{ "version": 1, "root": "…", "scannedAt": <ms>, "books": [BookEntry…], "stats": {…} }`; beim Laden wird
  `root` verglichen, falsche Version/kaputt → wie nicht vorhanden (Datei → `.bad`, Lader aus `config_file.rs`).
- Schreiben atomar (`fs_atomic::write_atomic`) nach jedem vollständigen Scan; **abgebrochene oder fehlgeschlagene**
  Scans schreiben nicht.
- Grenze beim Lesen: 256 MiB (≈ 1 Mio. Bücher). Messung mit 50 000 Büchern in Phase 2 (Zeit Lesen/Parsen/Senden) →
  `docs/architecture.md`; erst wenn das > 300 ms dauert, Binärformat erwägen.
- Nie im Comic-Ordner (legacy §10.2). „Cache leeren“ kommt mit 009.

## E6 – Unicode-Normalisierung (neu, aus Marcs Sammlung)

macOS liefert Namen so, wie sie gespeichert wurden – bei Marc gemischt NFC/NFD. Pfade bleiben **unverändert** (sonst
findet Rust die Datei nicht mehr). Für Menschen:
- **Filter** (004): Suchtext und `relPath` vor dem Vergleich `normalize('NFC').toLowerCase()`; der normalisierte
  Schlüssel wird einmal je Buch im Store berechnet (Textoperation, kein Pfad-Split – Regel bleibt gewahrt).
- **Anzeige-Reihenfolge**: im Frontend mit `new Intl.Collator(locale, { numeric: true, sensitivity: 'base' })` – das
  ist natürlich (`2` < `10`), ohne Groß-/Kleinschreibung und behandelt NFC/NFD gleich. 004 braucht ohnehin weitere
  Sortierungen (Datum, Größe). Messung: 50 000 Bücher sortieren < 150 ms, sonst Schlüssel in Rust vorberechnen.
- **Rust** sortiert weiter mit `natural_cmp` – nur damit Cache und Diffs deterministisch sind; erweitert um einen
  NFC-Vergleich? Nein: dafür bräuchte es eine Crate (`unicode-normalization`), und die Anzeige sortiert ohnehin das
  Frontend.

## E7 – `files.json` der Vorlage

Sie liegt in Marcs Comic-Ordner und enthält nur relative Pfade (keine Größe/Zeit). Ein Scan dauert lokal < 1 s – der
Gewinn wäre minimal. Wir lesen und schreiben sie **nicht** (der alte Server kann parallel weiterlaufen).

## E8 – Ordner-Überwachung

Verschoben. Begründung: Netzlaufwerke melden Änderungen nicht zuverlässig (fnf `watch/netfs.rs`), der Neu-Scan beim
Öffnen plus `Mod+R` reicht für eine Sammlung, die sich selten ändert. Eintrag bleibt unter „Folge-Ideen“.

## E9 – Scan-Hub

- Rust-State `ScanHub`: `Map<root, RunningScan { cancel: Arc<AtomicBool>, subscribers: Vec<Channel<LibraryEvent>> }>`.
- `open_library(id, onEvent)`: sendet sofort `cached` (falls Cache), startet einen Scan – oder hängt den Kanal an
  einen laufenden Scan derselben Wurzel an (legacy §3 „runningScansPromises“).
- Bibliothek wechseln bricht nicht ab: der alte Scan läuft zu Ende und schreibt seinen Cache; das Frontend verwirft
  dessen Ereignisse (Sequenz). Abbruch nur ausdrücklich (`cancel_scan`, Knopf „Abbrechen“ während des Erstscans).
- Ein Worker-Thread je Scan (`std::thread::spawn`, nicht der Async-Runtime-Thread); höchstens 4 Scans gleichzeitig,
  weitere warten.

## Verträge

### Rust → TS (DTOs, `model.rs` ↔ `libraries.models.ts`/`library.models.ts`)

```ts
interface Library {             // libraries.json
  id: string;                   // 'l' + 12 hex, von Rust vergeben (leer = neu)
  title: string;                // 1–100 Zeichen
  root: string;                 // absolut, nach ~-Expansion; muss beim Speichern NICHT existieren
  icon: string;                 // E4-Liste, Default 'book'
  initialFilter: string;        // ≤ 500 Zeichen (Wirkung in 004)
}
interface LibrariesConfig { version: 1; activeId: string | null; libraries: Library[] }  // ≤ 50 Bibliotheken
interface LibrariesLoaded { config: LibrariesConfig; warning: ConfigWarning | null }     // ConfigWarning wie fnf

interface ScanStats { books: number; dirs: number; unreadableDirs: number; skippedEntries: number;
                      skippedDirLinks: number; brokenLinks: number; truncated: boolean; durationMs: number }

type LibraryEvent =
  | { kind: 'cached'; root: string; books: BookEntry[]; scannedAt: number; stats: ScanStats }
  | { kind: 'started'; root: string; firstScan: boolean }
  | { kind: 'batch'; books: BookEntry[] }                                  // nur beim Erstscan (kein Cache)
  | { kind: 'progress'; books: number; dirs: number }                     // ≤ 4/s
  | { kind: 'diff'; added: BookEntry[]; removed: string[]; changed: BookEntry[] }  // nach Scan mit Cache
  | { kind: 'done'; scannedAt: number; stats: ScanStats }
  | { kind: 'cancelled' }
  | { kind: 'failed'; error: FsError; cacheKept: boolean };               // z. B. Laufwerk ausgehängt
```

`changed` = gleicher Pfad, andere Größe oder mtime. `removed` = Pfade. `BookEntry` bleibt wie in 001.

### Commands (alle `async`)

| Command | Parameter | Rückgabe | Fehler |
|---|---|---|---|
| `load_libraries` | – | `LibrariesLoaded` | – (Probleme als `warning`) |
| `save_libraries` | `config` | `LibrariesConfig` (bereinigt, Ids vergeben) | `invalid_libraries` (neu), `io` |
| `pick_folder` | `start?: string` | `string \| null` | `invalid_path` |
| `default_library_root` | – | `string \| null` (`~/Comics`, nur wenn vorhanden) | – |
| `open_library` | `id`, `onEvent: Channel<LibraryEvent>` | `void` (alles weitere als Ereignis) | `unknown_library` (neu) |
| `cancel_scan` | `id` | `void` | – |

`scan_library` (001) entfällt. Neue Fehlercodes `invalid_libraries`, `unknown_library` in `error.rs`, `fs-error.ts`,
`describeFsError()`.

### Module

Rust: `libraries.rs` (Konfig: sanitize, Ids, Icons; rein), `library.rs` (Walk mit `on_book`/`on_dir`-Rückruf und
Abbruch-Flag), `scan_cache.rs` (Pfad, Lesen/Schreiben, Diff; rein), `scan_hub.rs` (Threads, Abonnenten),
`config_file.rs` + `fs_atomic.rs` (übernommen), `commands.rs` (+ `pick_folder` mit Plugin).
Frontend: `core/libraries/` (`LibrariesApi`, Modelle), `core/library/library-api.ts` (`open(id, onEvent)` erzeugt
den `Channel` in der Fassade, `cancel`), `features/libraries/` (`LibrariesStore` Root, Dialog), `features/library/`
(`LibraryStore` je Ansicht, ereignisgetrieben; `book-order.ts` Collator + NFC-Schlüssel, rein), `shared/dialog/`.

## UI

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ [★ Comics ▾]  [⟳]                       584 books · updated 3 min ago   (role=status) │  Toolbar
├──────────────────────────────────────────────────────────────────────────────────────┤
│  Liste wie 001 (→ Cover-Grid in 004), während des Erstscans wächst sie                │
└──────────────────────────────────────────────────────────────────────────────────────┘
 Menü „★ Comics ▾“ (Menü-Button nach APG): ★ Comics ✓ · 🚀 Sci-Fi · ─── · Manage libraries…
```

- Status: `cached` → „584 books · updated 3 min ago · refreshing…“; Erstscan → „Scanning… 1 234 books in 56 folders“
  + Knopf „Cancel“; `failed` mit Cache → „Folder not reachable – showing the state of 22.10. 14:32“ (Hinweisfarbe).
- **Dialog „Manage libraries“** (`role="dialog"`, `aria-modal`, Fokusfalle, Fokus zurück an den Menü-Button):
  links Liste (`listbox`, ↑/↓, `Alt+↑/↓` verschieben), rechts Formular: Titel, Ordner (Textfeld + „Choose…“ →
  `pick_folder`), Icon (Radiogruppe 6×4), Anfangsfilter; unten „Add“, „Remove“, „Save“ (`Mod+Enter`), „Cancel“
  (`Esc`). Prüfung live (leerer Titel, relativer Pfad); Ordner existiert nicht → Warnung, Speichern erlaubt
  (Laufwerk evtl. nur gerade nicht verbunden).
- **Erster Start** (keine Bibliothek): leere Ansicht „No library yet“ mit „Choose folder…“ und – falls `~/Comics`
  existiert – „Use ~/Comics“. Ist der Titel leer, setzt `save_libraries` den Ordnernamen ein (Rust rechnet ihn aus
  dem Pfad, nicht das Frontend).
- Tasten (bis 008 im zentralen Handler der Ansicht): `Mod+R` neu scannen, `Mod+1…9` Bibliothek wählen.

## Tests

**Rust**
- `libraries.rs`: sanitize (leerer/zu langer Titel, relativer Pfad, doppelte Ids, unbekanntes Icon, > 50 Einträge,
  `activeId` ungültig → erste), Id-Vergabe, Titel-Vorschlag aus dem Ordnernamen (Unicode), Rundreise JSON, kaputte
  Datei → `.bad` + Warnung (Lader aus fnf).
- `library.rs`: Abbruch mitten im Walk, Rückrufe (Batches), Datei-Symlink gefolgt, kaputter Link gezählt, Ordner-Link
  übersprungen + gezählt, NFC/NFD-Namen beide gefunden (Linux: beide Formen als getrennte Dateien).
- `scan_cache.rs`: Pfad je Wurzel, Rundreise, andere Version/kaputt/fremde Wurzel → `None`, Diff (neu, entfernt,
  geändert per Größe/mtime, unverändert), abgebrochener Scan schreibt nicht.
- `scan_hub.rs`: zweiter Öffner hängt sich an (ein Walk), Abbruch, Fehler bei fehlender Wurzel mit/ohne Cache
  (`cacheKept`), Begrenzung auf 4 parallele Scans.
- Messung: 50 000 Dateien in 2 500 Ordnern (Generator) – Erstscan, Cache lesen, Diff → Zahlen in
  `docs/architecture.md`. Zusätzlich eine **Spiegel-Sammlung** aus Marcs 584 Namen (leere Dateien, gleiche Ordner,
  gleiche NFC/NFD-Formen; nur im Scratch-Ordner, nicht im Repo).

**Frontend**
- `LibrariesStore`: laden (mit Warnung), speichern, aktive wählen, erste Bibliothek.
- `LibraryStore`: Ereignisfolgen `cached → started → diff → done`, `started → batch* → done`, `cached → failed`
  (Cache bleibt), veraltete Ereignisse nach Wechsel verworfen, Abbruch.
- `book-order.ts`: natürliche Reihenfolge, NFC = NFD, Groß/klein; Filter-Schlüssel.
- Dialog: Tastatur (Liste, Verschieben, Esc/Mod+Enter), Fokusfalle, Validierungstexte; Menü-Button nach APG.

**Ende-zu-Ende** (Container): Test-Sammlung + Spiegel-Sammlung, zwei Bibliotheken, Neustart, Ordner umbenennen
(= „ausgehängt“), Erstscan abbrechen. **Auf dem Mac** (Marc): Abnahme mit `comics.nosync` – Liste der Schritte im
Abschlussbericht.

## Neue Abhängigkeiten

| Paket | Seite | Wofür |
|---|---|---|
| `tauri-plugin-dialog` (nur Rust-API, keine Capability) | Rust | nativer Ordnerdialog (E1) |
| Font Awesome 4.5.0 (Assets, kein npm-Paket) | Frontend | Bibliotheks-Icons (E4) |

## Akzeptanzkriterien (aus dem Auftrag, präzisiert)

- [ ] Zwei Bibliotheken anlegen, wechseln, umbenennen, entfernen – überlebt einen Neustart.
- [ ] Zweites Öffnen zeigt die Bücher aus dem Cache sofort (< 300 ms bei 50 000); neue Dateien erscheinen nach dem
      Hintergrund-Scan ohne Neuladen der Ansicht.
- [ ] Im Comic-Ordner entsteht keine Datei (auch keine `files.json`).
- [ ] Nicht erreichbarer Ordner: Cache + verständlicher Hinweis; ohne Cache: Fehler mit „Choose folder…“.
- [ ] Filter-Schlüssel und Reihenfolge behandeln `ü` (NFC) und `u` + U+0308 (NFD) gleich.
- [ ] Marcs Sammlung (Mac): 584 Bücher, Reihenfolge natürlich, zweiter Start sofort.

## Fortschritt

- [x] Phase 1: Design (dieses Dokument) – 🛑 wartet auf Freigabe
- [ ] Phase 2: Rust
- [ ] Phase 3: Frontend
- [ ] Phase 4: Ende-zu-Ende
- [ ] Phase 5: Doku
- [ ] Phase 6: Abschlussprüfung
