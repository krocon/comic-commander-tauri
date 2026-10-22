# Design 003: Cover finden und Thumbnails erzeugen

> **Status: Entwurf – wartet auf Freigabe 🛑** · Datum: 22.10.2026 · Branch `feat/cover-thumbnails`
> Auftrag: [`003-cover-thumbnails.md`](003-cover-thumbnails.md) · Regeln: [`000-arbeitsweise.md`](000-arbeitsweise.md)
> Vorlage: legacy §4, §10.2–10.4 · Übernahme aus files-and-folders-tauri (fnf): `archive/rar.rs` (UnRAR-FFI),
> `archive/sevenz.rs` + `sevenz_header.rs` (fail-closed Vorabprüfung), `archive/mod.rs` (`sanitize`, Grenzen),
> `duplicates/images.rs` (Decoder mit Limits), `duplicates/comic.rs` (`pages`), Testdateien `archive/testdata/`.

## Entscheidungen auf einen Blick

| Nr. | Frage | Empfehlung |
|---|---|---|
| E1 | Wie kommt das Bild ins `<img>`? | URI-Schema **`cccover`**, URL = `<Kategorie-Id>.<Buch-Id>.<dimIndex>?v=<mtime>`; die Buch-Id stammt aus dem Scan und ist der „Token“ – Rust liefert nur Bücher, die es selbst gelistet hat. Kein Vorab-`invoke` je Cover |
| E2 | Format | JPEG, Qualität 80 (wie Vorlage, sidecar-kompatibel, reiner Rust-Encoder) |
| E3 | `ComicInfo.xml` (FrontCover) | nicht jetzt → 011 |
| E4 | Cache | Platte: `<app cache>/covers/<xx>/<schlüssel>.jpg`, Schlüssel = fnv64(Pfad, Größe, mtime, Breite×Höhe); Grenze 2 GiB, beim Start und nach je 500 neuen Covern die ältesten weg; WebView-Cache über unveränderliche URLs |
| E5 | Alte Sidecars | **lesen** (Reihenfolge legacy §4, `nameExtension` der Größe), unverändert ausliefern; **nie schreiben** (Option frühestens in 009) |
| E6 | RAR | UnRAR über `unrar-ng-sys` – `rar.rs` aus fnf übernehmen (einziges `unsafe`) |
| E7 | CB7 | sevenz-rust2 **mit** fnfs fail-closed Header-Prüfung übernehmen (sonst kann ein feindliches 7z beim Öffnen GBs anfordern) |
| E8 | Cover-Wahl | wie Vorlage + natürlich sortiert: Bilder (`jpg jpeg png webp gif bmp`), ohne versteckte/`__MACOSX`; `cover.` im Namen → weniger Ordnerebenen → natürliche Reihenfolge |
| E9 | Rechenarbeit | eigener Pool, min(4, Kerne − 1) Threads, **LIFO**-Warteschlange (nach schnellem Scrollen kommen die sichtbaren Cover zuerst), gleiche Anfragen zusammengelegt, Zeitlimit 20 s je Buch |
| E10 | Fehler | Status-Codes (404 kein Bild / 415 Format nicht unterstützt, z. B. PDF bis 006 / 422 kaputt oder verschlüsselt / 500 intern); Ergebnis zusätzlich im Speicher (`CoverStatus`) für 007 |

## Bestand und reale Daten

**Kategorie „Comics“** (gelesen am 22.10.2026):

| Merkmal | Wert | Folge |
|---|---|---|
| Formate | 532 RAR4, 31 RAR5 (beide `.cbr`), 8 ZIP mit `.cbr`, 13 ZIP `.cbz` | Erkennung nach Magic Bytes; UnRAR deckt RAR4 + RAR5 ab |
| Größe | Median 146 MB, max. 1,16 GB | nie das ganze Archiv lesen: ZIP über das zentrale Verzeichnis, RAR mit `skip` (nicht solid = Seek) |
| Seiten | Titelseiten 2560 px+, JPEG 3–4 MB | Dekodieren ~50–150 ms → Cache ist Pflicht; Grenzen aus fnf (64 MiB, 64 MP) reichen |
| Müll | `__MACOSX/._*.jpg` (177 B, kein Bild) in CBZ | ausfiltern |
| Sidecars | 272 von 584 Büchern haben `Band.jpg` (200×280) **und** `Band_xl.jpg` (800×1121); keine `.Panels` | sofort ausliefern; 312 Bücher × 2 Größen werden erzeugt |
| PDF | Kategorie „Make“ | 415 bis Prompt 006 |

