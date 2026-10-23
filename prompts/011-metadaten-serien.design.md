# Design 011 – Metadaten, Serien und Ordneransicht

> Status: **Entwurf – wartet auf Freigabe** · 23.10.2026 · Branch `feat/metadaten-serien` · Auftrag:
> [`011-metadaten-serien.md`](011-metadaten-serien.md) · baut auf 002 (Scan, Scan-Cache, ScanHub), 003 (Bücher nach
> Inhalt lesen), 004 (Cover-Grid, Filter, Sortierung, Ansichtszustand), 005 (Leser-Sitzung, Lesestand) und 008
> (Aktionen, Keymaps, Menü) auf. Vorlage: legacy §6 (`extractSeriesFilter`).

## Entscheidungen auf einen Blick

| Nr. | Frage | Empfehlung |
|---|---|---|
| E1 | XML-Parser | **`quick-xml` 0.42** (`default-features = false`) – liegt schon im `Cargo.lock` (über `plist`), kein neuer Download; reiner Pull-Parser ohne DTD/externe Entitäten, Entitäten nur die fünf vordefinierten + numerische. Ein eigener Parser müsste CDATA, Entitäten, Kommentare, Attribute, BOM selbst richtig machen – bei feindlicher Eingabe das größere Risiko |
| E2 | Gruppierte Ansicht | **dasselbe Cover-Grid mit Ebenen**: Kachel ist Buch *oder* Gruppe (Serie/Ordner); Enter/Klick auf eine Gruppe öffnet ihre Ebene im selben Grid, Breadcrumb in der Toolbar, `Backspace`/`Alt+↑` eine Ebene hoch. Ein Grid, ein Cursor, eine Tastatur – keine zweite Ansicht mit eigenem Fokusmodell |
| E3 | Wann ComicInfo lesen? | **Metadaten-Durchlauf als zweite Phase des Scans** (gleicher Thread im `ScanHub`, nach `done`): nur Bücher ohne Metadaten (neu/geändert), abbrechbar, Ergebnis im Scan-Cache. **Nicht** bei der Cover-Erzeugung: Cover kommen meist aus Cache/Sidecar (dann wird das Buch gar nicht geöffnet), und Cover-Pool und Scan-Cache blieben sonst gekoppelt |
| E4 | Wo steht die Namens-Heuristik? | **TypeScript**, rein (`book-info.ts`) mit Fallkatalog als JSON – wie `filter-logic`; Änderungen an der Heuristik machen keinen Cache ungültig, ersetzt `extractSeriesFilter` (Vorlage-Fälle bleiben grün). Rust liefert nur, was in der Datei steht |
| E5 | Serie aus XML oder Name? | **feldweise**: ComicInfo gewinnt, wenn das Feld nicht leer ist; sonst Name; sonst (Name beginnt mit einer Nummer) der **Ordnername**. Quelle je Buch bekannt (Tooltip) |
| E6 | Ordner aus `relPath` | Gruppieren nach den `/`-Segmenten von `relPath` im Frontend. `relPath` ist laut Vertrag (model.rs) „Segmente mit `/` verbunden, nur Anzeige/Filter/Sortierung“ – die Ordneransicht ist genau das; daraus wird **nie** ein Dateipfad. Ordnerkacheln haben deshalb kein „Im Finder zeigen“ (das ginge nur über einen neuen Command) |
| E7 | Bücher ohne Serie / Serie mit einem Buch | in der Serienansicht als **normale Buchkachel** (Enter liest), Gruppenkachel erst ab 2 Büchern – sonst wäre jede Einzelausgabe ein Klick mehr |
| E8 | Filter in Gruppenansichten | der Filter wirkt auf **Bücher**; Gruppen ohne Treffer verschwinden, die Anzahl zeigt Treffer/alle (`3/12`). Filter-Syntax: `series:`, `year:` (Jahr oder `1990-1999`), dazu `writer:` und `publisher:` (gleicher Mechanismus, kostet nichts); Werte mit Leerzeichen in `"…"`; `+`/`-` davor wie bei Wörtern. Unbekannte `xyz:` bleiben normale Wörter → abwärts kompatibel |
| E9 | Sortierung | neuer Modus **„Serie“** (Serienschlüssel → Band/Volume → Nummer numerisch, `1.5` und `12a` richtig → Pfad). In einer Serien-Ebene ist das die feste Reihenfolge (Akzeptanz: „Bände in Nummernfolge“); Gruppenkacheln nach Name (Collator), bei „Datum“ nach neuestem Buch |
| E10 | Lesefortschritt einer Serie | Balken = mittlerer Fortschritt der Bände (gelesen = letzte Seite erreicht zählt 1); `aria-label`/Tooltip „12 Bände, 3 gelesen“ |
| E11 | Manga aus ComicInfo | `Manga=YesAndRightToLeft` → der Leser beginnt dieses Buch rechts-nach-links (005 E4 → 011); `M` schaltet wie bisher die globale Einstellung, ein Buch mit RTL-Angabe bleibt RTL, solange die globale Einstellung aus ist (Hinweis in der Toolbar „Manga (ComicInfo)“) |
| E12 | Ansicht wählen | Toolbar: Gruppe aus drei Icon-Knöpfen (`role="radiogroup"`): Liste `fa-th`, Serien `fa-clone`, Ordner `fa-folder-o`; Aktionen `view.flat`/`view.series`/`view.folders` im Menü „View“ (checked), in der Palette, Kürzel **`Mod+Shift+L` / `Mod+Shift+S` / `Mod+Shift+D`** (Ziffern mit Shift sind je Tastaturbelegung andere Zeichen). Je Kategorie gemerkt (Ansichtszustand v2) |

