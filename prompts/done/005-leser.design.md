# Design 005 – Leser (Seiten anzeigen und blättern)

> Status: umgesetzt · freigegeben 23.10.2026 (Marc: „bearbeite selbständig“ – Empfehlungen gelten als freigegeben) ·
> Branch `feat/leser` · Auftrag: [`005-leser.md`](005-leser.md) · Vorlage: legacy §7, §10.4

## Entscheidungen auf einen Blick

| Nr. | Frage | Entscheidung |
|---|---|---|
| E1 | Streamen vs. Entpacken | **Hybrid nach Container**: ZIP, TAR und nicht-solides RAR liefern jede Seite **direkt** aus dem Buch (wahlfreier Zugriff, nichts auf Platte). 7z und **solides RAR** (nur sequentiell lesbar: Seite *n* kostet das Dekodieren von 1…*n*) werden **einmal sequentiell** in den App-Cache `pages/<schlüssel>/` entpackt; Seiten sind lieferbar, sobald sie geschrieben sind (Anfragen warten). Grenze 1 GiB, älteste Bücher zuerst weg, offene Bücher nie; aufgeräumt beim Start und bei jedem neuen Entpacken (legacy §10.4) |
| E2 | Original vs. skaliert | **Original-Bytes**, solange das Bild nicht wesentlich breiter ist als nötig: die URL trägt eine Zielbreite in Geräte-Pixeln (Stufen 1024/1600/2048/2560/3200/4096 aus `max(Fensterbreite, Fensterhöhe) × devicePixelRatio`). Ist das Bild > 1,25 × Stufe breit, skaliert Rust (Decoder mit Limits aus 003, `thumbnail`, JPEG q90). Bilder über den Grenzen aus A18 (64 MP) → 422. GIF bleibt Original (Animation) |
| E3 | Doppelseiten | **nicht in 005** (Folge-Idee): braucht verlässliche Maße aller Seiten und eine eigene Layout-Logik; die Vorlage kannte sie nicht |
| E4 | Manga (rechts → links) | **Schalter im Leser** (`M`, gemerkt global): kehrt Pfeiltasten, Klickdrittel und Wischen um. Je Buch/Kategorie später mit ComicInfo `Manga=YesAndRightToLeft` (011) |
| E5 | Lesefortschritt | `reading-state.json` im **App-Config-Ordner** (`{version, books: {<buchId>: {page, pages, updatedMs}}}`, ≤ 5 000 Bücher, älteste fallen weg), atomar geschrieben, gemerkt in Rust; **Balken am Cover** im Grid (Anteil gelesen) |
| E6 | Routing | **Zustand im Root-Service** `ReaderService` (keine URL-Leiste im Desktop): der Leser liegt als Vollflächen-Ebene über der Kategorie-Ansicht, das Grid bleibt darunter **montiert** (`inert`) → Zurück landet ohne Wiederherstellen an derselben Stelle; der Cursor steht danach auf dem zuletzt gelesenen Buch |

Weitere Festlegungen:

- **E7** Neues URI-Schema **`ccpage`** (eigenes Schema statt Unterpfad von `cccover`: andere Lebensdauer, Token statt
  Ids): Pfad `/<token>.<seite>.<breite>`; der Token (16 hex) entsteht bei `open_book` und gilt bis `close_book` – die
  WebView nennt nie einen Pfad. Antwort nur mit erkannten Bildtypen (Magic: JPEG, PNG, GIF, WebP, BMP), sonst 415;
  `X-Content-Type-Options: nosniff`.
- **E8** Parallelität: höchstens 4 Seiten gleichzeitig in Arbeit, > 16 wartende → 503 (Frontend fragt nach 1 s
  erneut); Dekodieren für das Skalieren teilt sich die 4 Decoder-Plätze mit den Covern (A21/003). Kleiner
  Speicher-Cache der letzten Antworten (64 MiB, LRU) für Zurückblättern und Vorausladen.
- **E9** Maße der Seiten: Rust schickt sie über den Channel von `open_book`, sobald bekannt (ZIP/TAR: Kopf jeder
  Seite – erste 128 KiB – in einem Hintergrund-Durchlauf; entpackte Bücher: beim Schreiben). Nicht-solides RAR:
  keine Vorab-Maße, das Frontend schätzt mit dem Seitenverhältnis der Nachbarseite und korrigiert beim Laden
  (`naturalWidth`), ohne dass die Lesestelle springt (Anker = Seite + Anteil).
