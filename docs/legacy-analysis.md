# Analyse der Vorlage: comiccommander (Angular 22 + NestJS, 2025/26)

> Fachliche Vorlage für Comic Commander (Tauri). Quelle: `~/WebstormProjects/comiccommander` (Version 1.0.13,
> pnpm-Monorepo `apps/api` NestJS, `apps/frontend` Angular 22 mit Material, `libs/config`, `libs/data`, Docker für
> Unraid/macOS). Verweise in Prompts und Code: **„legacy §N“**. Stand der Analyse: 22.10.2026.
>
> Die Vorlage ist ein **Comic-Server** (Browser ↔ Node-API über HTTP). Die Neuauflage ist eine **Desktop-App**:
> kein HTTP-Server, kein Port, keine Docker-Konfiguration – die Funktionen werden zu Tauri-Commands, Jobs und einem
> eigenen URI-Schema für Bilder.

---

## §1 Überblick

| Bereich | Vorlage | Neuauflage |
|---|---|---|
| Kategorien | aus `config.json` (je `baseDir`, Endungen, Titel, Icon, Thumb-Größen), nur beim Serverstart gelesen | dasselbe Modell, **zur Laufzeit** in der App verwaltet, alte `config.json` importierbar (Prompt 002) |
| Liste | rekursiver Scan, Cache `files.json` **im Comic-Ordner** | Scan in Rust, Cache im App-Cache-Ordner (002) |
| Cover | Thumbnail-JPGs **neben** dem Buch (`Band.jpg`, `Band_xl.jpg`), erzeugt per `sharp` | Cover-Cache in Rust, alte Sidecars werden gelesen (003) |
| Übersicht | GuiExpert `CoverGrid` mit Angular-Renderer, Filter, Thumb-Größe, Scrollposition | GuiExpert Cover-Grid, Signals, Renderer ohne Angular (004) |
| Lesen | ganzes Archiv per `unar` in `tempDir/<md5>` entpacken, JPGs als statische Dateien | Seiten direkt aus dem Archiv über ein URI-Schema (005) |
| Formate | `.cbz`, `.cbr` (konfigurierbar), Werkzeuge `unar`/`lsar`, `7z`, `node-unrar-js` | CBZ, CBR, CB7, CBT, PDF in Rust (003, 006) |
| Thumbs erzeugen | Hintergrundlauf mit SSE-Fortschritt, 4 parallel | Job mit Fortschritt/Abbruch (007) |
| Duplikate | SHA-256 je Datei → Map | übernommen + pHash aus files-and-folders (010) |

## §2 Konfiguration (`apps/api/src/assets/config*.json`, `libs/config`)

```json
{
  "port": 3333,
  "tempDir": "/Users/marckronberg/Temp.nosync",
  "categories": [{
    "apiUrl": "/api/files/0",
    "baseDir": "/Users/…/comics.nosync",
    "bookExtensions": [".cbz", ".cbr"],
    "title": "Comics",
    "icon": "stars",
    "thumbsDims": [
      { "width": 200, "height": 300, "nameExtension": "" },
      { "width": 800, "height": 1200, "nameExtension": "_xl" }
    ],
    "dimIndex": 1,
    "initialFilter": ""
  }]
}
```

- `CategoryIf`: `apiUrl`, `baseDir`, `bookExtensions`, `title`, `icon` (Material-Icon-Name), `thumbsDims[]`,
  `dimIndex` (Default-Größe), `initialFilter` (Filtertext beim ersten Öffnen).
- `ThumbsDimIf { width, height, nameExtension }` – `nameExtension` ist das Suffix der Thumbnail-Datei
  (`""` → `Band.jpg`, `"_xl"` → `Band_xl.jpg`).
- `ConfigIf` zusätzlich (nur Client): `selectedCategoryIndex`, `scrollOffset`.
- Konfigurationspfad über `CONFIG_PATH`/`CONFIG_URL`, Varianten für macOS, Windows, Unraid.
- Marcs produktive Konfiguration (macOS, Stand 22.10.2026) hat **zwei** Kategorien: „Comics“
  (`…/_done/comics.nosync`, `.cbz`/`.cbr`, 584 Bücher) und „Make“ (`…/_done/ct Make`, nur `.pdf` – Zeitschriften).
  Beide mit `thumbsDims` 200×300 (`""`) und 800×1200 (`"_xl"`), `dimIndex` 1, Icon `stars`. Endungen sind also
  **je Kategorie** verschieden; PDF ist ein echter Anwendungsfall (die Vorlage konnte davon aber keine Cover
  erzeugen, legacy §10.6).

## §3 Kategorie scannen (`file-util.service.ts`, `file-controller.ts`)

