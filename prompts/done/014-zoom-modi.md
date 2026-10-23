# Prompt 014: Zoom, Drehen und Leser-Toolbar

> Braucht: 005, 006, 008 · Umfang: M · Branch `feat/zoom-drehen`
> Gemeinsame Regeln: [`000-arbeitsweise.md`](000-arbeitsweise.md). Baut auf 005 (E2 Seitenbreiten, E10 Einstellungen)
> und 008 (Aktionskatalog, Keymaps, Menü) auf.

## Ziel

Der Leser kennt heute nur zwei Einpassungen (`ReaderFit = 'width' | 'height'`, umgeschaltet mit `W` über
`reader.toggleFit`). Er soll bekommen:

- **vier Zoom-Modi** – in Einzelseite **und** fortlaufendem Modus (Tabelle unten),
- einen **Zoom-Schieberegler** („Show zoom slider“, ein-/ausblendbar) für freien Zoom,
- **Drehen** links/rechts in 90°-Schritten,
- eine **ruhigere Toolbar**: dezente Icons, beim Lesen sanft ausgeblendet, sanft eingeblendet, wenn die Maus in den
  Bereich der Leiste kommt.

| Modus | Schlüssel | Verhalten |
|---|---|---|
| Fit width | `'width'` | Seite so breit wie die Ansicht; hohe Seiten vertikal scrollen (heutiges Verhalten). |
| Fit height | `'height'` | Seite so hoch wie die Ansicht; zu breite Seiten (Doppelseiten im Querformat) horizontal scrollen statt verkleinern – **Entscheidung E2**. |
| Fit page | `'page'` | Ganze Seite sichtbar: `min(viewWidth / w, viewHeight / h)`, zentriert, nie Scrollbalken. |
| Full size | `'full'` | Originalgröße 1:1 in CSS-Pixeln (siehe E3), zentriert, wenn kleiner als die Ansicht; sonst in beide Richtungen scrollbar. |

## Ist-Stand (zuerst lesen)

- `src/app/features/reader/reader-logic.ts`: `ReaderFit`, `widthBucket()` (angefragte Seitenbreite, `0` = Original),
  `layoutPages()` (Boxen des fortlaufenden Modus, kennt nur `width`/`height`).
- `reader.store.ts`: Signal `fit`, `toggleFit()`, Persistenz über `reader-settings.ts` (`localStorage`, Validierung in
  Zeile ~28 akzeptiert nur `'height'`).
- `reader.ts`: `layout`-Computed, `width()`/`pageUrl()`, Aktion `toggleFit`, Menü-Eintrag `reader.toggleFit` mit
  `checked`.
- `reader.html` (Knopf mit `fa-arrows-h`/`fa-arrows-v`, Klasse `fit-height`), `reader.css` (`.single`, `.fit-height`).
- `reader-texts.ts` (Tooltip-Texte `fitWidth`/`fitHeight`),
- Toolbar: `<header class="bar">` in `reader.html`; Ausblenden in `reader.ts` (`BAR_IDLE_MS` = 2500 ms, Signal
  `idle`, `overBar()`, Fokus in der Leiste) und `reader.css` (`.idle .bar { opacity: 0 }`, `:focus-within`,
  `prefers-reduced-motion`). Heute holt **jede** Mausbewegung über der Seite die Leiste zurück.
  `core/actions/action-catalog.ts`, `keymap.ts`, `features/menus/menu-model.ts`.

## Anforderungen

1. **Typ und Logik**: `ReaderFit` → `'width' | 'height' | 'page' | 'full'` (Name ggf. `ReaderZoom`, dann überall
   umbenennen). Reine Funktion `pageBox(fit, natW, natH, viewW, viewH, dpr)` → `{ width, height }` in CSS-Pixeln;
   `layoutPages()` nutzt sie für jede Seite (bei `full`/`height` darf eine Box breiter als die Ansicht sein →
   `layoutPages` liefert zusätzlich `maxWidth` für die horizontale Scrollbreite).
2. **Seitenauflösung**: `widthBucket()` so erweitern, dass jeder Modus genug Pixel anfragt – `page`/`width`/`height`
   aus der tatsächlichen Box × `dpr`, `full` immer `0` (Original). Kein unnötiges Neuladen bei kleinen
   Fensteränderungen (Stufen aus `PAGE_WIDTHS` bleiben).
