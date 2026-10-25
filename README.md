# Comic Commander

Ein Comic-Browser für **macOS, Windows und Linux**: zeigt eine Comic-Sammlung (CBZ, CBR, CB7, CBT, PDF) als Raster aus
**Cover-Thumbnails** und öffnet die Bücher in einem eingebauten Leser.

Neuauflage des Comic-Servers *comiccommander* (Angular + NestJS) als Desktop-App mit **Tauri 2**, **Angular 22**
(zoneless, Signals) und **Rust** – in derselben Architektur wie
[files-and-folders-tauri](https://github.com/krocon/files-and-folders-tauri). Das Cover-Raster ist eine
[GuiExpert Table](https://github.com/guiexperttable/mono) im Cover-Grid-Modus.

> **Stand:** Prompt 014 – Cover-Grid, Leser (auch PDF) mit Zoom und Drehen, Thumbnails im Stapel, Menüleiste,
> Befehlspalette und Tastaturkürzel. Fahrplan in [`prompts/README.md`](prompts/README.md).

## Was funktioniert

- **Kategorien** wie im alten Comic Commander: je Kategorie ein Ordner (`baseDir`), die Dateitypen
  (`.cbz .cbr .cb7 .cbt .pdf .zip .rar .7z .tar`), Titel, Icon, Thumbnail-Größen und Anfangsfilter – zur Laufzeit im
  Dialog „Manage categories“ anlegen, ändern, sortieren, entfernen; Ordner über den nativen Dialog wählen.
- **Import der alten `config.json`** mit Vorschau (fehlende Ordner, Duplikate, nicht unterstützte Typen werden
  angezeigt).
- **Scan** rekursiv in Rust; beim nächsten Öffnen erscheint die Liste sofort aus dem Cache und wird im Hintergrund
  aktualisiert. Nichts wird in die Comic-Ordner geschrieben. Ist ein Ordner nicht erreichbar, bleibt der letzte
  Stand sichtbar.
- **Cover** aus CBZ, CBR (RAR4, RAR5, auch CBR, die eigentlich ZIP sind), CB7 und CBT – erkannt am Inhalt, nicht an
  der Endung. Titelseite: ein Bild mit `cover` im Namen, sonst das erste Bild in natürlicher Reihenfolge. Vorhandene
  Thumbnails des alten Comic Commanders (`Band.jpg`, `Band_xl.jpg`) werden genutzt; neue Cover liegen im App-Cache
  (höchstens 2 GiB) und erscheinen beim nächsten Start sofort. Kaputte oder verschlüsselte Bücher zeigen das
  Format-Kürzel. PDF-Cover folgen mit Prompt 006.
- **Cover-Grid**: randlos über die ganze Breite, die Toolbar schwebt darüber. Filter wie im alten Comic Commander
  (`asterix obelix` = eins davon, `+asterix` = muss, `-album` = darf nicht), „Thumb size“ aus der Kategorie,
  Sortierung nach Ordner und Name, Dateiname, Datum oder Größe. Filter, Größe, Sortierung und Position merkt sich
  die App je Kategorie. Auf Retina werden automatisch die großen Cover geladen.
- **Serien und Ordner**: drei Ansichten (Toolbar-Knöpfe oder `Ctrl/⌘ + Shift + L / S / D`) – alle Bücher, **nach
  Serie** (eine Kachel je Serie mit Cover des ersten Bands, Anzahl und Lesefortschritt; Klick zeigt die Bände in
  Nummernfolge) und **nach Ordner** (Breadcrumb, `Backspace` eine Ebene hoch). Serie und Nummer kommen aus der
  **`ComicInfo.xml`** im Buch (ComicRack; wird nach dem Scan im Hintergrund gelesen und im Cache gehalten), sonst aus
  dem Namen (`Serie 01 - Titel (Verlag 2015)`, `Serie #12`, `Serie Band 3`, `Spirou T01`, `Batman v2 012`,
  `005_Bessy_…` im Ordner `Bessy`). Filter mit Feldern: `series:asterix`, `series:"im roten bereich"`, `year:1990-1999`,
  `writer:`, `publisher:` (auch mit `+`/`-`); Sortierung „Series and number“. Bücher mit
  `Manga=YesAndRightToLeft` liest der Leser von rechts nach links.
- **Regal** (Toolbar-Knopf 📖, Menü „View → Look: shelf“ oder `Ctrl/⌘ + Shift + B`): statt des randlosen Rasters
  stehen die Bücher wie im iBooks-Regal auf Holzböden vor einer Holzrückwand, mit Buchrücken, Schatten und echtem
  Seitenverhältnis; leere Böden laufen bis zum Fensterende weiter, Bücher ohne Cover erscheinen als Leineneinband mit
  Titel. Alles andere (Filter, Ansichten, Größen, Tastatur, Lesen) geht wie im Raster; die Wahl merkt sich die App je
  Kategorie.
- **Aktionen je Buch** (Klick, Leertaste oder Rechtsklick): mit der Standard-App öffnen, im Finder zeigen, Serie
  filtern, Pfad kopieren – mit den Tastenkürzeln daneben.
- **Leser** (`Enter`/Doppelklick): Einzelseite oder fortlaufend; Zoom **Fit width, Fit height, Fit page, Full size**
  oder frei (Zoom-Regler, `+`/`-`, Strg/⌘ + Mausrad, Pinch); große Seiten erst bildschirmweise in Zeilen lesen, dann
  blättern, mit der Maus ziehen; **drehen** links/rechts (je Buch gemerkt); Klick ins linke/rechte Drittel, Wischen,
  Schieberegler, Manga (rechts → links), Vollbild. Die Toolbar mit dezenten Icons blendet beim Lesen aus und kommt
  zurück, wenn die Maus an den oberen Rand geht (`T` hält sie fest). Seiten kommen direkt aus dem Buch – JPEG, PNG, WebP, GIF, BMP; 7z und solide RAR
  werden einmal in den App-Cache entpackt (begrenzt auf 1 GiB, älteste zuerst weg). Die letzte Seite je Buch wird
  gemerkt (`reading-state.json`), das Grid zeigt den Lesefortschritt als Balken am Cover.
- **PDF**: Cover und Seiten, gerendert in Rust (`hayro`, ohne externe Programme); bei Scan-PDFs wird das eingebettete
  JPEG direkt gezeigt. Verschlüsselte PDFs werden nicht geöffnet.
- **Thumbnails erzeugen** (Kategorie-Menü → „Generate thumbnails…“): alle fehlenden Cover einer oder aller Kategorien
  im Hintergrund, mit Fortschritt, Restzeit, Pause und Abbruch; die Toolbar zeigt den Stand, fehlerhafte Bücher
  werden am Ende aufgelistet. Ein abgebrochener Lauf setzt beim nächsten Start fort.
- **Menüleiste**: Ablage, Ansicht, Kategorie, Lesen (Windows/Linux zusätzlich Hilfe) – auf macOS als natives Menü,
  sonst als Menüleiste im Fenster (`F10`). Jede Funktion ist eine Aktion; Menü, Kontextmenü, Kürzel und die
  **Befehlspalette** (`Ctrl/⌘ + Shift + P`, Suche nach Namen) zeigen dieselben. „About“ zeigt Version und Plattform.
- **Eigene Kürzel** in `keymap.json` im App-Config-Ordner (z. B. `~/Library/Application Support/io.github.krocon.comiccommander/` bzw.
  `~/.config/io.github.krocon.comiccommander/`): `{"version": 1, "bindings": {"book.copyPath": ["Mod+Shift+K"], "app.quit": []}}` –
  ersetzt die Kürzel der Aktion (`[]` entfernt sie; `Mod` = ⌘ bzw. Ctrl). Ein Editor folgt mit den Einstellungen.
- Natürliche Reihenfolge (`Band 2` vor `Band 10`), Umlaute in beiden Unicode-Formen gleich behandelt.
- Hell/Dunkel folgt dem System.

### Tastenkürzel

| Taste | Funktion |
|---|---|
| Pfeiltasten, `Home`/`End`, `Bild ↑/↓` | Cursor im Raster |
| `Enter` / Doppelklick | Buch lesen (auch PDF); Serie/Ordner öffnen (auch Klick) |
| `Backspace`, `Alt + ↑`, `Esc` (Filter leer) | eine Ebene hoch (Serien-/Ordneransicht) |
| `Ctrl/⌘ + Shift + L / S / D` | Ansicht: alle Bücher / nach Serie / nach Ordner |
| `Ctrl/⌘ + Shift + B` | Darstellung: Raster ⇄ Regal |
| `Leertaste`, `Shift+F10`, Rechtsklick | Aktionen für das Buch |
| Tippen | springt in den Filter; `Esc` leert ihn |
| `Ctrl/⌘ + F` | Filter |
| `Ctrl/⌘ + Plus / Minus` | Cover größer / kleiner |
| `Ctrl/⌘ + R` | Kategorie neu scannen |
| `Ctrl/⌘ + O` · `Ctrl/⌘ + Shift + R` · `Ctrl/⌘ + Shift + C` | Buch mit Standard-App öffnen · im Dateimanager zeigen · Pfad kopieren |
| `Ctrl/⌘ + Shift + P` | Befehlspalette |
| `F10` (Windows/Linux) | Menüleiste (`←`/`→`, `↓`, `Enter`, `Esc`) |
| `Ctrl + Q` / `⌘ + Q` | Beenden |
| `Ctrl/⌘ + 1 … 9` | Kategorie 1 … 9 wählen |
| Menü-Button, `↓`/`Enter` | Kategorie-Menü öffnen (`↑`/`↓`, `Enter`, `Esc`) |
| Dialog: `Ctrl/⌘ + Enter`, `Esc` | Speichern, Abbrechen; Liste: `Alt + ↑/↓` verschiebt |

**Im Leser**

| Taste | Funktion |
|---|---|
| `→` `↓` `n` `Leertaste` `Bild ↓` | weiter (hohe Seite: erst scrollen) |
| `←` `↑` `b` `Shift+Leertaste` `Bild ↑` | zurück |
| `Ctrl/⌘ + Pfeil`, `Home`/`End` | erste / letzte Seite (Manga: `←` = letzte) |
| `S` / `M` | Einzelseite ⇄ fortlaufend / Manga (`←`/`→` und Klickdrittel gespiegelt; bei Manga laut ComicInfo nur für dieses Buch) |
| `1` `2` `3` `4` | Fit width / Fit height / Fit page / Full size (auch `Ctrl/⌘ + 0`) |
| `W` / `Shift+W` | nächster / vorheriger Zoom-Modus |
| `+` / `-`, `Ctrl/⌘ + Mausrad` | Zoom in / out (frei) |
| `Z` | Zoom-Regler zeigen |
| `R` / `L` (`Shift+R`) | rechts / links drehen |
| `T` | Toolbar immer zeigen |
| `]` / `[` | nächstes / vorheriges Buch der gefilterten Liste (in einer Serie: nächster Band) |
| `F11`, `⌘ + Ctrl + F` | Vollbild |
| `Esc` | Vollbild verlassen, sonst zurück zum Raster (an dieselbe Stelle) |

## Installation

Pakete für macOS (`.dmg`, Apple Silicon + Intel), Windows (`-setup.exe` ohne Admin-Rechte, `.msi`) und Linux
(`.deb`, `.rpm`, `.AppImage`) erscheinen unter [Releases](https://github.com/krocon/comic-commander-tauri/releases).
Sie sind noch **nicht signiert**: unter macOS die App beim ersten Start mit Rechtsklick → Öffnen starten, unter
Windows in SmartScreen „Weitere Informationen“ → „Trotzdem ausführen“. Release-Ablauf: [`docs/release.md`](docs/release.md).

Bitte Comic Commander nur mit Comics nutzen, die man haben darf: selbst gescannte eigene Bücher, DRM-frei gekaufte
oder frei lizenzierte Comics.

## Entwickeln

Voraussetzungen: Node ≥ 22.22.3, pnpm 10, Rust stable ≥ 1.93, Tauri-Voraussetzungen des OS
([Anleitung](https://v2.tauri.app/start/prerequisites/)).

```bash
pnpm install
pnpm tauri dev      # App mit Dev-Server (Port 1430)
pnpm check          # Version, Skript-Tests, Format, Lint, Tests, Build, cargo fmt/clippy/test, Lizenzhinweise
```

Weitere Befehle, Architekturregeln und Projektaufbau: [`CLAUDE.md`](CLAUDE.md),
[`docs/architecture.md`](docs/architecture.md).

## Lizenz

MIT © 2026 Marc Kronberg – siehe [`LICENSE`](LICENSE).
Das Regal ist inspiriert vom Tutorial „Create an iBook Inspired Bookshelf Mock-up“ von
[Naldz Graphics](https://naldzgraphics.net/how-to-create-an-ibook/) – danke! Lizenzen der mitgelieferten Teile (u. a. UnRAR, Font
Awesome): [`THIRD-PARTY-NOTICES.txt`](THIRD-PARTY-NOTICES.txt), nach Änderungen an Abhängigkeiten `pnpm notices`.