## Bestand

| Baustein | wofür | Befund |
|---|---|---|
| `model.rs` `BookEntry` ↔ `scan.models.ts` | Bücher im Scan | **erweitern**: `meta?: BookMeta` |
| `scan_cache.rs` (`VERSION = 2`, `diff` vergleicht Größe/mtime/Format) | Cache je Ziel | **erweitern**: `VERSION = 3` (alte Caches = fehlend → ein Neu-Scan, 0,5 s/50 000), Metadaten aus dem alten Cache übernehmen, wenn Größe+mtime+Format gleich |
| `scan_hub.rs` (`run`, `scan_once`, `queued` nach Abbruch, Teile ≤ 2000) | Scan je Ziel | **erweitern**: Phase `meta` nach `done`; neue Ereignisse `metaProgress`, `meta`, `metaDone`; ein neuer Öffner bricht die Metadaten-Phase ab und reiht sich über `queued` ein (vorhandener Mechanismus) |
| `book::list`/`book::read` mit `Budget` | Einträge, ein Eintrag mit Grenze | **passt** (eigene, kleinere Grenzen für ComicInfo) |
| `cover::choose` (versteckt, `__MACOSX`) | Titelseite | Regeln für „versteckt“ **wiederverwenden** für die Wahl von `ComicInfo.xml` |
| `series-filter.ts` (`extractSeriesFilter`) | „Serie filtern“ (004) | **wird ersetzt** durch `book-info.ts` + `series:`-Filter; die Vorlage-Fälle bleiben als Testfälle |
| `filter-logic.ts` + `.cases.json` | Filter `+/-` | **erweitern** um Feldterme; alle bisherigen Fälle bleiben grün |
| `book-order.ts` (`SortMode`, `sortBooksBy`) | Sortierung | **erweitern**: `'series'` |
| `GridStore` (Liste `BookEntry[]`, Cursor = Buch-Id) | Grid-Zustand | **muss erweitert werden**: Ansicht, Ebene, Kachelliste `GridItem[]`, Cursor = Kachel-Id |
| `cover-renderer.ts` | Kachel | **erweitern**: Gruppenkachel (Stapel-Optik, Zähler, Name, Fortschritt) |
| `view-state.ts` (v1) | je Kategorie | **v2**: `view`, `level`; v1 wird gelesen (Ansicht = flach) |
| `ReaderService.open(cat, books, index)` | Sitzung = Liste | **passt**: in einer Serien-Ebene ist die Liste schon in Nummernfolge |
| `reader-settings.ts` (Manga global) | Leser | **erweitern** (E11) |
| Mono-Repo GuiExpert Table | Cover-Grid | **passt**: Items sind beliebige Objekte (`CoverGridTableModel<T>`), Breadcrumb liegt außerhalb der Table. Keine Lücke erwartet |