3. **Darstellung**: Einzelseite und fortlaufend zeigen jeden Modus korrekt; zentriert, wenn kleiner als die Ansicht;
   überlaufende Seiten in beide Richtungen erreichbar (kein abgeschnittener linker/oberer Rand – das „auto margins“-
   Muster aus `reader.css` beibehalten). Unbekannte Seitengröße: wie bisher über `aspects()`/`DEFAULT_ASPECT`.
4. **Blättern**: „erst scrollen, dann blättern“ (005) gilt auch für horizontalen Überlauf: bei `full`/`height` mit
   breiter Seite zuerst bildschirmweise horizontal scrollen (Manga-Modus: von rechts nach links), dann blättern.
   Klick in linkes/rechtes Drittel und Wischen dürfen das Scrollen in einer gezoomten Seite nicht verhindern
   (Wischen nur, wenn am Rand – E4).
5. **Position beim Wechsel**: Beim Moduswechsel bleibt die aktuelle Seite; im fortlaufenden Modus bleibt die relative
   Position innerhalb der Seite (Anteil der Scrollhöhe) erhalten, kein Sprung an den Anfang.
6. **Bedienung**:
   - Aktionskatalog: vier Aktionen `reader.zoomFitWidth`, `reader.zoomFitHeight`, `reader.zoomFitPage`,
     `reader.zoomFullSize` (Radio-Gruppe im Menü, `checked` = aktiver Modus) plus `reader.cycleZoom` (ersetzt
     `reader.toggleFit`, zyklisch width → height → page → full).
   - Tasten (Keymaps je OS, Konflikte mit 008 prüfen): `W` = zyklisch weiter, `Shift+W` = zurück; Direktwahl
     z. B. `1`–`4` oder `Cmd/Ctrl+0` = Fit page, `Cmd/Ctrl+1` = Full size (wie Vorschau.app/Browser) – **E1**.
   - Werkzeugleiste: der bestehende Fit-Knopf wird zu einem Knopf mit Auswahl (Dropdown/Segment) mit eigenem Icon je
     Modus; Tooltip nennt Modus und Taste.
   - Befehlspalette findet alle vier Modi.
7. **Persistenz**: Modus in den Leser-Einstellungen (`reader-settings.ts`), Migration: alte Werte `'width'`/`'height'`
   bleiben gültig, Unbekanntes → `'width'`. Optional je Buch merken – **E5**.
8. **Barrierefreiheit**: Knopf/Menü mit `aria-label`, `aria-checked`/`aria-pressed` je Modus; Live-Region meldet
   „Zoom: Fit page“ (gedrosselt, wie der Seitenwechsel).
9. **Texte**: alle neuen Texte in `reader-texts.ts` bzw. dem Mechanismus aus 009 (falls schon umgesetzt) – Englisch
   als Quelle, Deutsch ergänzen.

### Zoom-Schieberegler

10. **„Show zoom slider“**: Aktion `reader.toggleZoomSlider` (Haken im Menü, Icon in der Toolbar), gemerkt in den
    Leser-Einstellungen. Der Regler (z. B. 10 %–800 %, logarithmisch, Prozentanzeige daneben) erscheint dezent in
    der Toolbar oder als schmale schwebende Leiste – **E7**.
11. Datenmodell: `zoom = { mode: 'width' | 'height' | 'page' | 'full' | 'custom', factor }` (so wie in E6
    vorgesehen). Der Regler zeigt immer den **effektiven** Faktor des aktiven Modus (Fit page bei 1200-px-Fenster
    → z. B. 37 %); Ziehen schaltet auf `custom`. Ein Klick auf einen der vier Modi verlässt `custom` wieder.
12. Zusätzlich `reader.zoomIn` / `reader.zoomOut` (`Cmd/Ctrl +` / `Cmd/Ctrl -`, Strg+Mausrad, Pinch auf dem
    Trackpad) in Stufen; Zoom um den Mauspunkt bzw. die Mitte der Ansicht, ohne Sprung.
13. Auflösung: `widthBucket()` fragt bei `custom` passend zum Faktor × `dpr` an (über 100 % → Original); Neuladen
    erst nach Ende des Ziehens (entprellt), bis dahin skaliert das vorhandene Bild per CSS.

### Drehen

14. Aktionen `reader.rotateLeft` / `reader.rotateRight` (90° gegen/mit dem Uhrzeigersinn; Tasten z. B. `L`/`R` oder
    `Cmd/Ctrl+[`/`]` wie Vorschau.app – Konflikte mit `[`/`]` = Buch wechseln prüfen, **E1**), Icons
    `fa-rotate-left`/`fa-rotate-right`.
