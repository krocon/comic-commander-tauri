# Comic Commander – Texte für Einträge

> Quelle aller Aussagen: https://krocon.de/products/comiccommander/ und Release v1.0.1 (`facts.json`).
> Keine Aussage hinzufügen, die dort nicht belegt ist. Englisch für internationale Portale, Deutsch für deutsche
> (chip.de, heise download, Softpedia DE …).

## Name

Comic Commander

## Tagline (≤ 60 Zeichen)

- EN: `Comic library browser and reader for your desktop` (50)
- DE: `Comic-Sammlung als Cover-Wand – mit eingebautem Leser` (53)

## Kurzbeschreibung (≤ 160 Zeichen)

- EN: `Free, open-source comic browser for macOS, Windows and Linux: your CBZ, CBR, CB7, CBT and PDF library as a cover wall or bookshelf, with a built-in reader.`
- DE: `Kostenloser Open-Source-Comic-Browser für macOS, Windows und Linux: CBZ, CBR, CB7, CBT und PDF als Cover-Wand oder Regal, mit eingebautem Leser.`

## Paketmanager-Beschreibung (eine Zeile, ohne Produktname am Anfang, ≤ 80 Zeichen)

`Comic browser with cover thumbnails and a built-in reader` (57)

## Lange Beschreibung – Englisch

Comic Commander shows your comic library as a wall of covers or on a wooden bookshelf and opens the books in a
built-in reader. It is free, open source (MIT) and runs on macOS, Windows and Linux.

- **Cover wall** – every book as a cover, grouped by series or folder, with volume count and reading progress. Filter
  as you type; sort by series, name, date or size.
- **Bookshelf view** – covers stand on wooden shelves in their real proportions, series as stacks.
- **Reader** – single page or continuous, several zoom modes, rotation, manga mode (right to left), full screen. The
  last page of every book is remembered.
- **Formats** – CBZ, CBR, CB7, CBT and PDF, also plain ZIP, RAR 4/5, 7z and TAR. Archives are recognised by their
  content, not by the file extension.
- **Your files stay untouched** – comic folders are only read; cache and settings live in the app's own folders.
- **More** – metadata from ComicInfo.xml, categories (e.g. comics, manga, magazines), missing thumbnails generated in
  the background, natural sort order, a keyboard shortcut for every function (custom keymap via `keymap.json`).

Built with Tauri 2, Rust and Angular. The user interface is in English.

Comic Commander is meant for comics you are allowed to have – scanned from your own books, DRM-free purchases or
freely licensed comics. It downloads nothing.

Note: the packages are not code-signed yet. macOS: right-click → Open on first start. Windows: SmartScreen → More info
→ Run anyway.

## Lange Beschreibung – Deutsch

Comic Commander zeigt deine Comic-Sammlung als Wand aus Covern oder auf einem Holzregal und öffnet die Bücher in einem
eingebauten Leser. Kostenlos, Open Source (MIT), für macOS, Windows und Linux.

- **Cover-Wand** – alle Bücher als Cover, nach Serie oder Ordner gruppiert, mit Bandanzahl und Lesefortschritt. Filter
  beim Tippen, Sortierung nach Serie, Name, Datum oder Größe.
- **Regal** – die Cover stehen in echten Proportionen auf Holzregalen, Serien als Stapel.
- **Leser** – Einzelseite oder fortlaufend, mehrere Zoom-Modi, Drehen, Manga-Modus (rechts nach links), Vollbild. Die
  letzte Seite jedes Buchs wird gemerkt.
- **Formate** – CBZ, CBR, CB7, CBT und PDF, dazu ZIP, RAR 4/5, 7z und TAR – erkannt am Inhalt, nicht an der Endung.
- **Deine Dateien bleiben unberührt** – die Comic-Ordner werden nur gelesen; Cache und Einstellungen liegen in den
  Ordnern der App.
- **Außerdem** – Metadaten aus ComicInfo.xml, Kategorien (z. B. Comics, Manga, Magazine), fehlende Thumbnails im
  Hintergrund, natürliche Sortierung, für jede Funktion ein Tastenkürzel (eigene Belegung über `keymap.json`).

Gebaut mit Tauri 2, Rust und Angular. Die Oberfläche ist derzeit Englisch; Deutsch ist geplant.

Nur für Comics, die du rechtmäßig besitzt – eigene Scans, DRM-freie Käufe oder frei lizenzierte Comics. Die App lädt
nichts herunter.

Hinweis: Die Pakete sind noch nicht signiert (macOS: Rechtsklick → Öffnen; Windows: SmartScreen → Weitere
Informationen → Trotzdem ausführen).

## Kategorien

- Allgemein: Graphics / Viewers · Multimedia · E-Book- bzw. Comic-Reader
- AlternativeTo: Kategorie „Photos & Graphics“ bzw. die Kategorie, unter der vergleichbare Comic-Reader stehen
  (dort nachsehen, nicht raten)
- Linux (Desktop-Datei im .deb v1.0.1): `Graphics;` – `Viewer;` wäre passender (`bundle.linux` in
  `tauri.conf.json`, nächstes Release)

## Tags

`comic`, `comics`, `comic-reader`, `comic-viewer`, `manga`, `manga-reader`, `cbz`, `cbr`, `cb7`, `cbt`, `pdf`,
`comicinfo`, `library`, `bookshelf`, `tauri`, `rust`, `open-source`, `cross-platform`

## Vergleichbare Programme (für „Alternative to“-Angaben)

Nur verwenden, wenn die Plattform selbst diese Programme als Comic-Reader führt: ComicRack, YACReader, CDisplayEx,
Simple Comic, MComix, Komga (Server), Kavita (Server). Keine Aussagen über Vorteile gegenüber diesen Programmen.

## Screenshots

1. https://krocon.de/products/comiccommander/img/grid.png – Cover wall
2. https://krocon.de/products/comiccommander/img/shelf.png – Bookshelf view
3. https://krocon.de/products/comiccommander/img/view.png – Reader

Icon: https://raw.githubusercontent.com/krocon/comic-commander-tauri/main/src-tauri/icons/icon.png

## Show HN / Product Hunt – Entwurf (nur nach Freigabe posten)

**Show HN: Comic Commander – a desktop comic library browser and reader (Tauri, Rust)**

> I rewrote my old comic server (Angular + NestJS) as a desktop app with Tauri 2, Rust and Angular. It shows a comic
> library (CBZ, CBR, CB7, CBT, PDF) as a cover wall or a wooden bookshelf and reads the books in a built-in reader –
> single page or continuous, manga mode, zoom, rotation. Archives are detected by content, RAR/7z/PDF are handled in
> Rust, and the comic folders are only read, never written. MIT licensed; builds for macOS, Windows and Linux (not
> code-signed yet). Feedback welcome.
> https://github.com/krocon/comic-commander-tauri

(Der Text ist in Marcs Namen geschrieben: vor dem Posten von Marc prüfen lassen.)
