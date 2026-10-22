# Prompt 002: Bibliotheken und Scan mit Cache

> Braucht: 001 · Umfang: M · Branch `feat/bibliotheken-scan`
> Gemeinsame Regeln: [`000-arbeitsweise.md`](000-arbeitsweise.md). Vorlage: legacy §2, §3, §9.

## Ziel

Der Nutzer verwaltet eine oder mehrere **Bibliotheken** (die „Kategorien“ der Vorlage) und wechselt zwischen ihnen.
Jede Bibliothek wird rekursiv gescannt; das Ergebnis erscheint beim nächsten Öffnen **sofort aus dem Cache** und wird
im Hintergrund aktualisiert (stale-while-revalidate wie legacy §3) – auch bei Sammlungen mit 50 000 Büchern auf einem
Netzlaufwerk.

## Anforderungen

1. **Bibliotheken** in `libraries.json` im App-Config-Ordner (Schema-Version, `sanitize`, atomar schreiben, kaputte
   Datei beiseitelegen → Vorbild files-and-folders `config_file.rs`/`fs_atomic.rs`):
   `{ id, title, root, icon?, initialFilter?, coverSize? }`. Erste Bibliothek beim ersten Start: `~/Comics`, falls
   vorhanden, sonst Assistent „Ordner wählen“.
2. **Ordner wählen**: nativer Ordnerdialog – Entscheidung E1 (s. u.). Pfad auch eintippbar (wie heute).
3. **Scan** (Erweiterung von `library.rs`): als abbrechbare Arbeit mit Fortschritt (gefundene Bücher, Ordner);
   Ergebnis gestreamt in Paketen (≤ 500 / 50 ms), damit das Grid früh etwas zeigt. Nur ein Scan je Bibliothek
   gleichzeitig (laufenden teilen wie legacy §3 `runningScansPromises`).
4. **Cache** je Bibliothek im App-Cache (`app_cache_dir/library/<hash(root)>.json`, versioniert, atomar), **nie** im
   Comic-Ordner (legacy §10.2). Beim Öffnen: Cache sofort liefern (`cachedAt` markieren), dann neu scannen und nur
   Unterschiede melden (hinzugekommen/entfernt/geändert).
5. **Symlinks** (E2): bisher ignoriert (001 A4). Entscheiden, ob Links auf Ordner mit Besucht-Menge (Gerät + Inode)
   verfolgt werden – die Vorlage folgte ihnen (legacy §3), ohne Zyklusschutz.
6. **Weitere Endungen** (E3): Soll die Bibliothek Endungen konfigurieren können (Vorlage: `bookExtensions`), z. B.
   `.zip`/`.rar`/`.epub`? Empfehlung im Design.
7. **UI**: Bibliotheks-Wahl in der Toolbar (Liste mit Titel + Icon, Font Awesome 4.5.0 wie files-and-folders oder
   eigene SVGs – E4), Dialog „Bibliotheken verwalten“ (anlegen, umbenennen, Ordner ändern, entfernen, sortieren).
   Letzte Bibliothek merken. Status: „12 345 Bücher · aktualisiert vor 3 min“ bzw. „wird aktualisiert…“.
8. Optional, wenn klein: Ordner-Überwachung (notify) für die offene Bibliothek – sonst als Folge-Eintrag in
   `prompts/README.md`.

## Entscheidungsfragen

- **E1 Ordnerdialog:** `tauri-plugin-dialog` (nur `dialog:allow-open` mit `directory: true`) vs. eigener Command
  über `rfd` vs. nur Texteingabe. Regel A2 verbietet breite Plugins – das Dialog-Plugin gibt aber keinen
  Dateizugriff, nur einen Pfad. Empfehlung + Capability-Ausschnitt.
- **E2 Symlinks** (s. o.).
- **E3 Endungen** (s. o.).
- **E4 Icons:** Font Awesome 4.5.0 (wie files-and-folders, Assets übernehmen) vs. Inline-SVG.
- **E5 Cache-Format:** JSON (einfach, ~100 B/Buch) vs. Binär (bincode) – Messung mit 50 000 Einträgen.

## Verträge (Skizze, im Design ausarbeiten)

- Commands: `load_libraries`, `save_libraries`, `pick_folder` (falls E1 eigener Command), `open_library(id,
  channel)` → Ereignisse `{ kind: 'cached' | 'batch' | 'diff' | 'done' | 'error', … }`, `cancel_scan(id)`.
- TS: `LibrariesApi`, `LibrariesStore` (Root: Liste, aktive Bibliothek), `LibraryStore` je Ansicht.

## Tests

- Rust: Cache schreiben/lesen/kaputt/alte Version, Diff, Abbruch, geteilter Scan, Symlink-Zyklus (falls E2),
  50 000 Dateien (Zeit messen, in `docs/architecture.md` festhalten).
- Frontend: Store mit Fake-Kanal (cached → batch → diff), Wechsel der Bibliothek während eines Scans (veraltete
  Ereignisse verwerfen), Dialog per Tastatur.

## Akzeptanzkriterien

- [ ] Zwei Bibliotheken anlegen, wechseln, umbenennen, entfernen – überlebt einen Neustart.
- [ ] Zweites Öffnen einer großen Bibliothek zeigt die Bücher < 300 ms aus dem Cache; neue Dateien erscheinen nach dem
      Hintergrund-Scan ohne Neuladen der Ansicht.
- [ ] Im Comic-Ordner entsteht keine Datei.
- [ ] Nicht erreichbarer Ordner (ausgehängtes Laufwerk): Cache wird gezeigt + verständlicher Hinweis.
