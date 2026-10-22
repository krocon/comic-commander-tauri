# Comic Commander

Ein Comic-Browser für **macOS, Windows und Linux**: zeigt eine Comic-Sammlung (CBZ, CBR, CB7, CBT, PDF) als Raster aus
**Cover-Thumbnails** und öffnet die Bücher in einem eingebauten Leser.

Neuauflage des Comic-Servers *comiccommander* (Angular + NestJS) als Desktop-App mit **Tauri 2**, **Angular 22**
(zoneless, Signals) und **Rust** – in derselben Architektur wie
[files-and-folders-tauri](https://github.com/krocon/files-and-folders-tauri). Das Cover-Raster ist eine
[GuiExpert Table](https://github.com/guiexperttable/mono) im Cover-Grid-Modus.

> **Stand:** Kategorien und Scan (Prompt 002). Die App verwaltet Kategorien, scannt sie rekursiv und listet die
> Bücher. Cover-Grid, Thumbnails und Leser folgen – Fahrplan in [`prompts/README.md`](prompts/README.md).

## Was funktioniert

- **Kategorien** wie im alten Comic Commander: je Kategorie ein Ordner (`baseDir`), die Dateitypen
  (`.cbz .cbr .cb7 .cbt .pdf .zip .rar .7z .tar`), Titel, Icon, Thumbnail-Größen und Anfangsfilter – zur Laufzeit im
  Dialog „Manage categories“ anlegen, ändern, sortieren, entfernen; Ordner über den nativen Dialog wählen.
- **Import der alten `config.json`** mit Vorschau (fehlende Ordner, Duplikate, nicht unterstützte Typen werden
  angezeigt).
- **Scan** rekursiv in Rust; beim nächsten Öffnen erscheint die Liste sofort aus dem Cache und wird im Hintergrund
  aktualisiert. Nichts wird in die Comic-Ordner geschrieben. Ist ein Ordner nicht erreichbar, bleibt der letzte
  Stand sichtbar.
- Natürliche Reihenfolge (`Band 2` vor `Band 10`), Umlaute in beiden Unicode-Formen gleich behandelt.
- Hell/Dunkel folgt dem System.

### Tastenkürzel

| Taste | Funktion |
|---|---|
| `Ctrl/⌘ + R` | Kategorie neu scannen |
| `Ctrl/⌘ + 1 … 9` | Kategorie 1 … 9 wählen |
| Menü-Button, `↓`/`Enter` | Kategorie-Menü öffnen (`↑`/`↓`, `Enter`, `Esc`) |
| Dialog: `Ctrl/⌘ + Enter`, `Esc` | Speichern, Abbrechen; Liste: `Alt + ↑/↓` verschiebt |

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