- **E10** Einstellungen des Lesers (Modus, Breite/Höhe, Manga) in `localStorage` (`cc.reader`, v1) wie 004 E9;
  Umzug in die Einstellungen (Rust) mit 009.
- **E11** Vollbild über einen Command `toggle_fullscreen` (Fenster aus dem Aufruf) statt einer Window-Capability –
  die WebView bekommt keine neue Berechtigung.
- **E12** PDF: `open_book` meldet `unsupported_format` bis 006; im Menü ist „Lesen“ für PDF deaktiviert
  („Lesen (PDF folgt)“), Doppelklick/Enter öffnen ein PDF weiterhin mit der Standard-App.
- **E13** Keine Miniaturleiste in 005 (optional laut Auftrag): Schieberegler + Seitenanzeige reichen; Folge-Idee.

## Bestand

| Baustein | wofür | Stand |
|---|---|---|
| `book::list/read` (ZIP/TAR/7z/RAR, Grenzen, `Budget`) | Seiten lesen | passt für direktes Lesen; **fehlt**: ein Durchlauf über viele Einträge (`book::read_many`) für Entpacken und Maße, `rar_solid` |
| `cover::choose::pages` (natürlich, ohne versteckte/`__MACOSX`, alle Bildformate) | Seitenliste | passt (= fnf `comic::pages`) |
| `cover::image::decode` + Decoder-Plätze | Skalieren (E2) | muss erweitert werden: `scale_jpeg` mit demselben Semaphor |
| `BookRegistry` | nur gelistete Bücher | passt (`open_book` per Kategorie-Id + Buch-Id) |
| `fs_atomic::write_atomic`, `config_file` | `reading-state.json` | passt |
| Schema-Registrierung, `http_reply` (`lib.rs`) | `ccpage` | wird verallgemeinert (Header `nosniff`) |
| CSP `img-src` | `ccpage:` | muss erweitert werden |
| Grid: `act('read')`, `BookMenu.canRead`, `CoverRenderer` | Öffnen, Fortschrittsbalken | erweitern |
| `CategoryView` Tastatur (`document:keydown`) | ruht, solange der Leser offen ist | erweitern |

## Verträge

### Commands (alle `async`, blockierendes in `spawn_blocking`)

| Command | Parameter | Rückgabe | Fehler |
|---|---|---|---|
| `open_book` | `categoryId`, `bookId`, `onEvent: Channel<ReaderEvent>` | `OpenedBook` | `unknown_book`, `not_found`, `unsupported_format` (PDF), `archive_*`, `no_image`, `timeout` |
| `close_book` | `token` | `void` | – (unbekannt = schon zu) |
| `save_reading_position` | `categoryId`, `bookId`, `page`, `pages` | `void` | `unknown_book`, `io` |
| `load_reading_state` | – | `Record<bookId, ReadingPosition>` | – |
| `toggle_fullscreen` | (Fenster) | `boolean` (neuer Zustand) | `io` |

```ts
// core/reader/reader.models.ts  ↔  Rust reader/model.rs (serde camelCase)
export interface PageInfo { name: string; size: number; width: number | null; height: number | null }
export interface OpenedBook {
  token: string;            // 16 hex, gilt bis close_book
  pages: PageInfo[];        // Lesereihenfolge (natürlich)
  lastPage: number | null;  // gemerkte Seite (0-basiert), null = neu
  extracting: boolean;      // E1: 7z / solides RAR
}
export type ReaderEvent =
  | { kind: 'dims'; pages: { index: number; width: number; height: number }[] }
  | { kind: 'done' }                                   // Durchlauf fertig (Maße/Entpacken)
  | { kind: 'failed'; error: FsError };                // Durchlauf abgebrochen (Seiten danach: 422)
export interface ReadingPosition { page: number; pages: number; updatedMs: number }
```

### URI-Schema `ccpage`

`convertFileSrc('<token>.<index>.<width>', 'ccpage')` → `ccpage://localhost/…` bzw. `http://ccpage.localhost/…`
(Windows). `width` = 0 (Original) oder eine Stufe aus E2. Status: 200 Bild (`immutable`), 404 Token/Seite unbekannt
(Buch geschlossen), 415 kein erlaubter Bildtyp, 422 kaputt/verschlüsselt/zu groß/Zeitlimit, 503 voll, 500 Panik.
CSP: `img-src 'self' data: cccover: http://cccover.localhost ccpage: http://ccpage.localhost`.

