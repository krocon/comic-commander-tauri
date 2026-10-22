# Comic Commander

Ein Comic-Browser für **macOS, Windows und Linux**: zeigt eine Comic-Sammlung (CBZ, CBR, CB7, CBT, PDF) als Raster aus
**Cover-Thumbnails** und öffnet die Bücher in einem eingebauten Leser.

Neuauflage des Comic-Servers *comiccommander* (Angular + NestJS) als Desktop-App mit **Tauri 2**, **Angular 22**
(zoneless, Signals) und **Rust** – in derselben Architektur wie
[files-and-folders-tauri](https://github.com/krocon/files-and-folders-tauri). Das Cover-Raster ist eine
[GuiExpert Table](https://github.com/guiexperttable/mono) im Cover-Grid-Modus.

> **Stand:** Grundgerüst (Prompt 001). Die App scannt einen Ordner rekursiv nach Comics und listet sie.
> Cover-Grid, Thumbnails und Leser folgen – Fahrplan in [`prompts/README.md`](prompts/README.md).

## Was funktioniert

- Ordner eingeben (absolut oder mit `~`), **Scan** listet alle Comics darunter in natürlicher Reihenfolge
  (`Band 2` vor `Band 10`); Symlinks, versteckte Dateien und `._*` werden übersprungen.
- Hell/Dunkel folgt dem System.

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