## Verträge

### Rust: `BookMeta` (neu, `src-tauri/src/comic_info.rs`)

```rust
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookMeta {
    #[serde(default, skip_serializing_if = "Option::is_none")] pub series: Option<String>,    // ≤ 200 Zeichen
    #[serde(default, skip_serializing_if = "Option::is_none")] pub number: Option<String>,    // ≤ 16, wie geschrieben („1.5“, „12a“)
    #[serde(default, skip_serializing_if = "Option::is_none")] pub volume: Option<i32>,       // 0…9999
    #[serde(default, skip_serializing_if = "Option::is_none")] pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub year: Option<i32>,         // 1000…2999
    #[serde(default, skip_serializing_if = "Option::is_none")] pub writer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub publisher: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub page_count: Option<u32>,   // 1…100 000
    #[serde(default, skip_serializing_if = "Option::is_none")] pub manga: Option<Manga>,      // "no" | "yes" | "rtl"
}
// BookEntry: #[serde(default, skip_serializing_if = "Option::is_none")] pub meta: Option<BookMeta>
//   None        = noch nicht gelesen (Durchlauf holt es nach)
//   Some(leer)  = gelesen, nichts gefunden (keine ComicInfo, PDF, kaputt, verschlüsselt …)
```

TS (`scan.models.ts`): `interface BookMeta { series?: string; number?: string; volume?: number; title?: string;
year?: number; writer?: string; publisher?: string; pageCount?: number; manga?: 'no' | 'yes' | 'rtl' }`,
`BookEntry.meta?: BookMeta`.

### ComicInfo lesen (rein, ohne Tauri)

- `comic_info::find(entries) -> Option<&Entry>`: Basisname `ComicInfo.xml` ohne Groß-/Kleinschreibung, nicht versteckt,
  nicht unter `__MACOSX`; bei mehreren der mit den wenigsten Ordnerebenen, dann natürliche Reihenfolge.
- `comic_info::read_book(path, cancel) -> Result<BookMeta, FsError>`: PDF → `Ok(leer)` ohne Öffnen (Erkennung über
  `book::detect`); sonst `book::list` + `book::read` mit **eigenem Budget: 5 s, ≤ 64 MiB übersprungen (solide), Datei
  ≤ 1 MiB**.
- `comic_info::parse(bytes) -> BookMeta`: BOM UTF-8/UTF-16LE/BE; Deklaration `ISO-8859-1`/`windows-1252` → Latin-1
  (Byte → Zeichen); sonst UTF-8 (ungültig → leer). Nur direkte Kinder des Wurzelelements `ComicInfo` (Name ohne
  Groß-/Kleinschreibung), Tiefe ≤ 32, `<!DOCTYPE>` wird übersprungen (keine Entitäten daraus). Texte: Entitäten
  aufgelöst, Steuerzeichen raus, Leerraum zusammengefasst, auf die Grenzen gekürzt; Zahlen außerhalb der Bereiche →
  `None`; `Manga`: `Yes` → `yes`, `YesAndRightToLeft` → `rtl`, `No` → `no`, sonst `None`. **Ungültiges XML → leer**
  (fail-closed, keine halben Felder).
- Fehler: bleibende (`no_image` gibt es hier nicht; `archive_error`, `archive_encrypted`, `archive_too_large`,
  `unsupported_format`) → `Some(leer)` (wie `cover::remembered`); vorübergehende (`timeout`, `io`, `not_found`) →
  `None`, nächster Scan versucht es wieder.

### ScanHub: Phase `meta`

```
open → cached… → started → (batch…) → diff → done → metaProgress{done,total} … meta{items} … → metaDone{cancelled}
```