15. Drehung gilt für **das ganze Buch** (Querformat-Scans) oder je Seite – **E8**; gemerkt je Buch (Lesestand aus
    005 E5) oder nur für die Sitzung – **E5**.
16. Alle Zoom-Modi rechnen mit den **gedrehten** Maßen (bei 90°/270° Breite und Höhe tauschen) – `pageBox()` und
    `layoutPages()` bekommen `rotation: 0 | 90 | 180 | 270`. Umsetzung im Frontend per CSS-`rotate` mit korrekt
    getauschter Box (kein Überlappen, kein Abschneiden) oder im Rust-Skalierer (`reader/image`) – **E9**.
17. Blättern, Drittel-Klick und Wischen behalten ihre Richtung bezogen auf den **Bildschirm**, nicht auf die Seite.

### Toolbar: dezent und sanft

18. **Dezente Icons**: alle Leser-Knöpfe als reine Icon-Knöpfe ohne Rahmen/Hintergrund, gedämpfte Farbe
    (z. B. Tokens `--color-reader-text` mit ~70 % Deckkraft), volle Deckkraft bei Hover/Fokus, aktiver Zustand
    (`aria-pressed`) nur als feiner Akzent (Unterstrich oder Icon in Akzentfarbe) statt gefüllter Fläche. Gruppen
    (Navigation | Ansicht/Zoom | Drehen | Vollbild) mit etwas Abstand statt Trennlinien. Neue Farben nur als Tokens in
    `src/styles.css` (light/dark), Kontrast ≥ 3:1 für Icons.
19. **Zoom-Bedienung in der Leiste**: die vier Modi als kompakte Segment-Gruppe aus Icons (oder ein Icon mit
    Aufklapp-Menü nach APG – **E10**), daneben Schieberegler-Schalter, Drehen links/rechts. Jedes Icon mit
    `aria-label` und Tooltip „Name (Taste)“ aus dem Keymap-Anzeigetext (`shortcut.ts`), nie hart codiert.
20. **Sanft aus- und einblenden**:
    - Beim Lesen (Seite geöffnet, kein Fokus in der Leiste, Maus nicht über der Leiste) blendet die Leiste nach
      `BAR_IDLE_MS` mit `opacity`-Übergang (~300 ms, `ease`) aus; auch der Mauszeiger über der Seite wird
      ausgeblendet (`cursor: none`), solange die Maus ruht – **E11**.
    - **Einblenden nur, wenn die Maus in den oberen Bereich kommt** (Leistenhöhe + kleine Hot-Zone, z. B. 48 px) –
      nicht mehr bei jeder Bewegung über der Seite (**E11**: alternativ jede Bewegung, aber erst ab einer
      Mindeststrecke). Einblenden ~150 ms, Ausblenden langsamer.
    - Immer sichtbar: solange Fokus in der Leiste ist, ein Menü/Regler geöffnet oder gezogen wird, beim Öffnen des
      Buchs (kurz, dann ausblenden), auf Touch-Geräten nach einem Tipp in die Bildmitte (Umschalten).
    - Tastatur: `Tab` ins Leser-Fenster zeigt die Leiste; eine Aktion `reader.toggleToolbar` (z. B. `T`) blendet sie
      dauerhaft ein/aus.
    - Ausgeblendet heißt `opacity: 0` **und** `pointer-events: none`, damit Klicks oben die Seite treffen; die
      Hot-Zone bleibt aktiv. `prefers-reduced-motion`: ohne Übergang.
    - Die Seite rutscht beim Ein-/Ausblenden **nicht** (Leiste schwebt weiterhin über der Seite).

## Entscheidungsfragen

- **E1** Tastenbelegung: nur `W` zyklisch, Ziffern `1`–`4`, oder `Cmd/Ctrl+0/1` (Plattform-Konvention)? Konflikte mit
  bestehenden Reader-/Global-Keymaps auflisten.
- **E2** Fit height bei Querformat-Doppelseite: horizontal scrollen (echtes „fit height“) oder auf Ansichtsbreite
  begrenzen (heutiges Verhalten `min(viewWidth, …)`)?
- **E3** Full size: 1 Bildpixel = 1 CSS-Pixel (auf Retina „halb so groß“ wie physisch) oder 1 Bildpixel =
  1 Gerätepixel (`/ dpr`)? Vorlage/Vorschau.app als Referenz prüfen.
