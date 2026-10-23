# Design 014 – Zoom, Drehen und Leser-Toolbar

> Status: **Entwurf – wartet auf Freigabe** · 23.10.2026 · Branch `feat/zoom-drehen` · Auftrag:
> [`014-zoom-modi.md`](014-zoom-modi.md) · baut auf 005 (E2 Seitenbreiten, E5 Lesestand, E10 Einstellungen), 006 (PDF)
> und 008 (Aktionen, Keymaps, Menü) auf. Vorgabe Marc (23.10.): **E10 = vier sichtbare Icons, wenn der Platz reicht.**

## Entscheidungen auf einen Blick

| Nr. | Frage | Empfehlung |
|---|---|---|
| E1 | Tasten | `1` Fit width · `2` Fit height · `3` Fit page · `4` Full size · `Mod+0` Full size (Vorschau/Browser „Originalgröße“) · `W` / `Shift+W` Modi vor/zurück · `+` / `=` / `-` Zoom in/out · `Z` Zoom-Regler · `R` / `L` (auch `Shift+R`) drehen rechts/links · `T` Toolbar fest. **Keine** Mod-Akkorde, die global schon belegt sind (`Mod+=`/`Mod+-` = Covergröße, `Mod+1…9` = Kategorie, `Mod+R` = neu scannen): auf macOS liegen sie im nativen Menü – zwei Einträge mit demselben Kürzel wären unzuverlässig. Strg/Cmd+Mausrad und Pinch zoomen zusätzlich (Element-Ereignis `wheel`, kein `keydown`) |
| E2 | Fit height bei Querformat | **echtes Fit height**: Seite so hoch wie die Ansicht, breite Seiten werden **horizontal gescrollt**. „Ganze Seite sehen“ ist jetzt Fit page – das heutige `min(viewWidth, …)` wandert dorthin |
| E3 | Full size | **1 Bildpixel = 1 CSS-Pixel** (wie Browser und Vorschau „Originalgröße“; der Regler zeigt 100 %). Auf Retina wird ein 2000-px-Scan damit 2× hochskaliert – wer Gerätepixel will, stellt 50 % ein. URL immer mit Breite `0` (Original) |
| E4 | Klick/Wischen bei gezoomter Seite | Klick ins linke/rechte Drittel **bleibt „ein Schritt“** – der Schritt scrollt zuerst durch die Seite (Z-Reihenfolge, s. u.), erst am Ende wird geblättert. Ist die Seite breiter als die Ansicht, **verschiebt Ziehen mit der Maus** die Seite (Hand-Werkzeug), Wischen blättert dann nicht. Ohne horizontalen Überlauf bleibt Wischen wie in 005 |
| E5 | Zoom global oder je Buch | **Zoom global** (Leser-Einstellungen, `localStorage` wie 005 E10, mit 009 nach Rust). **Drehung je Buch** im Lesestand `reading-state.json` (gescannte Querformat-Bücher bleiben gedreht, andere nicht) |
| E6 | Datenmodell freier Zoom | `zoom: { mode: 'width' \| 'height' \| 'page' \| 'full' \| 'custom', factor: number }` – `custom` ist ein **fünfter Modus**; `factor` zählt nur bei `custom` (Bildbreite × factor = CSS-Breite). Ziehen am Regler, `+`/`-`, Mausrad → `custom`; einer der vier Modi verlässt `custom` |
| E7 | Ort und Skala des Zoom-Reglers | **In der Toolbar** rechts neben der Zoom-Gruppe, nur wenn „Show zoom slider“ an ist; **10 %–800 %, logarithmisch**, Rasten bei 100 % und beim Wert des zuletzt aktiven Fit-Modus (±3 %); Prozentzahl daneben (`tabular-nums`). Der Regler zeigt immer den **effektiven** Faktor der aktuellen Seite (Fit page bei 1200 px → z. B. 37 %) |
| E8 | Drehung je Buch oder je Seite | **je Buch** (alle Seiten). Einzelne quer gescannte Seiten sind selten und mit Fit page gut lesbar; je Seite wäre viel Zustand für wenig Nutzen → Folge-Idee |
| E9 | Drehen in CSS oder in Rust | **CSS im Frontend** (`rotate` auf dem Bild in einer Box mit getauschten Maßen): sofort, keine neue URL-Variante, Seiten-Cache und Vorausladen bleiben gültig, keine Rust-Bildarbeit. Schärfe ist gleich, weil die angefragte Breite aus den **ungedrehten** Bildmaßen berechnet wird |
| E10 | Zoom-Bedienung | **Vorgabe Marc:** vier sichtbare Icons (Segment-Gruppe), wenn der Platz reicht; in einer schmalen Toolbar (Container-Query auf `.bar`) **ein Icon mit Aufklapp-Menü** nach APG (`menuitemradio`). Beides im DOM, CSS blendet um – kein JS-Messen, Tab-Reihenfolge bleibt korrekt (`display: none` fällt heraus) |
| E11 | Ein-/Ausblenden der Toolbar | **Einblenden nur über die Hot-Zone oben** (Leistenhöhe + 16 px) oder per Tastatur/Fokus; Ausblenden nach `BAR_IDLE_MS` (2,5 s bleibt) ohne Maus über der Leiste. Mauszeiger über der Seite blendet nach derselben Ruhezeit aus (gibt es schon, `.idle .view { cursor: none }`) und erscheint bei Bewegung sofort – **ohne** die Leiste zu holen. Übergänge: ein 150 ms, aus 400 ms (`ease-out`), `prefers-reduced-motion`: ohne |

