# Design 010 – Duplikate finden und aufräumen

> Status: **Entwurf – wartet auf Freigabe** 🛑 · Datum: 23.10.2026 · Branch `feat/duplikate` (von `main`) ·
> Auftrag: [`010-duplikate.md`](010-duplikate.md) · Vorlage: legacy §8 (SHA-256 über die ganze Datei, keine UI; TODO
> „doppelte Files löschen (cbt/cbz -01/-1)“) · Übernahme: files-and-folders-tauri **Design 042** (`duplicates/`,
> `jobs/dedupe.rs`, `duplicates-rules.ts`)

## Entscheidungen auf einen Blick

| Nr. | Frage | Empfehlung |
|---|---|---|
| E1 | Regel-Engine wie fnf 042 oder feste Regeln? | **Engine aus 042 übernehmen, aber ohne benannte Regelsätze:** eine Regelliste (an/aus, Reihenfolge), Default *CBZ → Auflösung → Seiten → kürzerer Pfad*; „die erste trennende Regel entscheidet“, **nie die ganze Gruppe** |
| E2 | Ähnlichkeit PDF ↔ CBZ | **Ja.** Der Fingerabdruck (Seitenzahl + pHash der ersten 4 Seiten) ist formatfrei; PDF-Seiten über den Schnellweg (eingebettetes JPEG) oder klein gerendert (≤ 256 px) |
| E3 | Hash-/Fingerabdruck-Cache | **Datei im App-Cache** (`<cache>/duplicates.json`, Schlüssel Pfad + Größe + mtime + Inode) – Abweichung von 042 E3 (dort nur Speicher): der Scan-Cache liegt schon mit allen Pfaden dort, und ein zweiter Lauf über Marcs NAS soll kein Buch neu öffnen |
| E4 | Welche Bücher | **eine Kategorie** (die offene, im Dialog wählbar), Bücher aus dem Scan-Cache wie 007 E4; Grenzen 200 000 Bücher |
| E5 | Wie werden die drei Stufen zusammengeführt? | **Eine Gruppe je Buch**, Stufen in Reihenfolge *identisch → ähnlich → Name*; spätere Stufen fügen ganze Gruppen bzw. einzelne Bücher hinzu. Jedes Exemplar trägt seine **Beziehung** (`identical`/`similar`/`name`), der Löschjob prüft genau diese Beziehung neu |
| E6 | Namensnähe | **Gleichheit eines normalisierten Schlüssels** (keine Editierdistanz – „Band 1“/„Band 2“ hätten Distanz 1), reine Rust-Funktion mit Katalog; Gruppen nur aus Namensnähe werden **vorgeschlagen, aber nicht vorab markiert** |
| E7 | Schutz gegen Bände derselben Serie | ComicInfo (011) als **Veto**: verschiedene `Series`+`Number` → nie ähnlich oder namensnah; Zahlen bleiben im Namensschlüssel; einfarbige/kontrastarme Seiten zählen nicht (042 Review #2) |
| E8 | Ergebnis-Ansicht | **eigene Ebene über der Kategorie-Ansicht** (wie der Leser, A32): links die Gruppenliste (`listbox`), rechts die Exemplare der Gruppe nebeneinander mit großem Cover und Fakten |
| E9 | Löschen | **Job `dedupe`** (aus 042 E5): Bücher nur per Kategorie-Id + Buch-Id (A26), Prüfung je Datei unmittelbar vorher, Papierkorb (Crate `trash`) als einzige Art in 010 (endgültig/verschieben ✖, s. E9) |
| E10 | Scan-Cache danach | Frontend entfernt die gelöschten Bücher sofort aus der Ansicht und startet den **Neu-Scan der Kategorie** (wie `Mod+R`); der Diff bringt Registry und Cache in Ordnung – kein zweiter Schreiber für den Scan-Cache |
| E11 | Einstellungen (Regeln, Stufen, Schwelle) | `localStorage` `cc.duplicates` (v1) wie der Ansichtszustand (A25) – zieht mit 009 nach Rust |

## 1. Bestand → wofür → Befund

| Baustein | wofür | Befund |
|---|---|---|
| CC `jobs/` (`JobHub`, `Control`, `Reporter`) | Suche und Löschen als Jobs | **passt**; zwei neue Arten `duplicates`, `dedupe`; eigene Ereignis-Typen (der `JobEvent` aus 007 ist thumbs-spezifisch) |
| CC `jobs/thumbs.rs` `books_of` (Scan-Cache, sonst Walk) | Bücher einer Kategorie | **passt** – wird nach `jobs/mod.rs` gehoben und geteilt |
| CC `book::list` / `read_many` / `Budget`, `cover::choose::pages` | Seiten eines Buchs mit allen Grenzen (003) | **passt** – ersetzt fnfs `archive::index_of` + `extract::run`; nichts wird entpackt, die ≤ 4 Seiten kommen in den Speicher (`MAX_ENTRY_BYTES`) |
| CC `cover::image::decode` (Limits, `catch_unwind`, `MAX_DECODES`, niedrige Priorität) | Seiten dekodieren | **passt** (stammt schon aus fnf `duplicates/images.rs`) |
| CC `pdf::PdfBook` (`page_count`, `page_jpeg`, `render_page`) | PDF-Seiten für den Fingerabdruck | **passt** (E2) |
| CC `scan::natural_cmp` | Seitenreihenfolge | passt (fnf `comic::natural_cmp` nicht nötig) |
| CC `comic_info::BookMeta` im Scan-Cache | Veto Serie/Nummer (E7) | passt |
| CC `book_registry` | Id → Pfad (nichts aus der WebView) | passt; Löschjob löst darüber auf |
| CC Schema `cccover` | Cover in der Ergebnis-Ansicht | passt (gelistete Bücher) |
| fnf `duplicates/phash.rs` (pHash, Hamming, `cluster` mit Multi-Index) | ähnliche Bücher | **wird übernommen** (rein, ohne I/O) samt Tests |
| fnf `duplicates/comic.rs` (`samples`, `distance` ±1 Seite, max. der 4 Abstände) | Comic-Fingerabdruck | **wird übernommen**, Lesen auf CC `book::` umgestellt, PDF ergänzt |
| fnf `duplicates/mod.rs` (`partial_hash`, `full_hash`, `same_content`, `make_units`, `possibly_same_file`) | Stufe 1, Einheiten (Hardlinks) | **wird übernommen** (nur der Teil ohne `search::walk`) |
| fnf `duplicates/cache.rs` | Hash-Cache | **übernommen und auf Datei erweitert** (E3) |
| fnf `platform::entry_id` | Gerät+Inode / Volume+File-Index | **wird übernommen** nach `platform/mod.rs` |
| fnf `jobs/dedupe.rs` | Löschen mit Prüfung je Datei | **wird übernommen**, Eingabe Ids statt Pfade, nur Papierkorb, Prüfung je Beziehung (E5) |
| fnf `features/duplicates/duplicates-rules.ts` + `.cases.json` | Regel-Engine | **wird übernommen** und auf Comic-Regeln zugeschnitten (E1) |
| fnf Gruppen-Ansicht / Dialoge | UI | nur als Muster – CC hat kein Dual-Pane, eigene Ebene (E8) |
| GuiExpert Table | – | wird hier **nicht** gebraucht (Gruppenliste ≤ einige Tausend Einträge, eigene Kacheln); keine Lücke |

## 2. Entscheidungen im Einzelnen

### E1 – Regeln zum Behalten

Engine aus fnf 042 E2 (rein, `features/duplicates/dup-rules.ts`, Katalog `dup-rules.cases.json`), Ablauf je Gruppe:

```
kandidaten = alle Einheiten der Gruppe (Hardlink-Namen = eine Einheit)
für jede aktive Regel r (in Reihenfolge):
    beste = kandidaten mit bestem r-Wert (fehlender Wert trennt nicht)
    wenn 0 < |beste| < |kandidaten|: kandidaten = beste; grund = r
    wenn |kandidaten| == 1: Ende
|kandidaten| == 1 → behalten (Grund = r), die anderen Einheiten „löschen“
sonst              → nichts markiert, Gruppe „unentschieden“
```

Statt benannter Regelsätze mit Editor (042) **eine Liste fester Regelarten**, die der Nutzer an-/ausschaltet und
umsortiert – für Comics reicht das, und der Dialog bleibt klein:

| Regel | Wert | Default |
|---|---|---|
| `format` – Format bevorzugen | Rang nach Reihenfolge `cbz > cbr > cb7 > cbt > pdf` (nach Endung, wie überall sichtbar; Reihenfolge im Dialog änderbar) | an, 1. |
| `resolution` – größere Auflösung | Breite × Höhe der Titelseite (aus dem Fingerabdruck) | an, 2. |
| `pages` – mehr Seiten | Seitenzahl | an, 3. |
| `shortestPath` – kürzerer Pfad | Länge `relPath` | an, 4. |
| `largerFile` – größere Datei | Bytes | aus |
| `newest` / `oldest` | `modifiedMs` | aus |
| `noCopyName` – Name ohne „Kopie/Copy“ | Kopie-Merkmale wie 042 (`Kopie von …`, `… - Copy`, `… copy 2`, …) | an, **vor** `format` |
| `hasComicInfo` – mit ComicInfo.xml | ja/nein | aus |

Wirkung: markiert nur. Gelöscht wird erst nach der Bestätigung (E9). Manuelle Änderungen (Enter = „dieses behalten“,
Leertaste = umschalten) haben Grund „manuell“; „Regeln anwenden“ ersetzt sie nach Rückfrage.
Gruppen aus Stufe 3 (nur Name, E6) bekommen den Vorschlag als Hinweis („würde behalten: …“), sind aber **nicht
markiert** – der Nutzer bestätigt sie mit Enter.

Alternative feste Regeln (ohne Liste): weniger Code, aber Marcs „bevorzugt CBZ“ ist schon eine Vorliebe, die nicht
jeder teilt (PDF-Kategorie „Make“) – die Liste kostet ~1 Dialogabschnitt mehr.

### E2 – Ähnlichkeit über Formate

Fingerabdruck (aus fnf `comic.rs`, Abweichung 042 §9): **Seitenzahl + pHash der ersten 4 Seiten** (Titel zuerst).
Ähnlich, wenn Seitenzahl gleich **oder ±1** und jeder der 4 Abstände ≤ Schwelle (streng 4 · normal 8 · locker 12 von
64 Bit). Damit gilt aus dem Auftrag: neu gepackt = gleich; eine Seite mehr **am Ende** = gleich; eine Seite mehr **am
Anfang** verschiebt alle Stichproben = anders.

- Archive: `book::list` → `cover::choose::pages` (natürliche Reihenfolge, ohne versteckte/`__MACOSX`) → die ersten 4
  Seiten mit `book::read_many` (solide 7z/RAR: ein Durchlauf, Budget 20 s, ≤ 512 MiB übersprungen) → `decode` → grau
  32×32 → pHash.
- PDF: `PdfBook::open` (Vorprüfung `guard`, 006), Seitenzahl, je Seite `page_jpeg` (Schnellweg) sonst `render_page`
  mit 256 px Breite – pHash braucht nur 32×32.
- Titelseite mit Kontrast < 3 (einfarbig) → Buch ohne Fingerabdruck („nicht vergleichbar“), nie ähnlich gruppiert.
  Seiten 2–4 dürfen flach sein (Vorsatzblätter), zählen dann aber nur, wenn beide flach sind.
- Gruppierung `phash::cluster` (Zentrum + Radius, Multi-Index, deterministisch, keine Ketten) mit dem Maximum der 4
  Abstände; Vorfilter Titel-Hash.

### E3 – Cache als Datei

`<app cache>/duplicates.json` (atomar, ≤ 64 MiB, `.bad` bei Defekt, Version): je Buch
`{ path, size, mtimeMs, fileKey, partial?, full?, fp?: { pages, w, h, hashes[4] } | { none: code } }`.
Jede Abweichung von Größe, mtime oder `fileKey` = neu rechnen. Bücher, die nicht mehr im Scan sind, fallen beim
Schreiben heraus. Begründung gegen „nur Speicher“ (042 E3): Datenschutz-Argument trägt hier nicht (Scan-Cache und
Cover liegen schon mit Pfaden im App-Cache); der zweite Lauf über 600 Bücher auf dem NAS kostet sonst wieder Minuten.
Ein veralteter Eintrag kann nichts löschen – der Job prüft neu (E9).

### E4 – Umfang

Eine Kategorie (Default: die offene). Bücher aus dem Scan-Cache (ohne Cache ein Walk, wie 007). Stufen im Dialog
wählbar: identisch (immer), ähnlich (Default an), Name (Default an). Kategorienübergreifend ✖ (Kategorien haben eigene
Ordner/Endungen; bei Bedarf später).

### E5 – Stufen zusammenführen

```
1. identisch: Größe → SHA-256 Kopf/Ende (je 64 KiB) → voller SHA-256; Einheiten = gleiche Datei (Hardlink,
   possibly_same_file) → exakte Gruppen (≥ 2 Einheiten)
2. ähnlich: Fingerabdruck je Einheit, je exakter Gruppe nur ein Vertreter; cluster → ähnliche Gruppen.
   Enthält ein Cluster exakte Gruppen, werden sie Teil davon (Mitglieder behalten ihre exakte Untergruppe `exact`).
3. Name: Schlüssel je Buch (E6). Ein noch einzelnes Buch, dessen Schlüssel einem Mitglied einer bestehenden Gruppe
   gleicht, kommt dazu; einzelne Bücher mit gleichem Schlüssel bilden neue Gruppen.
```

Jedes Buch steht in höchstens einer Gruppe. Gruppe `kind` = stärkste gemeinsame Beziehung (`identical` nur, wenn alle
identisch). Beziehung **zwischen zwei Exemplaren** (für Anzeige und Prüfung): gleiche `exact`-Untergruppe →
`identical`; beide aus Stufe 2 → `similar`; sonst `name`. Der Löschjob bekommt je Kopie diese Beziehung und prüft sie
gegen das behaltene Exemplar neu.

### E6 – Namensschlüssel (rein, `dup_name.rs`, Katalog `testdata/dup-name.cases.json`)

1. NFC, klein (Unicode), Endung weg.
2. Kopie-Merkmale am Ende/Anfang weg (`- kopie`, `- copy`, ` copy`, ` copy 2`, `kopie von `, `copy of `).
   **Nicht** ` (1)` – das ist bei Comics oft der Band.
3. Klammergruppen `(…)`, `[…]`, `{…}` weg, **außer** sie enthalten eine Ziffer (Jahr, Band, „c2c“ bleibt – lieber
   ein verpasster als ein falscher Treffer); bekannte Etiketten ohne Ziffer (`digital`, `hq`, `scan`, …) gehen damit
   ohnehin.
4. `_`, `-`, `.`, `,`, Leerraum → ein Leerzeichen; `.` zwischen Ziffern bleibt (`1.5`).
5. Führende Nullen jeder Zahl weg (`01` → `1`, `-001` → `1`; `0` bleibt) – das ist Marcs „-01/-1“.
6. Leer nach dem Normalisieren → kein Schlüssel.

Katalog-Fälle u. a.: `Band 01.cbr` = `Band 1.cbz`; `Band-01.cbt` = `Band_1.cbz`; `Asterix 1` ≠ `Asterix 2`;
`Batman (2011) 001` ≠ `Batman (2016) 001`; `Spider-Man 5 (Digital)` = `Spider Man 05`; `X - Kopie.cbz` = `X.cbr`;
`Heft 1.5` ≠ `Heft 15`; Emoji/Umlaute NFC = NFD.

### E7 – Veto gegen falsche Treffer

- ComicInfo beider Bücher hat `series` **und** `number` und eins davon weicht ab (Vergleich NFC/klein, Nummer ohne
  führende Nullen) → nie `similar`, nie `name` (identisch bleibt identisch – gleiche Bytes sind gleiche Bytes).
- Seitenzahl: ähnlich nur bei ±1 (E2); Namensnähe ohne Seitenprüfung, dafür nicht vorab markiert (E6).
- Kontrastarme Titelseiten (E2).

### E8 – Ergebnis-Ansicht

```
┌ Duplicates · Comics · 12 groups, 27 books · 9 to delete (1,4 GB) · 2 undecided ──────── [Rules…] [Delete… ⌫] [✕] ┐
│ ┌ Groups (listbox) ──────────┐ ┌ Group 3 of 12 · similar ─────────────────────────────────────────────────────┐ │
│ │ ▸ Asterix 01   identical 2 │ │  ┌──────────┐  ┌──────────┐  ┌──────────┐                                    │ │
│ │   Asterix 05   similar   3 │ │  │  Cover   │  │  Cover   │  │  Cover   │                                    │ │
│ │   Band 1       name      2 │ │  │  KEEP ✓  │  │ DELETE ✗ │  │ DELETE ✗ │                                    │ │
│ │   …                        │ │  └──────────┘  └──────────┘  └──────────┘                                    │ │
│ │                            │ │  Band 01.cbz   Band 1.cbr    Band 1 (2).cb7                                  │ │
│ │                            │ │  CBZ · 48 MB   CBR (ZIP)…    CB7 · 41 MB                                     │ │
│ │                            │ │  52 p · 1988×3056 · 12.03.2021 · Comics/Asterix/…                            │ │
│ │                            │ │  identical · reason: format CBZ   similar (d 3)                              │ │
│ └────────────────────────────┘ └──────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Ebene wie der Leser (A32): `app-duplicates-view` über der Kategorie-Ansicht (`inert`), Zustand im Root-
  `DuplicatesStore`; Dispatcher-Kontext **`duplicates`** (Gate wie beim Lesen).
- Gruppenliste: `role="listbox"`, Einträge `option` mit Text (Name, Art, Anzahl, Zustand „unentschieden“ als Text,
  nicht nur Farbe). Rechts eine `region` mit den Exemplaren als `listbox` (horizontal, `aria-orientation`); jedes
  Exemplar nennt Entscheidung + Grund im Text. Cover über `cccover` in der größten Stufe der Kategorie.
- Tasten (Kontext `duplicates`, Keymap-JSON): `↑/↓` Gruppe, `←/→` Exemplar, `Enter`/Doppelklick = dieses behalten
  (Rest der Gruppe löschen, wie 042 E9), `Space` = umschalten, `Delete`/`Backspace` (mac `⌘⌫`) = „Löschen…“
  (Bestätigung), `Mod+Enter` = Exemplar im Leser öffnen (prüfen!), `Mod+Shift+r` = im Finder zeigen, `Esc` = schließen
  (Ergebnis bleibt bis zur nächsten Suche, „Show duplicates“ öffnet es wieder).
- Einstieg: Kategorie-Menü + App-Menü „Find duplicates…“ (Aktion `app.findDuplicates`, Palette; **kein Default-
  Kürzel** – `Mod+Shift+D` ist schon die Ordneransicht). Während der Job läuft: kleiner Fortschritt in der Toolbar wie
  007 E7 (Knopf öffnet den Dialog: Phase, n/m, Pause, Abbruch).

### E9 – Löschen: Job `dedupe`

Bestätigungsdialog: „9 Bücher aus 7 Gruppen in den Papierkorb (1,4 GB)“, je Gruppe Kacheln *behalten | löschen*
(Cover), übersprungene Gruppen (unentschieden, ohne behaltenes) als Text; Knopf „9 in den Papierkorb“.

```rust
// Command
start_dedupe(category_id, groups: Vec<DedupeGroup>, on_event: Channel<DedupeEvent>) -> String   // job_running, unknown_category
struct DedupeGroup { keep: Copy, remove: Vec<RemoveCopy> }                   // ≤ 200 000 Bücher je Aufruf
struct Copy { book_id: String, size: u64, modified_ms: Option<i64> }         // Stand wie gezeigt
struct RemoveCopy { #[serde(flatten)] copy: Copy, relation: Relation }       // identical | similar | name
enum DedupeEvent { Progress { done, total, bytes_freed }, Done { removed: Vec<String>, skipped: Vec<Skipped>, cancelled }, Failed { error } }
struct Skipped { book_id: String, code: FsErrorCode }                       // duplicate_changed, not_found, unknown_book, io …
```

Prüfung **je Kopie, unmittelbar vor dem Papierkorb** (fnf 042 E5 + Review #1/#8/#10):

1. Beide Ids über die `BookRegistry` der Kategorie → Pfade (sonst `unknown_book`); `keep` ∉ `remove`.
2. `keep` existiert, ist Datei, Größe + mtime wie gezeigt – sonst **ganze Gruppe übersprungen**.
3. Kopie wie gezeigt (Größe + mtime) und **nicht dieselbe Datei** wie `keep` (`entry_id`/`possibly_same_file`;
   unklare Identität = ablehnen).
4. Beziehung neu prüfen: `identical` → Bytevergleich in 64-KiB-Blöcken (abbrechbar); `similar` → beide Fingerabdrücke
   **frisch** (ohne Cache) und Abstand ≤ Schwelle der Suche (mitgeschickt, ≤ 16); `name` → Namensschlüssel gleich.
5. `keep` erneut wie gezeigt → `trash::delete` der Kopie (kein Fallback auf endgültiges Löschen; schlägt der
   Papierkorb fehl, bleibt die Datei, Fehler `trash_failed`).

Nie das letzte Exemplar: (2) + (3) + „keep wird nie angefasst“. Endgültig löschen und „in Ordner verschieben“ (042) ✖
in 010 – der Papierkorb reicht für eine Comic-Sammlung, beides kann folgen (Folge-Idee).

Neue Fehlercodes: `duplicate_changed`, `trash_failed` (Rust `error.rs`, TS `fs-error.ts`, `describeFsError`).

### E10 – Nach dem Löschen

`Done.removed` → `CategoryStore.removeBooks(ids)` (sofort aus Grid und Ergebnis; Gruppen mit < 2 Exemplaren
verschwinden) → `app.rescan` der Kategorie im Hintergrund (Diff bestätigt, Registry + Scan-Cache folgen). Lesestände
gelöschter Bücher bleiben (≤ 5 000, verfallen nicht schädlich).

### E11 – Einstellungen

`localStorage` `cc.duplicates` v1: `{ stages: { similar, name }, threshold, rules: [{ kind, on }], formatOrder }`,
mit try/catch und Defaults (wie `view-state.ts`). In 009 nach `settings.json`.

## 3. Verträge

### Commands

| Command | Parameter | Rückgabe | Fehler |
|---|---|---|---|
| `start_find_duplicates` | `categoryId`, `options: DupOptions`, `onEvent: Channel<DupEvent>` | `string` (Job-Id) | `job_running`, `unknown_category`, `invalid_input` |
| `start_dedupe` | `categoryId`, `groups: DedupeGroup[]`, `threshold`, `onEvent: Channel<DedupeEvent>` | `string` | `job_running`, `unknown_category`, `invalid_input` |
| `pause_job`, `cancel_job` | (007) | | |

```ts
// core/duplicates/duplicates.models.ts  (= Rust duplicates/model.rs)
export interface DupOptions { similar: boolean; name: boolean; threshold: number /* 0–16, Default 8 */ }
export type Relation = 'identical' | 'similar' | 'name';
export interface DupMember {
  bookId: string;
  relation: Relation;          // zur Gruppe (stärkste Beziehung dieses Exemplars)
  exact?: number;              // Untergruppe gleicher Bytes
  sameAs?: string;             // Hardlink: Buch-Id der Einheit
  links?: number;              // nlink > 1
  container?: 'zip' | 'rar' | '7z' | 'tar' | 'pdf';   // nach Inhalt (CBR, das ZIP ist)
  pages?: number; width?: number; height?: number;   // aus dem Fingerabdruck
  distance?: number;           // max. Abstand zum Zentrum (similar)
}
export interface DupGroup { id: number; kind: Relation; members: DupMember[] }
export type DupPhase = 'listing' | 'hashing' | 'fingerprinting' | 'grouping';
export type DupEvent =
  | { kind: 'progress'; phase: DupPhase; done: number; total: number; currentFile?: string; elapsedMs: number; paused: boolean }
  | { kind: 'done'; groups: DupGroup[]; stats: DupStats; cancelled: boolean; errorList: { relPath: string; code: string }[] }
  | { kind: 'failed'; error: FsError };
export interface DupStats { books: number; hashed: number; fingerprinted: number; fromCache: number; notComparable: number }
```

Größe, Datum, Pfad, Format, ComicInfo kommen aus dem `BookEntry` des `CategoryStore` (Ids), nicht doppelt über den
Channel. `currentFile` ist `relPath` (Anzeige).

### Rust-Module

```
src-tauri/src/duplicates/
  mod.rs        find(books, opts, cache, control, sink) – Stufen E5, Einheiten, Fortschritt (rein, ohne Tauri)
  model.rs      DTOs oben
  hash.rs       partial/full SHA-256, same_content           (aus fnf duplicates/mod.rs)
  phash.rs      pHash, hamming, cluster                       (aus fnf, unverändert + Tests)
  fingerprint.rs  Archiv/PDF → Fp, distance, Kontrast         (aus fnf comic.rs, auf book::/pdf:: umgestellt)
  name_key.rs   Namensschlüssel E6
  cache.rs      Datei-Cache E3                                (aus fnf cache.rs, erweitert)
  tests.rs
src-tauri/src/jobs/duplicates.rs, jobs/dedupe.rs             (dedupe aus fnf)
src-tauri/src/platform/mod.rs  entry_id, FileStamp           (aus fnf platform.rs)
```

Neue Crates (Begründung in `docs/architecture.md`): **`sha2` 0.10** (Stufe 1, wie fnf/Vorlage), **`trash` 5**
(Papierkorb je OS, wie fnf; `default-features = false`, `coinit_apartmentthreaded`). `image` ist schon da.

### Frontend

```
src/app/core/duplicates/   duplicates-api.ts (Fassade, Channels), duplicates.models.ts
src/app/features/duplicates/
  dup-rules.ts (+ dup-rules.cases.json, spec)   Engine E1, isCopyName, summary (Gruppen, Bytes, unentschieden)
  dup-settings.ts (+ spec)                      localStorage E11
  duplicates.store.ts (Root)                    Job, Ergebnis, Entscheidungen, Cursor, Löschen, removeBooks
  find-duplicates-dialog.*                      Stufen, Schwelle, Regeln (Liste mit ↑/↓-Knöpfen, Alt+↑/↓)
  duplicates-view.*                             Ebene E8
  dedupe-dialog.*                               Bestätigung E9
  duplicates-texts.ts
src/testing/fake-duplicates-api.ts
```

Aktionen (`action-catalog.ts`): `app.findDuplicates`, `app.showDuplicates`, Kontext `duplicates`: `dup.prevGroup`,
`dup.nextGroup`, `dup.prevCopy`, `dup.nextCopy`, `dup.keep`, `dup.toggle`, `dup.delete`, `dup.read`, `dup.reveal`,
`dup.applyRules`, `dup.close`. Menü „Category“ → „Find duplicates…“.

## 4. Tests

**Rust**
- Stufe 1: gleiche Bytes unter anderem Namen/Ordner → Gruppe; gleiche Größe, anderer Inhalt (Kopf gleich, Ende
  anders) → keine; Hardlink → eine Einheit (`sameAs`), keine Gruppe aus Datei + Link allein; Symlink-Buch (Scan nimmt
  Datei-Symlinks, A4) zeigt aufs selbe Ziel → gleiche Datei; Unicode/Emoji/Leerzeichen.
- Stufe 2 (Generatoren aus `book/tests.rs`): dieselben Seiten als CBZ (deflate) / CBZ stored / CB7 / CBT → eine
  Gruppe; JPEG q90 vs. q50 neu kodiert → ähnlich; **eine Seite mehr am Ende → gleich, am Anfang → anders**; andere
  Bilder → nicht; Bände einer Serie (gleiches Layout, anderes Motiv) → nicht; einfarbiges Titelbild → nicht
  vergleichbar; PDF (Generator aus `pdf/tests.rs`, eingebettete JPEGs) ↔ CBZ derselben Seiten → ähnlich; kaputtes/
  verschlüsseltes Buch → Fehler in der Liste, Lauf geht weiter; Abbruch mitten im Lauf.
- Stufe 3: Katalog `dup-name.cases.json`; Veto ComicInfo (gleicher Name, andere Nummer → keine Gruppe).
- Zusammenführen E5: exakte Gruppe + ähnliches Buch → eine Gruppe mit `exact`-Untergruppe; einzelnes Buch mit
  Namensgleichheit zu einem Gruppenmitglied → dazu.
- Cache: zweiter Lauf öffnet kein Buch (Zähler `fromCache`), Änderung von mtime/Größe → neu; kaputte Datei → `.bad`.
- Job `dedupe`: löscht nur `remove`; `keep` geändert (`touch`) → Gruppe übersprungen; Kopie geändert → bleibt;
  `identical` mit gleicher Größe/mtime aber anderem Byte → bleibt; `keep` = Hardlink der Kopie → bleibt; `keep` in
  `remove` → abgelehnt; unbekannte Id → `unknown_book`; `similar` mit inzwischen anderem Inhalt → bleibt; Papierkorb im
  Container (Linux, `trash` mit `XDG_DATA_HOME` im tempdir) – macOS/Windows nicht prüfbar.
- `command_rules` (async) für die neuen Commands.

**Frontend**
- `dup-rules.cases.json`: jede Regel, Reihenfolge, Gleichstand → unentschieden, nie ganze Gruppe, Hardlink-Einheiten,
  fehlende Werte trennen nicht, Kopie-Namen (de/en), Namensgruppen nicht vorab markiert.
- Store: Enter = behalten, Space, Summe Bytes/Bücher, Bestätigung baut genau die erwarteten `DedupeGroup`s (Beziehung
  je Paar aus `exact`), `removeBooks` lässt Gruppen < 2 verschwinden, veraltete Ereignisse verworfen.
- Dialoge mit Fakes (Fokusfalle, Esc, Zahlen), Ansicht: Tastatur, ARIA-Texte, leeres Ergebnis.

**E2E (Xvfb)**: Testsammlung mit den drei Arten (Kopie unter anderem Namen; `Band 01.cbr` (RAR) ↔ `Band 1.cbz` gleiche
Seiten; `Heft-01.cbt` ↔ `Heft 1.cbz` andere Scans), dazu Serie `Asterix 1…5` mit gleichem Layout, Umlaute/Emoji,
kaputtes Archiv, PDF ↔ CBZ. Suchen → Ansicht → Enter/Space → Löschen → Papierkorb (`~/.local/share/Trash`) → Grid
aktualisiert; `touch` der behaltenen Datei vor dem Bestätigen → übersprungen; light/dark.

**Review** durch separaten Agenten: Datenverlust im Job `dedupe` (Ids, Prüfreihenfolge, Hardlinks/Doppel-Mounts,
TOCTOU), Engine „nie ganze Gruppe“, feindliche Bücher im Fingerabdruck (Grenzen, Panics, Speicher), Cache-Datei als
Eingabe.

## 5. Phasen

| Phase | Inhalt |
|---|---|
| 2a | Rust: `entry_id`, Hash, Einheiten, Namensschlüssel + Katalog, Cache – Commit |
| 2b | Rust: Fingerabdruck (Archiv/PDF), pHash/cluster, Zusammenführen, Job `duplicates`, Command – Commit |
| 2c | Rust: Job `dedupe`, `trash`, Command – Commit |
| 3a | Frontend: Fassade, Fake, Regel-Engine + Katalog, Store – Commit |
| 3b | Frontend: Dialoge, Ansicht, Aktionen/Keymap/Menü – Commit |
| 4–6 | E2E, Doku (architecture A54 ff., README, Index, CLAUDE.md), Review, Bericht |

## 6. Nicht im Umfang

- Endgültig löschen, in Ordner verschieben (E9), Ersetzen durch Links (✖ wie 042 E8).
- Kategorienübergreifende Suche (E4), Editierdistanz für Namen (E6).
- Gedrehte/gespiegelte Seiten als ähnlich.

## 7. Fragen an Marc

1. **E1:** Default-Reihenfolge *Kopie-Name → CBZ → Auflösung → Seiten → kürzerer Pfad* – passt „CBZ vor Auflösung“?
   (Ein höher aufgelöstes CBR würde dann gelöscht.)
2. **E6:** Gruppen nur aus Namensgleichheit **nicht vorab markieren** – einverstanden?
3. **E9:** Nur Papierkorb in 010 – oder brauchst du „endgültig“ (z. B. NAS ohne Papierkorb)? Auf SMB-Freigaben vom
   Mac legt der Finder-Papierkorb Dateien in `.Trashes` der Freigabe; geht das nicht, bleibt die Datei mit Fehler.
4. **E3:** Fingerabdruck-Cache als Datei im App-Cache ok?

## Fortschritt

- 23.10.2026: Bestand geprüft (CC `jobs/`, `book/`, `cover/`, `pdf/`, Scan-Cache; fnf Design 042 samt `duplicates/`,
  `jobs/dedupe.rs`), Design geschrieben. **Wartet auf Freigabe.**
