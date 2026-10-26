# Distribution – Comic Commander

> Prompt `prompts/014-distribution.md` (26.10.2026). Inhalt: ein Prompt für Claude im Browser, der Comic Commander bei
> Paketmanagern, Verzeichnissen und Discovery-Plattformen einträgt, dazu Fakten, Texte und Manifeste, die er nutzt.
> Stand: Release **v1.0.1** (25.10.2026, unsigniert).

## Dateien

| Datei | Zweck |
|---|---|
| [`browser-agent-prompt.md`](browser-agent-prompt.md) | **Der Prompt** – Abschnitt zwischen „PROMPT BEGINNT/ENDET“ in Claude (Browser) kopieren |
| [`facts.json`](facts.json) | einzige Quelle der Fakten: Version, URLs, SHA-256, OS, Paketdetails, Unbekanntes |
| [`listing.md`](listing.md) | Texte EN/DE (Tagline, kurz, lang), Kategorien, Tags, Show-HN-Entwurf |
| `manifests/winget/…/1.0.1/` | WinGet: version, installer (NSIS user + MSI machine), locale en-US |
| `manifests/scoop/comic-commander.json` | Scoop (Extras oder eigener Bucket), NSIS als 7z entpackt, `checkver`/`autoupdate` |
| `manifests/homebrew/comic-commander.rb` | Homebrew Cask – **offizieller Tap blockiert** bis Signierung + Notarisierung |
| `manifests/chocolatey/comic-commander/` | Chocolatey: `.nuspec` + `tools/chocolateyinstall.ps1` (MSI) |
| `manifests/aur/comic-commander-bin/` | AUR: `PKGBUILD` + `.SRCINFO` aus dem .deb |
| `manifests/appimagehub/ComicCommander` | AppImageHub: Datei für `data/` in `AppImage/appimage.github.io` |
| `manifests/flathub/` | Flatpak-Manifest (Entwurf aus dem .deb, nur lokal testen) + AppStream-`metainfo.xml` |
| `manifests/snap/snapcraft.yaml` | Snap (Entwurf aus dem .deb, ungetestet) |

Der Browser-Agent liest die Dateien auf GitHub → **`distribution/` muss auf `main` gepusht sein**, bevor der Prompt
läuft.

## Woher die Werte kommen (geprüft am 26.10.2026)

- Version, Asset-Namen, Größen, SHA-256: GitHub-Release-API für `v1.0.1`; Pakete heruntergeladen und die Summen
  lokal nachgerechnet (alle gleich).
- Aus den Paketen gelesen: Linux-Binary `/usr/bin/comic-commander-tauri`, Desktop-Datei `Comic Commander.desktop`
  (`Categories=Graphics;`), Icon-Name `comic-commander-tauri`, deb-Abhängigkeiten; Windows-Exe
  `comic-commander-tauri.exe` (MSI und NSIS), MSI-`ProductCode` `{FA2852D9-…}`, `UpgradeCode` `{7F69796D-…}`,
  `ALLUSERS=1`.
- Features, Plattformen, Hinweise: Produktseite https://krocon.de/products/comiccommander/.
- LICENSE am Tag `v1.0.1`: SHA-256 `786cdc49…` (im PKGBUILD).

## Einschätzung (Kurzfassung der Recherche)

| Sofort möglich (Browser) | Vorbereitet, braucht Marc | Blockiert / ungeeignet |
|---|---|---|
| WinGet (PR), Scoop Extras (PR), AppImageHub (PR), AlternativeTo, Softpedia, FileHorse, awesome-tauri u. a. Listen | AUR (SSH-Push), Chocolatey (choco push), Flathub (Build aus Quellen, lokal testen), Snap (snapcraft), Show HN / Product Hunt / Reddit (Posts in Marcs Namen) | Homebrew Cask offiziell, Microsoft Store (beide: Signierung); Debian/Fedora (unRAR nicht frei); MacPorts (Source-Build); Mac App Store (Sandbox) |

Die größten Hebel für mehr Kanäle: **macOS signieren + notarisieren** (öffnet Homebrew Cask) und **Windows signieren**
(Microsoft Store, weniger SmartScreen-Warnungen) – vorbereitet in `docs/release.md`.

## Befunde für das nächste Release

- GitHub-Repo: **Description, Website und Topics sind leer** – vor den Verzeichnis-Einträgen setzen (der Prompt fragt
  danach, Freigabe A).
- Linux-Desktop-Datei: `Categories=Graphics;` – besser `Graphics;Viewer;`; AppStream-`metainfo.xml` fehlt im .deb/
  AppImage (Software-Center, AppImageHub, Flathub lesen sie). Vorlage: `manifests/flathub/…metainfo.xml`.
- `Comic.Commander_universal.app.tar.gz` hat keine Version im Namen – für Paketmanager ungeeignet (die Manifeste
  nutzen das `.dmg`).
- Lizenzangabe: App MIT; enthält unRAR-Quellen (freeware, nicht OSI). Bei Linux-Distributionen der Grund für
  „ungeeignet“; in Katalogen „MIT“ angeben, Drittteile über `THIRD-PARTY-NOTICES.txt`.

## Neues Release – was anpassen

1. `facts.json`: `version`, `releaseTag`, `releaseDate`, `assets[].url/sha256/size` (Release-Seite zeigt je Asset
   `sha256:`; oder `gh api repos/krocon/comic-commander-tauri/releases/latest`).
2. Manifeste: winget (neuer Ordner `…/X.Y.Z/`, Summen in GROSSBUCHSTABEN, MSI-ProductCode neu auslesen), Scoop
   (`version`, `hash`; danach erledigt `autoupdate` das), Cask (`version`, `sha256`), Chocolatey (`version`, URL,
   Summe), AUR (`pkgver`, Summen, `.SRCINFO` per `makepkg --printsrcinfo`), metainfo (`<release>`), Flatpak/Snap.
3. Bei winget/Scoop/Chocolatey übernehmen nach der ersten Aufnahme meist Bots die Updates – im Bericht vermerken.