**Code (fnf):**

| Baustein | wofür | Umgang |
|---|---|---|
| `archive/rar.rs` (545 Zeilen) | `RarArchive::open/next_header/skip/test_into` (Daten in einen Sink, Grenzen, Abbruch) | übernehmen, Passwort-Teile entfernen (verschlüsselt = 422) |
| `archive/sevenz.rs`, `sevenz_header.rs` (1 040 Zeilen) | 7z öffnen nach Vorabprüfung, Speicherbedarf je Block | übernehmen, ohne Passwörter |
| `archive/mod.rs` | `sanitize` (Zip-Slip-Namen), Grenzen `MAX_ENTRIES`, Ratio | Konstanten + `sanitize` übernehmen; Index/virtuelle Pfade nicht |
| `duplicates/images.rs` | `decode_bytes` mit Kopf-Prüfung, `image::Limits`, `catch_unwind`, Semaphor | übernehmen (ohne pHash) |
| `duplicates/comic.rs` | `pages` (Filter + natürliche Reihenfolge) | Idee übernehmen; extrahiert in fnf über einen Job auf Platte – hier **im Speicher** |
| `duplicates/thumbs.rs`, `preview/mod.rs` | Thumbnails im Speicher, Schema mit Tokens, Slots | Muster für den Schema-Handler; Speicher-Cache nicht (Platte statt RAM) |
| `archive/testdata/` | `rar-*.rar`, `rar4-slip.rar`, `make_rar4.py`, 7z-Bomben + Generator | übernehmen (Lizenz README dort) |

## Ablauf

```
<img src="cccover://localhost/c1a2…/9f3e…/1?v=1729600000000">        (Windows: http://cccover.localhost/…)
  → Schema-Handler (async, nie Main-Thread)
     1. Kategorie + Buch-Id im BookRegistry nachschlagen (aus Scan/Cache; unbekannt → 404)
     2. dimIndex → ThumbsDim der Kategorie (ungültig → 404)
     3. Platten-Cache-Treffer? → 200 (Cache-Control: max-age=31536000, immutable)
     4. Sidecar (legacy §4, mit nameExtension)? → Datei ausliefern (≤ 8 MiB, Magic JPEG/PNG)
     5. Auftrag in den Cover-Pool (LIFO, gleiche Schlüssel zusammengelegt):
        Buch öffnen (Magic) → Bild-Einträge → Cover wählen (E8) → Eintrag in den Speicher (≤ 64 MiB,
        Ratio-Grenze) → dekodieren (Limits, catch_unwind) → thumbnail(w, h) → JPEG q80 → Cache → 200
```

- **BookRegistry** (Rust, im `AppState`): je Kategorie `Buch-Id → Pfad`, gefüllt aus den Ereignissen von
  `open_category` (`cached`, `batch`, `diff`). Die WebView kann so keine beliebigen Dateien anfordern – nur Bücher,
  die der Scan selbst gefunden hat (das erfüllt die Token-Regel aus CLAUDE.md ohne eigenen Token-Aufruf je Cover).
- **Buch-Id** = `fnv64(Pfad)` als 16 Hex-Zeichen, neues Feld `BookEntry.id` (Rust rechnet sie; Scan-Cache-Version 2 –
  alte Caches gelten als fehlend und werden neu aufgebaut).
- `?v=<mtime>` macht die URL unveränderlich: ändert sich das Buch, ändert sich die URL; der WebView-Cache bleibt
  gültig.

## E1 – Lieferung (Alternativen)

- A: Token je Buch per `invoke` holen, dann `<img>` – bei 30 000 Zellen ein zusätzlicher Aufruf je Zelle und Zustand
  im Frontend.
- B: Pfad in der URL – verboten (beliebige Dateien lesbar).
- **C (Empfehlung):** Kategorie-Id + Buch-Id aus dem Scan. Kein Zusatzaufruf, URL deterministisch, Prüfung gegen die
  Registry. Die Fassade `CoversApi.coverUrl(categoryId, book, dimIndex)` baut die URL mit `convertFileSrc(…,
  'cccover')` (richtige Form je OS). CSP `img-src` bekommt `cccover: http://cccover.localhost`.