## Bestand

| Baustein | wofür | Stand |
|---|---|---|
| `reader-logic.ts` `ReaderFit`, `layoutPages(aspects, w, h, fit)` | Boxen fortlaufend | **erweitern**: Zoom + Drehung, Breite > Ansicht erlaubt, `maxWidth` |
| `reader-logic.ts` `widthBucket(w, h, dpr)` | eine Zielbreite für alle Seiten (`max(w,h)×dpr`) | **ersetzen** durch Breite je Seite aus der Box (`pageWidth`) – Fit height breiter Seiten und Zoom > 100 % brauchen mehr als `max(w,h)` |
| `reader-logic.ts` `step()` | erst scrollen, dann blättern (nur vertikal) | **erweitern** zu `step2d()` (Z-Reihenfolge, Manga) |
| `reader-logic.ts` `aspects()` | Seitenverhältnis unbekannter Seiten raten | **erweitern** zu `guessSizes()` (Full size/custom brauchen Pixel, nicht nur Verhältnis) |
| Einzelseite: CSS `.single img { width:100% }` / `.fit-height` | Fit per CSS | **ersetzen**: Box in px aus derselben Funktion wie fortlaufend (eine Wahrheit, Drehung, Zoom); Zentrieren mit `margin: auto` bleibt (überlaufende Seite erreichbar) |
| `reader-settings.ts` (`localStorage` `cc.reader`, v1) | mode, fit, rtl | **erweitern**: `zoom`, `zoomSlider`, `toolbarPinned`; altes `fit` wird gelesen (Migration) |
| `ReaderStore.fit`, `toggleFit()` | | **ersetzen** durch `zoom`, `setZoomMode`, `cycleZoom`, `zoomBy`, `setFactor`, `rotation`, `rotate` |
| Aktion `reader.toggleFit` (`w`), Menü „Fit width / height“ | | **ersetzen** (neue Aktionen unten); `keymap.json`-Overrides mit der alten Id werden schon heute nachsichtig ignoriert (008) |
| Toolbar `header.bar`, `wake()`, `idle`, `overBar` | schwebt, blendet nach 2,5 s aus; **jede** Mausbewegung holt sie | **ändern**: Hot-Zone (E11), dezente Icons, Gruppen, Container-Query |
| `reading_state.rs` `ReadingPosition { page, pages, updatedMs }` | Lesestand je Buch | **erweitern** um `rotation` (serde default 0) |
| Command `save_reading_position`, `OpenedBook.lastPage` | | **erweitern** um `rotation` |
| `CategoryMenu` (APG-Menü-Button) | Vorlage für das Zoom-Menü in schmaler Toolbar | **Muster übernehmen** |
| Font Awesome 4.5 | Icons | vorhanden: `fa-arrows-h`, `fa-arrows-v`, `fa-file-o`, `fa-search`, `fa-rotate-left`, `fa-rotate-right` – „1:1“ als Text-Icon |
| Vorlage comiccommander | – | kannte nur Breite/Höhe (legacy §7); alles Weitere ist neu |

## Verträge

### Rust (Phase 2, klein)

- `ReadingPosition { page, pages, updatedMs, rotation }` – `rotation: u16` mit `#[serde(default)]`; beim Laden
  alles außer 0/90/180/270 → 0. Alte Dateien bleiben lesbar (keine Versionsänderung nötig).
- `ReadingState::set(book_id, page, pages, rotation, now)` – `rotation` ungültig → 0; „nichts geändert“ zählt jetzt
  Seite **und** Drehung.
