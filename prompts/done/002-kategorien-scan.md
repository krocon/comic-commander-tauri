# Prompt 002: Kategorien und Scan mit Cache

> Braucht: 001 · Umfang: M · Branch `feat/kategorien-scan`
> Gemeinsame Regeln: [`000-arbeitsweise.md`](../000-arbeitsweise.md). Vorlage: legacy §2, §3, §9.

## Ziel

Wie in der Vorlage definiert der Nutzer eine oder mehrere **Kategorien**. Jede Kategorie hat einen Ordner
(`baseDir`), der rekursiv gescannt wird; alle Dateien mit einer der `bookExtensions` der Kategorie erscheinen als Cover
(ab 004; bis dahin in der Liste aus 001). Anders als in der Vorlage (nur beim Serverstart aus `config.json`) werden
Kategorien **zur Laufzeit in der App verwaltet**. Das Scan-Ergebnis erscheint beim nächsten Öffnen **sofort aus dem
Cache** und wird im Hintergrund aktualisiert (stale-while-revalidate wie legacy §3).

Marcs alte Konfiguration (Vorlage, macOS) als Maßstab:

```json
{ "categories": [
  { "baseDir": "/Users/marckronberg/FilmeOut.nosync/_done/comics.nosync", "bookExtensions": [".cbz", ".cbr"],
    "title": "Comics", "icon": "stars", "dimIndex": 1, "initialFilter": "",
    "thumbsDims": [ { "width": 200, "height": 300, "nameExtension": "" },
                    { "width": 800, "height": 1200, "nameExtension": "_xl" } ] },
  { "baseDir": "/Users/marckronberg/FilmeOut.nosync/_done/ct Make", "bookExtensions": [".pdf"],
    "title": "Make", "icon": "stars", "dimIndex": 1, "initialFilter": "", "thumbsDims": [ … wie oben … ] } ] }
```

## Anforderungen

1. **Kategorie** = `{ id, title, baseDir, bookExtensions, icon, thumbsDims, dimIndex, initialFilter }` – Feldnamen wie
   die Vorlage (ohne `apiUrl`, `port`, `tempDir`). Gespeichert in `categories.json` im App-Config-Ordner
   (Schema-Version, `sanitize`, atomar, kaputte Datei → `.bad`; Vorbild files-and-folders `config_file.rs`,
   `fs_atomic.rs`). `thumbsDims`/`dimIndex` wirken ab 003/004, werden aber schon hier verwaltet.
2. **Zur Laufzeit verwalten**: Dialog „Kategorien verwalten“ – anlegen, bearbeiten (alle Felder), entfernen,
   sortieren; Wechsel der aktiven Kategorie über ein Menü in der Toolbar (wie das Menü der Vorlage, legacy §9).
   Änderungen wirken sofort (geänderter `baseDir` oder `bookExtensions` → neuer Scan), letzte Kategorie gemerkt.
3. **Import der alten `config.json`** der Vorlage: Datei wählen, Vorschau der Kategorien, übernehmen (hinzufügen;
   schon vorhandene gleiche Kategorie überspringen). Material-Icon-Namen (`stars`, …) auf die eigenen Icons abbilden.
4. **Ordner wählen**: nativer Ordnerdialog (E1); Pfad auch eintippbar.
5. **Scan** (Erweiterung von `library.rs`) mit den `bookExtensions` der Kategorie (Groß-/Kleinschreibung egal – die
   Vorlage verglich exakt): abbrechbar, Fortschritt (Bücher, Ordner), Ergebnis gestreamt in Paketen (≤ 500 / 50 ms).
   Nur ein Scan je Kategorie gleichzeitig (laufenden teilen wie legacy §3 `runningScansPromises`).
6. **Cache** je Kategorie im App-Cache, **nie** im Comic-Ordner (legacy §10.2). Beim Öffnen: Cache sofort liefern
   (`scannedAt` anzeigen), dann neu scannen und nur Unterschiede melden (hinzugekommen/entfernt/geändert).
7. **Symlinks** (E2) und **erlaubte Endungen** (E3) entscheiden.
8. **UI**: Kategorie-Menü (Icon + Titel), Status „584 Bücher · aktualisiert vor 3 min“ bzw. „wird aktualisiert…“,
   „Neu scannen“; erster Start ohne Kategorie: „Kategorie anlegen…“ / „Alte Konfiguration importieren…“.
9. Optional, wenn klein: Ordner-Überwachung der offenen Kategorie – sonst Folge-Eintrag in `prompts/README.md`.

## Entscheidungsfragen

- **E1 Ordnerdialog:** `tauri-plugin-dialog` vs. `rfd` vs. nur Texteingabe; Regel A2 (keine breiten Plugins).
- **E2 Symlinks:** Links auf Ordner/Dateien folgen (mit Besucht-Menge) oder nicht.
- **E3 Endungen:** frei wählbar (Vorlage) oder aus einer Liste der Formate, die 003/006 lesen können?
- **E4 Icons:** Font Awesome 4.5.0 (wie files-and-folders) vs. Inline-SVG; Abbildung der Material-Namen.
- **E5 Cache-Format:** JSON vs. Binär – Messung mit 50 000 Einträgen.

## Verträge (Skizze, im Design ausarbeiten)

- Commands: `load_categories`, `save_categories`, `pick_folder`, `import_legacy_config`, `open_category(id, channel)`
  → Ereignisse `cached | started | batch | progress | diff | done | cancelled | failed`, `cancel_scan(id)`.
- TS: `CategoriesApi`, `ScanApi`, `CategoriesStore` (Root: Liste, aktive Kategorie), `CategoryStore` je Ansicht.

## Tests

- Rust: sanitize (Endungen, `thumbsDims`, `dimIndex`), Import der Vorlagen-Konfiguration (Marcs Datei als Testfall,
  kaputt, fremde Felder), Cache schreiben/lesen/kaputt/alte Version, Diff, Abbruch, geteilter Scan, 50 000 Dateien
  (Zeit messen, in `docs/architecture.md` festhalten).
- Frontend: Store mit Fake-Kanal (cached → batch → diff), Wechsel der Kategorie während eines Scans (veraltete
  Ereignisse verwerfen), Dialog per Tastatur, Import-Vorschau.

## Akzeptanzkriterien

- [ ] Zwei Kategorien anlegen (eine nur `.pdf`), wechseln, bearbeiten, entfernen – überlebt einen Neustart.
- [ ] Marcs alte `config.json` importieren ergibt „Comics“ und „Make“ mit Ordnern, Endungen und Thumb-Größen.
- [ ] Zweites Öffnen einer großen Kategorie zeigt die Bücher < 300 ms aus dem Cache; neue Dateien erscheinen nach dem
      Hintergrund-Scan ohne Neuladen der Ansicht.
- [ ] Im Comic-Ordner entsteht keine Datei.
- [ ] Nicht erreichbarer Ordner (ausgehängtes Laufwerk): Cache wird gezeigt + verständlicher Hinweis.