- Nach dem Walk: Metadaten aus dem alten Cache übernehmen (`path` + Größe + mtime + Format gleich). Cache schreiben,
  `done` senden wie bisher (UI ist sofort fertig). Danach – nur wenn Bücher mit `meta: None` übrig sind – Phase `meta`
  im selben Thread; der Walk-Platz (`MAX_PARALLEL`) wird **vorher freigegeben**, der Eintrag in `running` bleibt.
- `metaProgress { done, total }` ≤ 4/s; `meta { items: [{ id, meta }] }` gesammelt alle **500 ms** (≤ 2000 je
  Ereignis) – das Frontend sortiert dann einmal statt 50-mal pro Sekunde; `metaDone { cancelled }` am Ende.
- Cache-Zwischenstände alle 10 s und am Ende (`write_atomic`) – Abbruch verliert höchstens 10 s.
- **Neuer Öffner während `meta`** (Kategorie wieder geöffnet, `Mod+R`): Abbruch-Flag setzen, Öffner in `queued` – der
  vorhandene Weg aus Review 002 #2 startet nach dem Ende einen neuen Walk mit dem frischen Cache; dessen Phase `meta`
  macht beim Rest weiter. `cancel_scan` bricht auch die Phase `meta` ab (`metaDone { cancelled: true }`).
- Ein Thread je Ziel, keine Bilddekodierung → keine Decoder-Plätze; Phase läuft mit niedriger Priorität im Sinne
  von „ein Buch nach dem anderen“, der Cover-Pool bleibt unberührt.

```ts
| { kind: 'metaProgress'; done: number; total: number }
| { kind: 'meta'; items: { id: string; meta: BookMeta }[] }
| { kind: 'metaDone'; cancelled: boolean }
```

Keine neuen Commands, keine neuen Fehlercodes.

### Frontend: abgeleitete Buch-Infos (rein, `features/grid/book-info.ts`)

```ts
interface BookInfo {
  series: string | null;      // Anzeige
  seriesKey: string | null;   // NFC, klein, `_` → Leerzeichen, Leerraum zusammengefasst, Rand-Satzzeichen weg
  seriesSource: 'comicinfo' | 'name' | 'folder' | null;
  number: string | null;      // wie geschrieben
  numberValue: number | null; // „01“ → 1, „1.5“ → 1.5, „12a“ → 12 (+ Rest für die Reihenfolge)
  volume: number | null;
  title: string | null;
  year: number | null;
}
parseBookName(name: string, folder: string | null): Omit<BookInfo, 'seriesSource'…>  // die Heuristik
bookInfo(book: BookEntry): BookInfo   // ComicInfo feldweise vor Name (E5); je Objekt in einer WeakMap
```

Heuristik (Vorlage erweitert), auf dem Namen ohne Endung, `_` zählt als Leerzeichen:

| Muster | Beispiel | Serie · Nummer · Titel · Jahr |
|---|---|---|
| `Serie NN - Titel (Verlag JJJJ)` | `Im roten Bereich 01 - Carrera ( Salleck 2015) (TP)` | Im roten Bereich · 01 · Carrera · 2015 |
| `Serie_NN_-_Titel_(JJJJ)` | `Neptun_01_-_Episode_1_(2022)_(Splitter)` | Neptun · 01 · Episode 1 · 2022 |
| `Serie #NN` | `Saga #12` | Saga · 12 |
| `Serie Band N` / `Bd. N` / `Nr. N` / `Heft N` | `Asterix Band 3 - Asterix und Kleopatra` | Asterix · 3 · Asterix und Kleopatra |
| `Serie TNN` / `Tome N` | `Spirou T01 - Le Voyageur` | Spirou · 01 · Le Voyageur |
| `Serie vN NN` / `Vol. N` | `Batman v2 012` | Batman · 012 · Band 2 |
| Serie beginnt mit Ziffern | `100 Bullets 001`, `2000 AD 1234` | 100 Bullets · 001 / 2000 AD · 1234 (die **letzte** freie Zahl vor ` - `/`(`/Ende ist die Nummer) |
| Name beginnt mit Nummer | `005_Bessy_ _Im_Tal…` in Ordner `Bessy` | Bessy (Ordner) · 005 · Im Tal … (der Ordnername am Anfang des Rests wird abgeschnitten) |
| nur Serie | `Watchmen`, `Bessy` | Watchmen · – |
| Jahr | `(… 1965)`, `[2015]` | vierstellige 19xx/20xx in Klammern = Jahr, nie Nummer |
| Nummer-Bereich | `Bessy 001 002 Das Geheimnis …` | Bessy · 001 (erste Zahl) |