- Command `save_reading_position(categoryId, bookId, page, pages, rotation)` – `rotation` neu (Pflicht im Frontend,
  Rust nimmt fehlend als 0). Keine neuen Fehlercodes.
- `OpenedBook` bekommt `rotation: u16` (aus dem Lesestand, sonst 0). `load_reading_state` liefert `rotation` mit.
- `ccpage`-URLs **unverändert** (E9).

### TypeScript

```ts
// reader-logic.ts
export type ZoomMode = 'width' | 'height' | 'page' | 'full' | 'custom';
export interface Zoom { mode: ZoomMode; factor: number }        // factor nur bei custom
export type Rotation = 0 | 90 | 180 | 270;
export const ZOOM_MIN = 0.1, ZOOM_MAX = 8;
export const ZOOM_CYCLE: ZoomMode[] = ['width', 'height', 'page', 'full'];

/** CSS-Größe einer Seite: Bild (ungedreht) und Box (gedreht, das, was Platz braucht). */
export interface PageFit { imgWidth: number; imgHeight: number; width: number; height: number; scale: number }
export function fitPage(nat: Size, rot: Rotation, zoom: Zoom, viewW: number, viewH: number): PageFit;
export function guessSizes(sizes: (Size | null)[]): Size[];      // ersetzt aspects()
export function layoutPages(sizes: Size[], viewW, viewH, zoom, rot):
  { boxes: (PageBox & PageFit)[]; total: number; maxWidth: number };
export function pageWidth(fit: PageFit, dpr: number, zoom: Zoom): number; // Stufe aus PAGE_WIDTHS, 0 = Original
export function step2d(dir: 1 | -1, pos: ScrollPos, view: Size, content: Size, rtl: boolean): Step2d;
export function zoomAround(old: ScrollPos, point: Point, k: number): ScrollPos; // Punkt bleibt stehen
export function sliderToFactor(v: number): number; export function factorToSlider(f: number): number; // log, 0…1000
export function snapFactor(f: number, snaps: number[]): number;
export function nextZoom(z: Zoom, dir: 1 | -1): Zoom; export function zoomStep(f: number, dir: 1 | -1): number;
```

`fitPage` rechnet mit den gedrehten Maßen `(w, h) = rot % 180 ? (natH, natW) : (natW, natH)`:
`width → viewW / w`, `height → viewH / h`, `page → min(viewW / w, viewH / h)`, `full → 1`,
`custom → factor` (geklemmt auf `ZOOM_MIN…ZOOM_MAX`). Unbekannte Größe → `guessSizes` (nächste bekannte Seite, sonst
1000 × 1500).

`pageWidth`: `full` → 0; sonst `imgWidth × dpr` auf die nächste Stufe von `PAGE_WIDTHS` aufgerundet, darüber 0. Damit
fragt Fit height einer Doppelseite genug Pixel an; kleine Fensteränderungen behalten die URL (Stufen).

`step2d` (Z-Reihenfolge, ein Bildschirm abzüglich 10 % Überlappung wie `OVERLAP`): vorwärts erst horizontal in
Leserichtung (Manga: nach links), am Zeilenende zurück an den Zeilenanfang und eine Bildschirmhöhe nach unten, ganz
am Ende `page`. Rückwärts spiegelbildlich (Ende der vorigen Zeile). Ohne horizontalen Überlauf = heutiges `step()`.

### Leser-Einstellungen (`localStorage` `cc.reader`, `v: 1` bleibt)

```json
{ "v": 1, "mode": "single", "zoom": { "mode": "page", "factor": 1 }, "rtl": false,
  "zoomSlider": false, "toolbarPinned": false }
```

Laden nachsichtig: fehlt `zoom`, gilt das alte `fit` (`'height'` → height, sonst width); unbekannter Modus → width;
Faktor geklemmt; sonst Default `{ mode: 'width', factor: 1 }`.

### Aktionen (Kontext `reader`) und Tasten

| Id | Text | Tasten (alle OS) | Menü |
|---|---|---|---|
| `reader.zoom.width` | Fit width | `1` | Read › Zoom (radio) |
| `reader.zoom.height` | Fit height | `2` | radio |
| `reader.zoom.page` | Fit page | `3` | radio |
| `reader.zoom.full` | Full size | `4`, `Mod+0` | radio |
| `reader.zoom.next` / `.prev` | Next / previous zoom mode | `w` / `Shift+w` | – (Palette) |
| `reader.zoomIn` / `reader.zoomOut` | Zoom in / out | `+`, `=` / `-` (repeat) | Read › Zoom |
| `reader.toggleZoomSlider` | Show zoom slider | `z` | Read › Zoom (check) |
| `reader.rotateLeft` / `reader.rotateRight` | Rotate left / right | `l`, `Shift+r` / `r` | Read |
| `reader.toggleToolbar` | Always show toolbar | `t` | Read (check) |