- `GET /api/files/:catIndex` → `readDirsCached(baseDir, bookExtensions)` → `string[]` relativer Pfade, beginnend
  mit `/`, Separator `/`, **sortiert** (`.sort()`, also Code-Point-Reihenfolge, nicht natürlich).
- Rekursiv, bis zu 10 Ordner parallel, **Symlinks werden aufgelöst** (Ordner und Dateien, kaputte ignoriert –
  kein Zyklusschutz!), Endung exakt (`path.extname` mit Groß-/Kleinschreibung aus der Konfiguration).
- Nicht lesbare Ordner werden geloggt und übersprungen.
- **Cache:** `files.json` im `baseDir` der Kategorie. Liegt er vor, wird er sofort geliefert und im Hintergrund
  neu gescannt (stale-while-revalidate); ein laufender Scan je Ordner wird geteilt; Schreiben atomar (Temp + move);
  kaputter Cache wird gelöscht und neu gescannt.

## §4 Cover und Thumbnails (`thumbs.service.ts`, `archive.service.ts`, `image.service.ts`)

- **Cover-Wahl** (`getCoverFileName`): nur Bilder `jpg|jpeg|png|webp`; Sortierung: Name enthält `cover.` zuerst,
  dann **weniger Pfadtrenner** (flachere Ebene) zuerst, dann `localeCompare` ohne Groß-/Kleinschreibung.
- Archiv lesen: wenn `/usr/bin/7z` vorhanden → alles mit 7z (`7z l -ba -slt`, `7z e … -so`), sonst `.cbr` mit
  `node-unrar-js` (Fallback 7z, weil manche `.cbr` eigentlich ZIP sind), sonst `7zip-bin`. Timeout 30 s.
  Passwort `-p-` (= keins, nie nachfragen).
- **Thumbnail:** `sharp` → `resize(width, height, fit: inside, withoutEnlargement)` → JPEG Qualität 80.
- **Ablage:** neben dem Buch: `<pfad ohne Endung><nameExtension>.jpg`. Der Client probiert der Reihe nach:
  1. `<name><ext>.jpg` = `Band<nameExt>.jpg`
  2. `Band.cbz<nameExt>.jpg`
  3. `<ordner>/.Panels/thumbnails/Band<nameExt>.jpg`
  4. `<ordner>/.Panels/thumbnails/Band.cbz<nameExt>.jpg`
  5. `/assets/empty.gif` (und merkt sich das Buch als „Thumbnail fehlt“).
  (`.Panels` stammt von der iPad-App „Panels“.)
- „Fehlende Thumbs“ = Buch, für das mindestens eine `thumbsDim` keine Datei hat (Vergleich über die Dateiliste).

## §5 Thumbnails erzeugen (`thumbs.controller.ts`, `cc-generate-thumbs`)

- `GET /api/thumbs/generate/missing/:catIndex` (eine Kategorie, sequenziell),
  `GET /api/thumbs/generate/start` (alle Kategorien im Hintergrund), `SSE /api/thumbs/generate/progress`.
- Ablauf: erst alle fehlenden zählen (Gesamtzahl), dann in Blöcken zu **4 parallel**; nur ein Lauf gleichzeitig.
- Fortschritt `GenerateThumbsProgress { total, processed, currentFile?, errorCount, skippedCount, isCompleted,
  generatedPaths[], percent, elapsedTime, remainingTime }` – Zeiten `hh:mm:ss`, Restzeit linear geschätzt.
  „Übersprungen“ = kein Bild im Archiv.
- UI: Seite „Generate Thumbnails“ mit Start-Knopf, Fortschrittsbalken (unbestimmt während des Zählens), Statistik,
  aktuelle Datei, Abschlussmeldung „N thumbnails were generated“.

## §6 Übersicht (`cc-overview.component.*`, `cc-thumb-renderer.*`)

- Route `/cat/:index`; GuiExpert **`CoverGridFactory.createCoverGridModel(files, renderer, w, h, width,
  paddingTop)`** mit Angular-Komponente als Renderer (`RenderWrapperFactory`), Optionen ohne Ränder/Hover,
  `defaultRowHeights.body = thumb height`, `autoRestoreOptions` (Scrollposition, Schlüssel `comicCommanderGrid`).
- Fensterbreite → `setParentWidth` + `recalcHeightAndPadding` + `repaintHard` (bei `window:resize`).
- **Thumb-Größe** wählbar (Select mit den `thumbsDims` der Kategorie), je Kategorie gespeichert.
- **Filter** (Eingabefeld unten, 333 ms entprellt, je Kategorie in `localStorage` gespeichert; Label zeigt
  „gefiltert / gesamt“): Wörter durch Leerzeichen; `+wort` = muss enthalten sein, `-wort` = darf nicht, übrige
  Wörter = ODER; alles ohne Groß-/Kleinschreibung auf dem relativen Pfad.
