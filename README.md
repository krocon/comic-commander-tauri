# Comic Commander

Ein Comic-Browser für **macOS, Windows und Linux**: zeigt eine Comic-Sammlung (CBZ, CBR, CB7, CBT, PDF) als Raster aus
**Cover-Thumbnails** und öffnet die Bücher in einem eingebauten Leser.

Neuauflage des Comic-Servers *comiccommander* (Angular + NestJS) als Desktop-App mit **Tauri 2**, **Angular 22**
(zoneless, Signals) und **Rust** – in derselben Architektur wie
[files-and-folders-tauri](https://github.com/krocon/files-and-folders-tauri). Das Cover-Raster ist eine
[GuiExpert Table](https://github.com/guiexperttable/mono) im Cover-Grid-Modus.

> **Stand:** Cover-Grid (Prompt 004). Die App zeigt die Bücher einer Kategorie als randloses Raster aus Covern mit
> Filter, Größen und Tastaturbedienung. Der Leser folgt – Fahrplan in [`prompts/README.md`](prompts/README.md).

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
- **Aktionen je Buch** (Klick, Leertaste oder Rechtsklick): mit der Standard-App öffnen, im Finder zeigen, Serie
  filtern, Pfad kopieren. Lesen folgt mit dem Leser (Prompt 005).
- **Leser** (`Enter`/Doppelklick): Einzelseite (Breite oder Höhe einpassen; hohe Seiten erst bildschirmweise
  scrollen, dann blättern) oder fortlaufend; Klick ins linke/rechte Drittel, Wischen, Schieberegler, Manga
  (rechts → links), Vollbild. Seiten kommen direkt aus dem Buch – JPEG, PNG, WebP, GIF, BMP; 7z und solide RAR
  werden einmal in den App-Cache entpackt (begrenzt auf 1 GiB, älteste zuerst weg). Die letzte Seite je Buch wird
  gemerkt (`reading-state.json`), das Grid zeigt den Lesefortschritt als Balken am Cover.
- **PDF**: Cover und Seiten, gerendert in Rust (`hayro`, ohne externe Programme); bei Scan-PDFs wird das eingebettete
  JPEG direkt gezeigt. Verschlüsselte PDFs werden nicht geöffnet.
- **Thumbnails erzeugen** (Kategorie-Menü → „Generate thumbnails…“): alle fehlenden Cover einer oder aller Kategorien
  im Hintergrund, mit Fortschritt, Restzeit, Pause und Abbruch; die Toolbar zeigt den Stand, fehlerhafte Bücher
  werden am Ende aufgelistet. Ein abgebrochener Lauf setzt beim nächsten Start fort.
- Natürliche Reihenfolge (`Band 2` vor `Band 10`), Umlaute in beiden Unicode-Formen gleich behandelt.
- Hell/Dunkel folgt dem System.

### Tastenkürzel

| Taste | Funktion |
|---|---|
| Pfeiltasten, `Home`/`End`, `Bild ↑/↓` | Cursor im Raster |
| `Enter` / Doppelklick | Buch lesen (auch PDF) |
| `Leertaste`, `Shift+F10`, Rechtsklick | Aktionen für das Buch |
| Tippen | springt in den Filter; `Esc` leert ihn |
| `Ctrl/⌘ + F` | Filter |
| `Ctrl/⌘ + Plus / Minus` | Cover größer / kleiner |
| `Ctrl/⌘ + R` | Kategorie neu scannen |
| `Ctrl/⌘ + 1 … 9` | Kategorie 1 … 9 wählen |
| Menü-Button, `↓`/`Enter` | Kategorie-Menü öffnen (`↑`/`↓`, `Enter`, `Esc`) |
| Dialog: `Ctrl/⌘ + Enter`, `Esc` | Speichern, Abbrechen; Liste: `Alt + ↑/↓` verschiebt |

**Im Leser**

| Taste | Funktion |
|---|---|
| `→` `↓` `n` `Leertaste` `Bild ↓` | weiter (hohe Seite: erst scrollen) |
| `←` `↑` `b` `Shift+Leertaste` `Bild ↑` | zurück |
| `Ctrl/⌘ + Pfeil`, `Home`/`End` | erste / letzte Seite |
| `S` / `W` / `M` | Einzelseite ⇄ fortlaufend / Breite ⇄ Höhe / Manga (`←`/`→` und Klickdrittel gespiegelt) |
| `]` / `[` | nächstes / vorheriges Buch der gefilterten Liste |
| `F11`, `⌘ + Ctrl + F` | Vollbild |
| `Esc` | Vollbild verlassen, sonst zurück zum Raster (an dieselbe Stelle) |

## Entwickeln

Voraussetzungen: Node ≥ 22.22.3, pnpm 10, Rust stable ≥ 1.93, Tauri-Voraussetzungen des OS
([Anleitung](https://v2.tauri.app/start/prerequisites/)).

```bash
pnpm install
pnpm tauri dev      # App mit Dev-Server (Port 1430)
pnpm check          # Format, Lint, Tests, Build, cargo fmt/clippy/test
```

Weitere Befehle, Architekturregeln und Projektaufbau: [`CLAUDE.md`](CLAUDE.md),
[`docs/architecture.md`](docs/architecture.md).

## Lizenz

MIT © 2026 Marc Kronberg – siehe [`LICENSE`](LICENSE).