Katalog `book-info.cases.json` mit ≥ 60 Fällen (die Vorlage-Fälle aus `series-filter.spec.ts` und `filter-logic.cases.json`
eingeschlossen, Umlaute, NFD, Emoji, leere/komische Namen). **Bitte um eine Namensliste** (s. Offene Fragen).

### Filter (Erweiterung von `filter-logic.ts`)

- Term = `[+|-]feld:wert` mit `feld ∈ {series, year, writer, publisher}`; Wert bis zum Leerzeichen oder in `"…"`
  (`series:"im roten bereich"`). `series`: Teilwort im `seriesKey`; `year`: `2015` oder `2010-2015` gegen
  `bookInfo().year`; `writer`/`publisher`: Teilwort (NFC, klein) in ComicInfo.
- Ohne `+`/`-` gehört ein Feldterm zu den ODER-Wörtern (wie bisher Wörter). Unbekannte Felder, leerer Wert oder
  `year:` ohne Zahl → das ganze Wort wird wie bisher im Pfad gesucht (abwärts kompatibel).
- „Serie filtern“ im Buchmenü setzt künftig `series:"<serie>"` (statt `+Wort +Wort`), Fokus bleibt auf dem Buch.

### Ansichten und Ebenen (`features/grid/grouping.ts`, rein)

```ts
type ViewMode = 'flat' | 'series' | 'folders';
type GridItem =
  | { kind: 'book'; id: string; book: BookEntry }                // id = Buch-Id
  | { kind: 'group'; id: string; group: 'series' | 'folder';     // id = 's:' + seriesKey | 'd:' + relDir
      key: string; label: string; cover: BookEntry; count: number; total: number;
      progress: number | null; newestMs: number | null };
groupBySeries(books, sort): GridItem[]              // Ebene 0; Gruppen ≥ 2 Bücher (E7)
seriesBooks(books, seriesKey): BookEntry[]          // Ebene 1, Reihenfolge E9
folderLevel(books, relDir, sort): GridItem[]        // Unterordner (Kachel) + Bücher direkt darin
breadcrumb(view, level): { label, level }[]
```

- `GridStore`: `view`, `level` (`null` | Serienschlüssel | `relDir`), `items = computed(filtered → Ebene)`, Cursor und
  `topId` auf **Kachel-Ids**; `open(item)` (Gruppe → Ebene, Buch → Leser mit den Büchern der Ebene), `up()` (Cursor
  auf die verlassene Gruppe), Ebene, die durch Filter/Scan leer wird → eine Ebene höher.
- `read(book)` übergibt dem Leser die **Bücher der aktuellen Ebene** in Anzeigereihenfolge (Serien-Ebene =
  Nummernfolge, Akzeptanz 1).
- Ordner-Kachel: Cover = erstes Buch des Teilbaums in Pfadreihenfolge, Zähler = Bücher im Teilbaum. Ordner ohne
  Bücher gibt es nicht (der Scan kennt nur Bücher).
- Ansichtszustand v2 (`cc.view.<id>`): `+ view`, `+ level`; v1 → `view: 'flat'`.