`reader.toggleFit` entfällt. Tooltips/Menüs zeigen das Kürzel aus der Keymap (`shortcut.ts`), nicht hart codiert.
Native Menüs (macOS) zeigen nur `Mod+0` als Accelerator (CLAUDE.md §4: nur mit Modifier).

## Frontend

### Toolbar (Skizze, breite Ansicht)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ←  Hägar 01  [════●═════════] 12/48   ⏮ ⏭  │ ▣  │ ↔ ↕ ▯ 1:1  🔍 [──●────] 140 %  │ ⟲ ⟳ │ ⇄ ⛶ │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
  Gruppen:  Navigation          Bücher       Modus  Zoom (role=group)  Regler (nur wenn an)  Drehen  Manga/Vollbild
schmal (< ~900 px Leistenbreite):  ↔ ▾  statt ↔ ↕ ▯ 1:1   ·  sehr schmal (< ~640 px): Regler und Titel weg
```

- Fokus-Reihenfolge = Lesereihenfolge oben; Fokusfalle des Dialogs bleibt (`trapFocus`).
- **Dezent** (Anforderung 18): `.btn.icon` im Leser ohne Rahmen/Hintergrund, Farbe `--color-reader-icon`
  (neues Token: `--color-reader-text` mit ~70 % Deckkraft, light und dark), Hover/Fokus volle Deckkraft + leichter
  Hintergrund `--color-reader-icon-hover`; aktiv (`aria-pressed="true"`) = Icon in `--color-accent` + 2 px
  Unterstrich statt gefüllter Fläche. Fokusring bleibt `--color-focus`. Kontrast der Icons ≥ 3:1 auf
  `--color-toolbar-overlay` (beide Schemata prüfen).
- Zoom-Gruppe: `<div role="group" aria-label="Zoom">` mit vier Knöpfen (`aria-pressed`), Tooltip „Fit page (3)“.
  Schmale Variante: Menü-Button (`aria-haspopup="menu"`, `aria-expanded`), Menü mit `menuitemradio` + `aria-checked`,
  Pfeiltasten/Home/End/Esc nach APG wie `CategoryMenu`.
- Regler: `<input type="range" min=0 max=1000>` + `aria-label="Zoom"` + `aria-valuetext="140 %"`; ein Klick auf 🔍
  schaltet `toggleZoomSlider` (`aria-pressed`).
- Leiste ausgeblendet = `opacity: 0; pointer-events: none` (Klicks oben treffen die Seite); die Hot-Zone ist ein
  eigenes, unsichtbares Element (`.bar-zone`, Höhe Leiste + 16 px, `pointer-events: auto` nur im Zustand idle), dessen
  `pointerenter`/`pointermove` die Leiste holt. `pointermove` über der Seite weckt nur den Mauszeiger.
- Sichtbar bleibt die Leiste: Fokus in der Leiste, Maus über Leiste/Zone, offenes Zoom-Menü, Ziehen am Regler,
  `toolbarPinned`, Phase ≠ ready; beim Öffnen eines Buchs sichtbar, dann normal ausblenden. Touch: Tipp ins mittlere
  Drittel schaltet die Leiste (heute: `wake()`).

### Seite und Ansicht

- Ansichtsgröße aus `view.clientWidth/clientHeight` (ohne Scrollbalken) statt der Host-Größe – sonst erzeugt eine
  vertikale Leiste bei Fit width einen horizontalen Balken (Linux/Windows).
- **Einzelseite**: `.view` (Flex) → `.page-box` (Breite/Höhe = gedrehte Box, `margin: auto`) → `img` (ungedrehte
  Größe, mittig, `rotate: <rot>deg`). Neue Seite: Start oben links (Manga: oben rechts), nach Zurückblättern am Ende.
- **Fortlaufend**: `.track` Breite `max(viewW, maxWidth)`, Seiten mittig darin; gleiche `.page-box`-Struktur.
- **Moduswechsel/Zoom/Drehung**: Einzelseite – relativer Mittelpunkt bleibt (Anteil von scrollLeft/Top); fortlaufend –
  `Anchor` (Seite + Anteil) wie heute, horizontal Anteil. `zoomAround()` hält beim Mausrad den Punkt unter dem Zeiger,
  bei Tasten/Regler die Mitte der Ansicht.
- Regler ziehen: Anzeige sofort (CSS-Größe), die **URL-Breite** folgt erst 250 ms nach dem letzten Wert
  (`settledZoom`) – kein Neuladen je Pixel. Ebenso bei Fenster-Resize (Stufen fangen das meiste ab).
- Ziehen zum Verschieben (E4): `pointerdown` + Bewegung > 4 px bei horizontalem Überlauf → `scrollLeft/Top`
  nachführen, Cursor `grab/grabbing`; danach kein Klick-Blättern.
- Live-Region (gedrosselt, wie Seitenwechsel): „Zoom: Fit page“, „Zoom 140 %“ (nach Ende des Ziehens), „Rotated 90°“.

### Store

`ReaderStore`: `zoom = signal<Zoom>`, `zoomSlider`, `toolbarPinned`, `rotation = signal<Rotation>` (aus
`OpenedBook.rotation`, je Buch), Methoden `setZoomMode(m)`, `cycleZoom(dir)`, `setFactor(f)`, `zoomBy(dir, effective)`,
`rotate(dir)`; `saveNow()` speichert, wenn Seite **oder** Drehung sich geändert haben (Drehung sofort, ohne Warten
auf einen Seitenwechsel – gleicher Timer). Einstellungen (ohne Drehung) wie bisher per `effect` in `localStorage`.

## Tests

- **Rust** (`reading_state.rs`): alte Datei ohne `rotation` lädt (0); ungültige Drehung → 0; `set` mit nur geänderter
  Drehung meldet „geändert“; Rundreise speichern/laden. `commands`: `command_rules` bleibt grün.
- **Frontend rein** (`reader-logic.spec.ts`): `fitPage` 4 Modi + custom × Hochformat / Querformat / kleiner als
  Ansicht × 0/90/180/270; `guessSizes`; `layoutPages` mit gemischten Größen, `maxWidth`, Lücken; `pageWidth` (full → 0,
  HiDPI, Stufen, über 4096 → 0); `step2d` vorwärts/rückwärts, Zeilenumbruch, Manga, ohne Überlauf = altes `step`;
  `zoomAround` (Punkt bleibt); Regler-Skala hin und zurück, Rasten; `nextZoom` zyklisch, `custom` → nächster = width;
  `zoomStep` Grenzen.
- **Einstellungen**: Migration `fit: 'height'` → height, unbekannte Werte → Default, Faktor geklemmt, neue Felder.
- **Store**: Direktwahl, zyklisch, `setFactor` → custom, Drehung kommt aus `OpenedBook`, viermal rechts = 0, Speichern
  bei Drehung (Fake-Timer, `FakeReaderApi` zeichnet `rotation` auf).
- **Keymap/Katalog**: neue Aktionen vorhanden, jede Taste eindeutig je Kontext, kein Verweis mehr auf
  `reader.toggleFit` (Katalog, Menü, Specs); Menü „Read“ mit Zoom-Untermenü und radio-Einträgen.
- **Komponente** (`reader.spec.ts`): Box-Größen im DOM je Modus/Drehung; Knöpfe `aria-pressed`; Regler nur wenn an;
  Toolbar mit Fake-Timer: blendet aus, Bewegung über der Seite holt sie **nicht**, Hot-Zone holt sie, bleibt bei
  Fokus/Hover/`toolbarPinned`; `pointer-events: none` im Zustand idle (Klasse).
- **Ende-zu-Ende** (Xvfb): Testsammlung mit CBZ (Hochformat-Seiten, eine Querformat-Doppelseite, eine 6000-px-Seite,
  PNG/WebP), CBR, PDF; jeder Modus in Einzelseite und fortlaufend, Drehen, Regler, Fenster schmal ziehen (Menü statt
  Segment), Toolbar-Verhalten, light/dark-Screenshots. Pinch nur auf dem Mac prüfbar (im Bericht nennen).

## Phasen

Phase 2 (Rust, klein: Drehung im Lesestand) und 3 (Frontend, der Hauptteil) getrennt committen; 4–6 wie üblich.

## Fortschritt

- [x] Phase 1: Design (23.10.2026) – wartet auf Freigabe
- [ ] Phase 2: Rust – Drehung im Lesestand
- [ ] Phase 3: Frontend – Logik, Store, Einstellungen, Aktionen/Keymap/Menü, Seite, Toolbar
- [ ] Phase 4: Ende-zu-Ende
- [ ] Phase 5: Doku, Prompt nach `done/`
- [ ] Phase 6: Abschlussprüfung + Bericht