## E4 – Platten-Cache

- Datei: `<app cache>/covers/<erste 2 Hex>/<fnv64(Pfad \0 Größe \0 mtime \0 B×H)>.jpg`, atomar geschrieben.
- Größe: 200×300 ≈ 15 KB, 800×1200 ≈ 120 KB je Buch → Marcs „Comics“ ≈ 45 MB, 50 000 Bücher × 2 Größen ≈ 7 GB.
  Grenze **2 GiB** (Einstellung in 009); Aufräumen nach Änderungszeit (beim Ausliefern wird die Datei höchstens
  einmal am Tag „berührt“ → grobe LRU). Läuft beim Start im Hintergrund und nach je 500 neuen Dateien.
- Fehlschläge werden **nicht** auf Platte gemerkt (ein später reparierter Download soll ein Cover bekommen); im
  Speicher hält `CoverStatus` je Schlüssel das letzte Ergebnis (für 007 und gegen Endlos-Wiederholung in einer
  Sitzung).

## E5 – Sidecars der Vorlage

Gesucht wird für Größe *i* mit `s = thumbsDims[i].nameExtension`, Buch `…/Band.cbr` (Reihenfolge legacy §4):
`Band{s}.jpg` → `Band.cbr{s}.jpg` → `.Panels/thumbnails/Band{s}.jpg` → `.Panels/thumbnails/Band.cbr{s}.jpg`.
Gefunden + Magic JPEG/PNG + ≤ 8 MiB → unverändert ausliefern (die Vorlage erzeugte sie selbst in genau der Größe).
Nur lesen; Schreiben neben das Buch wäre eine Option für 009 (Rechte, Netzlaufwerke, legacy §10.2).

## E7 – CB7

Ein feindliches 7z kann im Header riesige Zahlen angeben; sevenz-rust2 allokiert danach. fnf prüft den Header vorab
selbst (CRC, Größen, LZMA mit Grenze) – 1 040 Zeilen mit Tests und Bomben-Testdateien. **Empfehlung: übernehmen.**
Alternative: CB7 vorerst als „nicht unterstützt“ (415) melden – Marc hat keine CB7, es spart den größten Brocken.
**Bitte entscheiden.**

## E9 – Cover-Pool

- Threads: `min(4, max(1, Kerne − 1))`. Der Schema-Handler legt einen Auftrag ab und wartet auf das Ergebnis (eigener
  Thread, nicht der Async-Runtime).
- **LIFO**: das zuletzt angefragte Cover zuerst – beim schnellen Scrollen sind das die sichtbaren. Ältere Aufträge
  werden trotzdem fertig (sie füllen den Cache); höchstens 2 000 wartende, darüber verwirft der Pool die ältesten
  mit 503 (das Frontend lädt beim nächsten Sichtbarwerden neu).
- Gleicher Schlüssel bereits in Arbeit → zweite Anfrage wartet auf dasselbe Ergebnis.
- Zeitlimit 20 s je Buch (Abbruch-Flag in RAR/7z/ZIP-Lesen), dann 422.

## Fehler und Status

| Fall | HTTP | `CoverStatus` |
|---|---|---|
| Buch/Kategorie/Größe unbekannt | 404 | – |
| kein Bild im Archiv | 404 | `no_image` |
| PDF (bis 006), unbekanntes Format | 415 | `unsupported` |
| verschlüsselt, kaputt, zu groß, Bombe, Zeitlimit | 422 | `broken` / `encrypted` / `too_large` |
| Warteschlange voll | 503 | – |
| intern (Panik) | 500 | `broken` |

## Verträge

- **DTO:** `BookEntry.id: string` (neu, Rust + TS). Scan-Cache `VERSION = 2`.
- **Commands:** keine neuen für das Bild selbst. Neu `cover_stats(categoryId)` → `{ cached, sidecar, failed }` nur
  für Tests/Status (klein, optional – entfällt, wenn 007 es nicht braucht).
- **Schema:** `cccover` (registriert mit `register_asynchronous_uri_scheme_protocol`), Antworten `image/jpeg` bzw.
  `image/png`, `Cache-Control: public, max-age=31536000, immutable`.