### Oberfläche

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ [≡ Comics ▾] [🔍 series:aste… 3/584 ×] [▦|❐|📁] [200×300▾] [Serie▾] [⟳] Status        [↑][↓] │
│  Serien › Asterix (12)                       ← Breadcrumb (nav, Links), nur in einer Ebene     │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌──────┐┐ ┌──────┐┐ ┌──────┐                                                                 │
│ │cover ││ │cover ││ │cover │   ← Gruppenkachel: zwei versetzte Kanten (Stapel), Zähler-Plakette │
│ │  12  ││ │   3  ││ │      │     oben rechts, Name unten über einem Verlauf, Fortschrittsbalken │
│ │Asterix┘ │Saga  ┘ │      │     Ordnerkachel: zusätzlich fa-folder vor dem Namen               │
│ └──────┘  └──────┘ └──────┘   ← Buchkachel unverändert (004 E1: kein Titel)                   │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Fokus-Reihenfolge: Menü → Filter → Ansichtsgruppe (Pfeiltasten innerhalb, `role="radiogroup"`/`radio`) → Größe →
  Sortierung → Neu-Scan → Breadcrumb-Links → Grid.
- Grid-Optionen (004 E8): Gruppenkachel `role="option"`, `aria-label` „Serie Asterix, 12 Bände, 3 gelesen“ bzw.
  „Ordner Bessy, 17 Bücher“; Live-Region sagt beim Ebenenwechsel „Asterix, 12 Bände“.
- Tooltip einer Buchkachel: `relPath` + Zeile „Asterix #3 · 1968 · Goscinny“ (Quelle der Serie: ComicInfo/Name/Ordner).
- Status während Phase `meta`: „ComicInfo 120 / 584“ (dezent, wie der Scan-Fortschritt), danach nichts.
- Neue Tokens (light + dark) für Plakette und Verlauf in `styles.css`.

### Tastatur und Aktionen

| Aktion | Kontext | Kürzel (alle OS) | Hinweis |
|---|---|---|---|
| `view.flat` / `view.series` / `view.folders` | global | `Mod+Shift+L` / `Mod+Shift+S` / `Mod+Shift+D` | Menü „View“ (checked), Palette |
| `grid.read` (vorhanden) | grid | `Enter` | Gruppe → öffnet die Ebene |
| `grid.levelUp` (neu) | grid | `Backspace`, `Alt+ArrowUp` | eine Ebene hoch; `Mod+ArrowUp` bleibt „erstes Buch“ |
| `grid.escape` (vorhanden) | grid | `Escape` | Filter leeren, ist er leer: eine Ebene hoch |
| `book.filterSeries` (Menü) | grid | – | setzt `series:"…"` |

Buchmenü einer Gruppenkachel: „Öffnen“, „Ersten ungelesenen Band lesen“, „Serie filtern“ (Serie) – keine
Datei-Aktionen.

## Tests

**Rust** (`comic_info.rs`, `scan_hub.rs`, `scan_cache.rs`, Generatoren aus `book/tests.rs`):
- `parse`: alle Felder; fehlende/leere; Entitäten (`&amp;`, `&#228;`), CDATA, Kommentare, Attribute am Wurzelelement;
  BOM UTF-8, UTF-16LE/BE, Latin-1-Deklaration; falsche Wurzel; ungültiges XML → leer; `<!DOCTYPE` mit eigener Entität
  (Billion Laughs) → nicht aufgelöst, schnell; Tiefe 10 000 → leer; Zahlen außerhalb der Bereiche; überlange Texte
  (gekürzt, Zeichen- nicht Bytegrenze, Emoji); `Manga`-Werte.
- `find`/`read_book`: CBZ/CBT/CB7/CBR4 mit `ComicInfo.xml`, `comicinfo.xml`, in Unterordner, unter `__MACOSX`
  (ignoriert), `._ComicInfo.xml` (ignoriert), > 1 MiB (→ leer), verschlüsselt (→ leer), PDF (→ leer, ohne Öffnen),
  CBR, das ZIP ist; Abbruch und Zeitlimit (→ `None`).
- Cache: `VERSION 3`, v2 → fehlend; Übernahme bei gleicher Größe/mtime, nicht bei geänderter; `meta` fehlt in alten
  Einträgen → `None`.
- ScanHub: Ereignisfolge mit Phase `meta`; nur fehlende werden gelesen (zweiter Scan liest nichts); Teile ≤ 2000;
  Zwischenstand im Cache nach Abbruch; neuer Öffner während `meta` → Abbruch + neuer Walk + Rest; `cancel_scan`;
  später Öffner bekommt Metadaten mit; Panik in einem Buch hält den Thread nicht an.