### Dateien

```
<app config>/reading-state.json              E5
<app cache>/pages/<fnv64(Pfad, Größe, mtime)>/  E1: 00000.img … + complete (JSON: Seitenzahl, Maße)
```

## Rust

```
src-tauri/src/reader/
  mod.rs        ReaderService: Sitzungen (Token → Session, max. 4, älteste zu), serve(), Semaphor E8, LRU
  model.rs      OpenedBook, PageInfo, ReaderEvent, ReadingPosition (DTOs)
  url.rs        parse_path (streng), Breitenstufen
  source.rs     Seite holen: direkt (book::read) oder aus dem Entpack-Ordner (warten mit Condvar, Zeitlimit)
  extract.rs    sequentieller Durchlauf: Entpacken (7z, solides RAR) bzw. Maße (ZIP/TAR); Abbruch beim Schließen
  page_cache.rs pages/-Ordner: Schlüssel, complete-Marke, trim (älteste zuerst, offene geschützt)
  image.rs      sniff (Magic → MIME), Maße aus dem Kopf, Original oder skalieren (E2)
src-tauri/src/reading_state.rs  reading-state.json laden/merken/schreiben (≤ 5 000, älteste weg)
src-tauri/src/book/mod.rs       + read_many (ein Durchlauf, Präfix oder ganz), rar_solid
```

Grenzen: Seite ≤ 64 MiB (A18), Entpacken je Buch ≤ 2 GiB und ≤ 10 min, Maße-Durchlauf ≤ 60 s, direkte Seite ≤ 20 s.

## Frontend

```
core/reader/       reader.models.ts, reader-api.ts (ReaderApi: open, close, pageUrl, savePosition,
                   loadReadingState, toggleFullscreen)
testing/           fake-reader-api.ts
features/reader/   reader.service.ts  (Root: offene Sitzung {categoryId, books, index}, Lesestände für das Grid)
                   reader.store.ts    (je Leser: Buch laden, Seite, Modus, Maße, Position speichern, nächstes Buch)
                   reader-logic.ts    (rein: Tasten → Befehl, „erst scrollen, dann blättern“, Klickdrittel,
                                       Breitenstufe, Höhen/Versätze fortlaufend, sichtbarer Bereich, Anker)
                   reader-settings.ts (localStorage cc.reader v1)
                   reader.ts/.html/.css (Ansicht), reader-texts.ts
```

### Oberfläche

