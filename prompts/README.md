# Feature-Prompts – Comic Commander (Tauri)

Arbeitsaufträge für die Weiterentwicklung, jeweils für **eine neue Claude-Sitzung** im Repo. Jeder Prompt führt in
Phasen vom Design über Rust- und Frontend-Tests bis zur Ende-zu-Ende-Prüfung und hält nach dem Design an
(Freigabe). Gemeinsame Regeln: [000-arbeitsweise.md](000-arbeitsweise.md).

**So startet man einen Prompt:** neue Sitzung im Repo, dann z. B.
„Lies `prompts/000-arbeitsweise.md` und führe `prompts/005-leser.md` aus.“

**Erledigte Prompts** liegen unter [`done/`](done/) (Auftrag + `*.design.md`); Kürzel wie „003 E4“ in Code und Doku
verweisen auf ihre Entscheidungen.

Herkunft: Analyse der Vorlage comiccommander (`docs/legacy-analysis.md`), Architektur und wiederverwendbarer Code aus
files-and-folders-tauri (`CLAUDE.md` §8), GuiExpert Table 1.1.102 im Cover-Grid-Modus.

## Reihenfolge

Kritischer Pfad zum ersten nutzbaren Stand (Grid mit Covern + Leser): **001 → 002 → 003 → 004 → 005**. Danach 006/007
in beliebiger Reihenfolge, 008 → 009, dann 010–013.

| Nr. | Prompt | Inhalt | Braucht | Umfang | Status |
|---|---|---|---|---|---|
| 000 | [000-arbeitsweise.md](000-arbeitsweise.md) | gemeinsamer Ablauf, Phasen, Regeln | – | – | – |
| 001 | [001-grundgeruest.md](done/001-grundgeruest.md) | Walking Skeleton: Tauri 2 + Angular 22 + Rust, Fassade, `scan_library`, Liste, Tests, Icon | – | M | ✅ 22.10.2026 |
| 002 | [002-kategorien-scan.md](done/002-kategorien-scan.md) | Kategorien zur Laufzeit verwalten (Titel, `baseDir`, `bookExtensions`, Icon, Thumb-Größen, Anfangsfilter), Import der alten `config.json`, Ordnerdialog, Scan gestreamt + abbrechbar, Cache im App-Cache | 001 | M | ✅ 22.10.2026 |
| 003 | [003-cover-thumbnails.md](done/003-cover-thumbnails.md) | Archive lesen (ZIP/RAR/7z/TAR nach Inhalt), Cover-Wahl, Thumbnails + Cache, alte Sidecars, URI-Schema | 001, 002 | L | ✅ 22.10.2026 |
| 004 | [004-cover-grid.md](done/004-cover-grid.md) | GuiExpert Cover-Grid, Renderer, Größen, Filter `+/-`, Serie filtern, Tastatur, Aktionen je Buch, Scrollposition | 002, 003 | L | ✅ 22.10.2026 |
| 005 | [005-leser.md](done/005-leser.md) | Leser: Einzelseite/fortlaufend, Blättern wie Vorlage, Seiten direkt aus dem Archiv, Vorausladen, Position merken | 003, 004 | L | ✅ 23.10.2026 |
| 006 | [006-pdf.md](done/006-pdf.md) | PDF: Seitenzahl, Cover, Seiten rendern (Renderer-Entscheidung), Schnellweg eingebettete JPEGs | 003, 005 | M–L | ✅ 23.10.2026 |
| 007 | [007-thumbs-generieren.md](done/007-thumbs-generieren.md) | Job-Engine (schlank) + fehlende Thumbnails im Stapel mit Fortschritt, Restzeit, Pause, Abbruch | 003 | M | ✅ 23.10.2026 |
| 008 | [008-aktionen-menue-tastatur.md](done/008-aktionen-menue-tastatur.md) | Aktionskatalog, Keymaps je OS, native/HTML-Menüleiste, Kontextmenü, Befehlspalette, About | 004, 005 | M | ✅ 23.10.2026 |
| 009 | [009-einstellungen-themes-i18n.md](009-einstellungen-themes-i18n.md) | Einstellungen + Dialog, Farbschemata, Deutsch/Englisch zur Laufzeit | 004, 005, 008 | M | offen |
| 010 | [010-duplikate.md](010-duplikate.md) | Duplikate: identisch, ähnlich (pHash), Namensnähe; Vergleich mit Covern, Papierkorb | 003, 004, 007 | M–L | offen |
| 011 | [011-metadaten-serien.md](done/011-metadaten-serien.md) | *optional*: ComicInfo.xml, Serie/Nummer, Serien- und Ordneransicht | 002, 004 | M | ✅ 23.10.2026 |
| 012 | [012-release-distribution.md](012-release-distribution.md) | Version, Lizenzen (unRAR, PDF), Pakete je OS, CI-Vorlagen, Signierung vorbereiten | – | M | offen |
| 013 | [013-feature-paritaet.md](013-feature-paritaet.md) | Matrix gegen comiccommander mit Testbelegen, Lücken → neue Prompts | 002–010 | S–M | offen |
| 014 | [014-zoom-modi.md](done/014-zoom-modi.md) | Leser: Zoom-Modi (Fit width/height/page, Full size), Zoom-Regler, Drehen links/rechts, dezente Toolbar mit sanftem Aus-/Einblenden | 005, 006, 008 | M | ✅ 23.10.2026 |
| 015 | [015-regalansicht.md](done/015-regalansicht.md) | Darstellung „Regal“ wie die iBooks-Fotos (`img*.png`): Holzrückwand, Seitenwände, Böden mit Schatten, Bildfragmente; umschaltbar zum Raster | 004, 008, 011 | M–L | ✅ 24.10.2026 |

## Folge-Ideen (noch ohne Prompt)

- Ordner-Überwachung der offenen Kategorie (in 002 verschoben, E8).
- Leser: Doppelseiten (005 E3), Miniaturleiste (005 E13).
- Serien-Heuristik mit Marcs echter Namensliste nachschärfen (011, Katalog `book-info.cases.json`); ComicInfo auch
  aus PDF-Metadaten (Title/Author); „Im Finder zeigen“ für Ordnerkacheln (neuer Command, 011 E6).
- Kürzel-Editor (008 E2 → 009) und ein Hilfe-Menü auf macOS mit Link auf das Repo.
- Regal: Hefte ohne Buchrücken wie die Zeitschriften in `img_1.png` (015 E5), Regal-Standard global in den
  Einstellungen (015 E1 → 009).
- Lesefortschritt synchronisieren (z. B. über eine Datei im Kategorie-Ordner) – nur nach Entscheidung zu legacy §10.2.