- **E4** Wischen/Drittel-Klick bei gezoomter Seite: erst am Rand blättern oder immer blättern?
- **E5** Zoom global vs. je Buch (z. B. in `reading-state.json` aus 005 E5) merken?
- **E6** Freier Zoom ist mit dem Schieberegler jetzt Teil des Auftrags: Datenmodell `zoom: { mode, factor }` –
  `custom` als fünfter Modus oder Faktor als Überlagerung eines Fit-Modus?
- **E7** Ort des Zoom-Reglers: in der Toolbar (Platz neben dem Seiten-Schieberegler?) oder als eigene schwebende
  Leiste unten/rechts? Bereich und Skala (linear/logarithmisch), Rasten bei 100 % und den Fit-Werten.
- **E8** Drehung je Buch oder je Seite? (Doppelseiten im Querformat sind meist einzelne Seiten.)
- **E9** Drehen per CSS im Frontend vs. im Rust-Skalierer (scharf, gleiche Pixel-Ausnutzung, aber neue URL-Variante
  `…&rot=90` und Cache-Schlüssel).
- **E10** ~~Zoom-Modi als vier sichtbare Icons (Segment) oder ein Icon + Menü?~~ **Entschieden (Marc, 23.10.2026):
  vier sichtbare Icons, wenn der Platz reicht** (sonst ein Icon + Menü).
- **E11** Einblenden nur über die Hot-Zone oben vs. jede deutliche Mausbewegung; Mauszeiger mit ausblenden?
  Verzögerung (`BAR_IDLE_MS` 2,5 s beibehalten?).

## Tests

- Reine Funktionen (`reader-logic.spec.ts`): `pageBox` für alle 4 Modi × Hochformat/Querformat/Seite kleiner als
  Ansicht; `layoutPages` mit gemischten Seitengrößen inkl. `maxWidth`; `widthBucket` je Modus (`full` → 0, HiDPI).
- Einstellungen: Migration alter Werte, ungültige Werte → Default.
- Store: Direktwahl, zyklisch vor/zurück, Persistenz.
- Logik „erst scrollen, dann blättern“ mit horizontalem Überlauf inkl. Manga-Richtung.
- Keymap/Katalog: neue Aktionen vorhanden, keine doppelten Tasten; `reader.toggleFit` sauber entfernt (auch aus
  `menu-model.ts` und Specs).
- Komponente (`reader.spec.ts`): richtige CSS-Klassen/Boxen je Modus, Knopf-Zustand.
- Zoom-Faktor: effektiver Faktor je Modus, Wechsel auf `custom`, Stufen von Zoom in/out, Grenzen 10 %/800 %,
  Zoom um einen Punkt hält diesen Punkt fest (reine Funktion).
- Drehen: `pageBox`/`layoutPages` mit 0/90/180/270 (Maße getauscht), vier Mal rechts = Ausgangslage, Persistenz.
- Toolbar: mit Fake-Timer (`BAR_IDLE_MS`) – blendet aus nach Ruhe, bleibt bei Fokus/Hover/geöffnetem Regler,
  blendet bei Bewegung **in** der Hot-Zone ein, **nicht** bei Bewegung über der Seite (je nach E11);
  `pointer-events: none` im ausgeblendeten Zustand; `reader.toggleToolbar`.

## Akzeptanzkriterien

- [ ] Alle vier Modi funktionieren in Einzelseite und fortlaufend, mit CBZ, CBR und PDF (006).
- [ ] Fit page zeigt jede Seite vollständig ohne Scrollbalken, auch nach Fenstergröße-Änderung.
- [ ] Full size zeigt einen 6000-px-Scan scharf in Originalauflösung; Scrollen in beide Richtungen ruckelt nicht.
- [ ] Moduswechsel springt nicht an den Buchanfang und lädt nur Seiten neu, deren Auflösung nicht reicht.
- [ ] Modus bleibt über einen Neustart erhalten; alte Einstellungen werden übernommen.
- [ ] Bedienbar per Tastatur, Menü, Werkzeugleiste und Befehlspalette; Screenreader sagt den Modus an.
- [ ] „Show zoom slider“ blendet den Regler ein/aus; Ziehen zoomt flüssig, danach wird bei Bedarf schärfer geladen.
- [ ] Drehen links/rechts funktioniert in allen Zoom-Modi; Fit page zeigt eine gedrehte Querformat-Seite vollständig.
- [ ] Die Toolbar besteht aus dezenten Icons (light und dark mit Screenshot geprüft), blendet beim Lesen sanft aus und
      nur bei Maus im oberen Bereich (bzw. nach E11) sanft wieder ein; Klicks auf die ausgeblendete Leiste treffen
      die Seite.
- [ ] `pnpm check` grün.