- **Serie filtern** (`extractSeriesFilter`): Name ohne Endung und Pfad, alles vor der ersten Zahl/` -`/` (`/`_<zahl>`,
  jedes Wort als `+wort`. Beispiele: `Im roten Bereich 01 - Carrera (…)` → `+Im +roten +Bereich`,
  `Neptun_01_-_Episode_1_(2022)…` → `+Neptun`.
- Klick aufs Cover → Overlay mit **View**, **Download** (Datei im Browser öffnen), **Filter Series**, **Cancel**.
- Knöpfe „nach oben“/„nach unten“; Toolbar wird beim Scrollen (> 64 px) transparent, beim Hover sichtbar.
- Scrollposition in der URL (`?scroll=`), damit „Zurück“ aus dem Leser an dieselbe Stelle führt.

## §7 Leser (`cc-single-view.*`, `viewer-controller.ts`)

- `POST /api/view/new` entpackt das ganze Buch mit `unar` nach `tempDir/<md5(pfad) base64url>` (erst in
  `<hash>.tmp`, dann umbenannt); `POST /api/view/hash` liefert den Hash; `GET /api/view/read/:hash` listet die
  JPG/JPEG-Dateien sortiert (`.sort()`). Der Client fragt alle 888 ms, bis ≥ 4 Seiten da sind. PNG/WebP-Seiten
  werden im Leser **nicht** gezeigt (Lücke der Vorlage).
- Zwei Modi (in `localStorage` gespeichert):
  - **Einzelseite** (`S` schaltet): ein Bild, Breite voll oder Höhe voll (`W` schaltet); Klick ins linke Drittel =
    zurück, rechtes Drittel = weiter; innerhalb einer hohen Seite wird erst bildschirmweise gescrollt, dann
    geblättert; Seite in der URL (`?page=`).
  - **Fortlaufend**: alle Seiten untereinander (virtuelles Scrollen), Klick links/rechts scrollt eine
    Bildschirmhöhe; Position in der URL (`?scroll=`).
- Tasten: `←`/`↑`/`b` zurück, `→`/`↓`/`n` weiter, mit `Meta` an den Anfang/ans Ende; `s`, `w`.
- Touch: Wischen horizontal (`touch.directive.ts`).
- Knöpfe: Modus, Breite, „Zurück zur Übersicht“ (stellt Kategorie und Scrollposition wieder her).
- Temp-Ordner werden nie aufgeräumt (Lücke).

## §8 Duplikate (`duplicates.service.ts`, `hash.service.ts`)

- SHA-256 über die ganze Datei, 5 parallel, Ergebnis `Map<hash, relPfad[]>`. Keine UI in der Vorlage; TODO im Code:
  „Funktion anbieten, um doppelte Files zu löschen (cbt/cbz -01/-1)“.

## §9 Oberfläche allgemein

- Angular Material (Toolbar, Menü, Select, Tooltip, Icons), dunkles Theme als Default.
- Menü: Welcome, je Kategorie ein Eintrag (Icon + Titel), „Generate Thumbs…“.
- Welcome-Seite: Titel „Comic Commander – The free comic server!“, Knöpfe je Kategorie, Version.

## §10 Lücken und Abweichungen der Vorlage (für die Neuauflage)

1. Symlink-Zyklen beim Scan nicht abgefangen (§3) → Neuauflage folgt keinen Links bzw. nur mit Besucht-Menge.
2. Cache und Thumbnails werden **in die Comic-Ordner** geschrieben (§3, §4) – für eine Desktop-App unerwünscht
   (fremde/schreibgeschützte Laufwerke, iCloud). Neuauflage: App-Cache; alte Sidecars nur lesen (Option: schreiben).
3. Externe Programme (`unar`, `7z`) per Shell-String mit selbst gebautem Quoting → Neuauflage: alles in Rust, kein
   Shell-Aufruf.
4. Leser entpackt das ganze Buch auf Platte, kein Aufräumen, nur JPG (§7) → Neuauflage: Seiten einzeln aus dem
   Archiv, alle Bildformate, begrenzter Cache.
5. Sortierung Code-Point statt natürlich (§3, §7: `Seite 10` vor `Seite 2`) → natürliche Sortierung.
6. Kein PDF (Endungen frei konfigurierbar, aber Cover/Leser können nur Archive) → PDF in Prompt 006.
7. Keine Tastaturbedienung der Übersicht, kein Fokus/ARIA → Neuauflage barrierearm.