**Frontend** (Vitest):
- `book-info.cases.json` (≥ 60 Fälle) + feldweise Vorrang ComicInfo/Name/Ordner.
- `filter-logic.cases.json`: alle alten Fälle + Feldterme (`series:`, `"…"`, `+/-`, `year:` Bereich, unbekanntes Feld
  `foo:bar`, `series:` leer, `http://…`-artige Wörter).
- `grouping.spec.ts`: 3 Serien → 3 Gruppen mit richtiger Anzahl; Einzelbuch als Buchkachel; Ordnerebenen,
  Breadcrumb; Filter versteckt leere Gruppen; Sortierung Gruppen; Fortschritt; Perf: 50 000 Bücher gruppieren < 50 ms.
- `book-order.spec.ts`: Modus `series` (`1`, `1.5`, `2`, `10`, `12a`, Band vor Nummer).
- `grid.store.spec.ts`: Ansicht wechseln, Ebene öffnen/hoch, Cursor auf Gruppe zurück, Leser bekommt die Ebene in
  Nummernfolge, leere Ebene → hoch, Ansichtszustand v2 und v1-Migration.
- `category.store.spec.ts`: `meta`-Ereignisse ersetzen Bücher (Ids), `metaProgress` im Status, veraltete Ereignisse
  verworfen.
- `cover-renderer.spec.ts`: Gruppenkachel (Name nur als `textContent`, Zähler, Balken, Ordner-Icon).
- Aktionen/Keymap/Menü: neue Aktionen in Katalog, Palette, Menü „View“ (checked), Kürzel je OS.
- Reader: RTL aus ComicInfo (E11).

**Ende-zu-Ende** (Xvfb, Debug-Build): Testsammlung mit 3 Serien in verschachtelten Ordnern (eine mit
`ComicInfo.xml` und davon abweichenden Dateinamen, eine nur über Namen, eine `NNN_Serie_…` im Serien-Ordner), dazu
Umlaute/Emoji, kaputtes Archiv, CBR-als-ZIP, PDF → Akzeptanz: 3 Serienkacheln mit richtiger Anzahl, Klick → Bände in
Nummernfolge, `]` liest den nächsten Band; ComicInfo-Serie/-Nummer statt Name; Ordneransicht mit Breadcrumb;
`series:`/`year:`; Tastatur (Enter, Backspace, Esc), light und dark.

## Phasen

Wie 000: 2 Rust (comic_info + Cache + ScanHub, Specs zuerst), 3 Frontend (book-info, Filter, Gruppierung, Store,
Renderer, Toolbar, Aktionen, Leser), 4 E2E, 5 Doku (architecture A47–A5x, DTOs, README, CLAUDE.md, Index), 6 Check +
**Review durch einen separaten Agenten** (Schwerpunkt: XML-Parser und Archivzugriff gegen feindliche Dateien,
Nebenläufigkeit der Phase `meta` im ScanHub).

## Offene Fragen an Marc

1. **Namensliste**: Darf ich eine Liste der Dateinamen deiner Sammlung (z. B. `find … -name '*.cb?' | sed 's|.*/Comics/||'`
   als Textdatei in den Repo-Ordner, nicht eingecheckt) für den Heuristik-Katalog nutzen? Ohne sie baue ich den Katalog
   aus den Fällen oben und den bisherigen Testdaten.
2. E7 (Einzelbände als Buchkachel) und E12 (Kürzel `Mod+Shift+L/S/D`) – passt das so?
3. Haben deine CBRs ComicInfo? Bei soliden RARs liegt sie oft am Ende; mit der 64-MiB-Grenze (E3) würden wir sie dort
   auslassen statt das ganze Buch zu entpacken.

## Fortschritt

- 23.10.2026: Bestand gelesen, Entwurf geschrieben – wartet auf Freigabe. Container eingerichtet (Node 22.23.3, pnpm,
  Rust-Build).