- **Frontend:** `core/covers/covers-api.ts` – `CoversApi.coverUrl(categoryId, book, dimIndex): string`
  (`TauriCoversApi` mit `convertFileSrc`, `FakeCoversApi` für Tests). Sichtprüfung in der Skelett-Liste: 32×48-Cover
  aus `dimIndex` 0, `loading="lazy"`, bei Fehler bleibt das Format-Kürzel.
- **Module (Rust):** `book/mod.rs` (Format per Magic, `images()`, `read_entry(limit)`), `book/zip.rs`, `book/tar.rs`,
  `book/rar.rs` (fnf), `book/sevenz.rs` + `sevenz_header.rs` (fnf, falls E7), `cover/choose.rs` (E8),
  `cover/image.rs` (Decoder + Thumbnail, fnf), `cover/sidecar.rs` (E5), `cover/cache.rs` (E4), `cover/pool.rs` (E9),
  `cover/scheme.rs` (URL parsen, Antwort bauen), `book_registry.rs`.

## Neue Abhängigkeiten

| Crate | Wofür |
|---|---|
| `zip` 9 (nur `deflate-flate2`, ohne Schreiben im Produktivcode) | CBZ |
| `tar` 0.4 | CBT |
| `unrar-ng-sys` = 0.7.7 (vendierte UnRAR-Quellen, C++; unRAR-Lizenz) | CBR |
| `sevenz-rust2` 0.24, `lzma-rust2`, `crc32fast` (E7) | CB7 |
| `image` 0.25 (`jpeg png gif webp bmp`, reines Rust) | dekodieren, verkleinern, JPEG |
| `cc` (Build, über `unrar-ng-sys`) | – |

Build-Zeit steigt (UnRAR ist C++); in fnf ohne Probleme auf allen drei OS.

## Tests

**Rust**
- `book`: Magic statt Endung (ZIP als `.cbr`), ZIP/TAR selbst erzeugt, RAR4/RAR5/solid/Unicode/verschlüsselt/Slip
  aus fnf-Testdaten, 7z-Bomben (E7); `read_entry` mit Grenze (zu groß, Ratio), Abbruch.
- `cover/choose`: `cover.jpg` tief im Ordner schlägt `001.jpg`; flacher vor tiefer; natürlich (`p2` < `p10`);
  `__MACOSX`, `._`, versteckt, Nicht-Bilder raus; Groß-/Kleinschreibung der Endung.
- `cover/image`: 20 000 × 20 000-Kopf abgelehnt vor dem Dekodieren; kaputtes JPEG = Fehler (keine Panik); fit inside
  ohne Vergrößern (200×300 aus 2560×3600 → 200×281; aus 100×150 → 100×150).
- `cover/sidecar`: Reihenfolge, Suffix, zu groß/kein Bild ignoriert.
- `cover/cache`: Schlüssel ändert sich mit mtime/Größe; Aufräumen bis unter die Grenze, älteste zuerst.
- `cover/pool`: LIFO, Zusammenlegen, Warteschlange voll → 503, Panik im Auftrag → 500 und Pool läuft weiter.
- `cover/scheme`: URL-Formen (macOS/Linux `cccover://localhost/…`, Windows `http://cccover.localhost/…`),
  unbekannte Ids → 404, Header.
- Messung: 3 echte Bücher aus Marcs Sammlung (kleinstes RAR4, RAR5, ZIP-als-CBR; nur im Scratch-Ordner): Zeit bis zum
  ersten Cover, Cache-Treffer < 5 ms.

**Frontend**
- `CoversApi`-URL (Kodierung von Ids, `v=`), Liste zeigt `<img>` und fällt bei Fehler auf das Kürzel zurück.

**Ende-zu-Ende** (Container): Spiegel-Sammlung reicht nicht (leere Dateien) → Testsammlung aus erzeugten CBZ/CBT +
fnf-RAR-Testdateien + 3 echte Bücher; Sichtprüfung der Liste mit Covern, Neustart = aus dem Cache. Auf dem Mac
(Marc): „Comics“ mit 272 Sidecar-Büchern sofort, Rest wird erzeugt.

## Akzeptanzkriterien

- [ ] Richtige Cover für CBZ, CBR (RAR4, RAR5, ZIP-als-CBR), CBT (und CB7, falls E7) – zweites Laden aus dem Cache
      (< 5 ms je Cover, gemessen).