```
┌──────────────────────────────────────────────────────────────────────────────┐ Toolbar schwebt,
│ ← Zurück  Hägar 01 🦸     [════●══════════] 12 / 48   ▣/≡  ↔/↕  ⇄  ⛶       │ blendet nach 2 s
├──────────────────────────────────────────────────────────────────────────────┤ ohne Maus aus
│                     ┌──────────────────────┐                                 │ (sichtbar bei
│  Klick links        │                      │        Klick rechts             │ Fokus/Maus oben)
│  = zurück           │      Seite 12        │        = weiter                 │
│                     │                      │                                 │
│                     └──────────────────────┘                                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Ebene `role="dialog"`, `aria-modal="true"`, `aria-label` = Buchname; Fokusfalle wie `Modal`; das Grid dahinter
  `inert`. Fokus-Reihenfolge: Zurück → Schieberegler → Modus → Breite/Höhe → Manga → Vollbild → Seite (Lesefläche,
  `tabindex=0`). Seiten-`<img alt="Page 12 of 48">`, Live-Region „Page 12 of 48“ gedrosselt (400 ms).
- Fehler einer Seite: Platzhalter mit Text aus `describeFsError()` + „Erneut versuchen“; Buch nicht lesbar: Meldung
  + „Mit Standard-App öffnen“ + Zurück.

### Tasten (alle OS; `Mod` = ⌘ auf macOS, sonst Ctrl)

| Taste | Wirkung |
|---|---|
| `→` `↓` `n` `Space` `PgDn` | weiter (Einzelseite: erst bildschirmweise scrollen, dann blättern; fortlaufend: eine Bildschirmhöhe) |
| `←` `↑` `b` `Shift+Space` `PgUp` | zurück (gespiegelt) |
| `Mod+←/→/↑/↓`, `Home`/`End` | Anfang / Ende |
| `S` | Einzelseite ⇄ fortlaufend · `W` Breite ⇄ Höhe (Einzelseite) · `M` Manga |
| `]` / `[` | nächstes / vorheriges Buch der gefilterten Liste |
| `F11`, `⌘+Ctrl+F` | Vollbild |
| `Esc` | Vollbild verlassen, sonst zurück zum Grid |

Manga kehrt nur die *horizontalen* Gesten um (`←/→`, Klickdrittel, Wischen); `↑/↓`, `n/b`, `Space` bleiben.

## Tests

- **Rust**: `read_many` (alle Container, Präfix, Abbruch), Seitenliste (natürlich, `__MACOSX`, PNG/WebP), direkt
  lesen ZIP/TAR/RAR, Entpacken 7z (solide) + Warten auf Seiten, Abbruch beim Schließen, Cache-Trim (20 Bücher →
  begrenzt, offene geschützt), `parse_path`, `sniff` (HTML/SVG im Archiv → 415), Skalieren (breit → Stufe; schmal →
  Original-Bytes), `reading_state` (Grenze, kaputte Datei, Unicode), `command_rules`.
- **Frontend**: `reader-logic` (Tasten inkl. Manga, scroll-then-flip, Drittel, Stufen, Höhen/Anker), `ReaderStore`
  (laden, Fortsetzen, Modus/Seite, Position speichern gedrosselt, nächstes Buch, veraltete Antworten), `ReaderService`
  (öffnen/schließen, Cursor zurück), Komponente (Tastatur, Fehlerzustand), Renderer-Balken.
- **Ende-zu-Ende**: Testsammlung (CBZ 200 Seiten, CBR=ZIP, CBR stored RAR4, CB7 solide, CBT, PNG/WebP-Seiten,
  kaputtes Buch, PDF, Umlaute/Emoji), Zeit bis zur ersten Seite, Neustart → Position, Zurück → Grid-Stelle,
  20 Bücher → Cache begrenzt.

## Fortschritt

- [x] Phase 1 Design (dieses Dokument)
- [x] Phase 2 Rust (Commit d268559)
- [x] Phase 3 Frontend (3d84b12, E2E-Fix e5a2c9e)
- [x] Phase 4 Ende-zu-Ende (Xvfb, Testsammlung mit Umlauten/Emoji, CBZ/CBR=ZIP/RAR4/CB7 solide/CBT, PNG/WebP/GIF/BMP, kaputte Bücher und Seiten, PDF-Menü, Neustart → Position, Zurück → Grid-Stelle)
- [x] Phase 5 Doku
- [x] Phase 6 Abschluss + Review (`pnpm check` grün, Debug-Build, Review durch separaten Agenten)

## Review (separater Agent, 23.10.2026)

| # | Befund | Erledigt |
|---|---|---|
| 1 | `complete.json` mit anderer Seitenzahl: Pass meldete fertig, alle Seiten hingen bis zum Zeitlimit | „vollständig“ wird einmal in `open` entschieden (`Unpacked.from_cache`), sonst neu entpackt; Test `a_marker_of_another_page_count_is_not_trusted` |
| 2 | Schnelles `]`: veraltete `open`s verdrängen das gezeigte Buch (max. 4 Sitzungen) | `ReaderStore` öffnet nacheinander, übersprungene Bücher werden nie geöffnet; Test |
| 3 | Zwei Sitzungen desselben 7z/soliden RAR löschen sich gegenseitig die Seiten | ein `Arc<Unpacked>` je Schlüssel, geteilt, Pass stoppt erst mit dem letzten Leser; Test `two_sessions_of_one_book_share_the_unpacking` |
| 4 | Warten aufs Entpacken unbegrenzt, zweites Warten im Gate | ≤ 32 Wartende (sonst 503), `page_bytes` wartet nicht mehr (`busy` → 503) |
| 5 | Seiten-Cache kann das Limit weit überschreiten | je Buch ≤ Cache-Grenze, Trim auch nach jedem Entpacken |
| 6 | Solides RAR: verworfene Daten eines zu großen Eintrags ohne Byte-Grenze | zählen gegen `MAX_SKIPPED` |
| 7 | Trim gegen gleichzeitiges `open` | `trim` und `open` unter derselben Sperre (`unpacks`); fehlende Datei → 503 statt 500 |
| 8 | Retry-Timer überleben den Buchwechsel | beim neuen Token gelöscht |
| 9 | Seitenzahl des Lesestands kommt aus der WebView | offen (nur Anzeige des Balkens betroffen); mit 009 über den Token lösen |