- [ ] Vorhandene `Band.jpg`/`Band_xl.jpg` werden ausgeliefert statt neu erzeugt.
- [ ] Kaputte/feindliche Archive: Platzhalter, keine Hänger, Speicher bleibt begrenzt.
- [ ] Nichts wird in die Comic-Ordner geschrieben.
- [ ] Review durch separaten Agenten (Archive, Decoder, Schema-Handler).

## Abweichungen bei der Umsetzung

- **URL** `/<Kategorie-Id>.<Buch-Id>.<dimIndex>?v=<mtime>` statt Schrägstrichen: ein Segment, streng geparst
  (`cover::parse_path`), Ids nur `[0-9a-z-]`.
- **Module**: `book/zip_book.rs`, `book/tar_book.rs` (statt `zip.rs`/`tar.rs`, Namenskonflikt mit den Crates);
  URL und Antwort in `cover/mod.rs` statt `cover/scheme.rs`; API `book::list` + `book::read` statt `images()` /
  `read_entry`.
- **`cover_stats`** entfällt (E10 „optional“): Fehler stehen in `CoverService::failures()` bereit, 007 entscheidet.
- **Größe `_xl`**: 200–300 KB statt geschätzter 120 KB (Messung in `docs/architecture.md`).
- **Review** (separater Agent): ZIP-Verzeichnis wird vor dem Parsen geprüft (Anzahl, ≤ 64 MiB); Wörterbuch ≤ 256 MiB
  statt 1 GiB (fnf-Wert galt dem Entpacken, 4 Cover-Worker × 1 GiB wären zu viel); höchstens 512 MiB vor der
  Titelseite eines soliden Buchs; Zeitlimit auch beim RAR-Listing; nur bleibende Fehler gemerkt; ein erneut
  angefragtes Cover rückt im Pool nach oben; Ordner-/Typwechsel vergisst die Bücher der Kategorie; das Frontend fragt
  ein fehlgeschlagenes Cover zweimal neu (503 bei voller Warteschlange) statt es für die Sitzung zu verstecken.
  Bewusst offen: das Dekodieren eines Bildes hat kein Zeitlimit (begrenzt durch 64 MP); fnv64-Ids sind nicht
  kollisionsfest (schlimmstenfalls falsches Cover, kein Zugriff außerhalb der Kategorie); nicht-UTF-8-Pfade, die sich
  nur in ungültigen Bytes unterscheiden, teilen sich eine Id (Linux, selten).

## Akzeptanz (Ergebnis, 22.10.2026)

- [x] Richtige Cover für CBZ, CBR (RAR4, RAR5, ZIP-als-CBR), CBT, CB7 (Tests + echte Bücher); Cache-Treffer 0,05–0,1 ms.
- [x] Sidecars werden ausgeliefert statt erzeugt (`cover::tests::sidecars_win`); auf dem Mac mit „Comics“ zu prüfen.
- [x] Kaputte/feindliche Archive: Platzhalter (404/415/422), Bomben/Slip/Lügner aus fnf als Tests, Zeitlimit 20 s.
- [x] Nichts in die Comic-Ordner geschrieben (E2E: Testsammlung vor/nach unverändert).
- [x] Review durch separaten Agenten – Befunde und Fixes im Commit `fix(rust): Befunde des Reviews zu Design 003`.

Ende-zu-Ende (Container, Debug-Build, Xvfb): Testsammlung mit 3 echten CBR, erzeugten CBZ (Umlaut, Emoji, `cover.jpg`
im Unterordner), ZIP-als-CBR, CBT und kaputten Dateien. Während des Ladens zeigt die Zeile das Format-Kürzel, dann das
Cover; Hägar zeigt das tiefe `cover.jpg`; kaputte Bücher und PDF behalten das Kürzel. Neustart: alle Cover sofort aus
dem Cache; dunkles Schema ok. Screenshots: `003-screenshots/` (Cover echter Bücher verpixelt).

## Fortschritt

- [x] Phase 1: Design – freigegeben mit E7 (CB7), 22.10.2026
- [x] Phase 2: Rust
- [x] Phase 3: Frontend
- [x] Phase 4: Ende-zu-Ende
- [x] Phase 5: Doku
- [x] Phase 6: Abschlussprüfung
