# Design 015 – Regalansicht

> Status: **umgesetzt** · selbständig bearbeitet (Marc, 24.10.2026: „bearbeite 015 selbständig“, die Freigabe nach
> Phase 1 entfällt; Zwischenstand der Attrappe ging als Bild an Marc) · Branch `feat/regalansicht` · Auftrag:
> [`015-regalansicht.md`](015-regalansicht.md) · baut auf 004 (Cover-Grid, Layout, Cursor, Ansichtszustand),
> 008 (Aktionen, Keymaps, Menü) und 011 (Ansichten, Gruppenkacheln) auf. Reines Frontend (Phase 2 entfällt).
> Bilder: `015-screenshots/` (Referenzfotos, Abgleich, App). Quelle von Layout und Holz: „Create an iBook Inspired Bookshelf Mock-up“, Naldz Graphics
> (<https://naldzgraphics.net/how-to-create-an-ibook/>), `Bookshelf.psd`; Maße und Farben aus den iBooks-Fotos.

## Entscheidungen auf einen Blick

| Nr. | Frage | Entscheidung |
|---|---|---|
| E1 | Darstellung merken | **je Kategorie** im Ansichtszustand (**v3**, Feld `look`; v1/v2 → `grid`), wie Ansicht und Größe. Eine Comic-Kategorie im Regal, eine PDF-Kategorie im Raster ist sinnvoll; mit 009 kann ein globaler Standard dazukommen |
| E2 | Holz unter der Table | **eigene Ebene `ShelfBackdrop` (reines DOM) unter der transparenten Table**, nicht je Zelle. Rückwand und Seitenwände über `background-position-y = −scrollTop`, Böden als Zeilen-Pool nur für den sichtbaren Teil (`visibleShelves`). Die Table setzt ihre Zellen synchron im `scroll`-Ereignis (`adjustAfterScrolling`) und gibt im selben Task `GeScrollEvent` aus; dort ruft das Grid `syncBackdrop()` → Holz und Bücher bewegen sich im selben Frame. Keine Nähte, leere Böden bis zum Fensterende. Kein Eingriff in die Table nötig |
| E3 | Fragmente | **Maserung aus der rohen Holztextur der PSD** (Smart-Objekt `wood (right).psb`, ohne eingebackenes Licht) statt Ausschnitten aus `img_3.png`. Der Generator teilt die Helligkeit durch ihr weiches Mittel (Detail ≈ 1), bringt den Kontrast auf die Werte der iBooks-Fotos (Standardabweichung gemessen) und legt das Detail auf die **gemessenen Farben**. Licht und Schatten (Abdunklung zu den Seitenwänden, Schatten unter den Böden, Kontaktschatten) sind CSS-Verläufe in px – passen so bei jeder Breite und Zeilenhöhe. WebP in 2x-Auflösung, zusammen ≈ 41 KiB |
| E4 | Skalierung | Holzmaße gelten für Cover 100 px breit; größere Cover skalieren das Holz mit `s = clamp(coverW / 100, 1, 1.6)` (200-px-Cover: Böden 45 px statt 28 px – kräftig, aber nicht klobig) |
| E5 | Buchrücken | **immer der Falz links** (wie die Bücher in `img.png`), gemessen aus `img_2` x 42–53 als Verlauf. Die Hefte in `img_1.png` (ohne Falz) bleiben eine Folge-Idee – die Seitenzahl ist beim Zeichnen nicht bekannt |
| E6 | Spalten | wie die Fotos: Außenrand 42 px, Cover in Originalgröße (nicht gestreckt), Mindestabstand **0,44 × Coverbreite**, Rest gleich verteilt, erste und letzte Spalte bündig → 1024 px: 6 Spalten/Abstand 68, 768 px: 5/46 (beide Fotos exakt; der Prompt nannte für 768 irrtümlich 4 – `img_2` zeigt nur 4 Bücher, das Raster hat 5 Plätze) |
| E7 | Table-Zellen | Zellbreite = `floor(Fensterbreite / Spalten)` (ganze px – die Table zählt `floor(width / coverWidth)` Spalten), Zeilenhöhe = 20 + Cover + 6 + 16; das Buch sitzt **in seiner Zelle** an der Foto-Position (`bookLeft`), damit Klicks die richtige Kachel treffen (Spec prüft „Buch liegt in der Zelle“ für viele Breiten) |
| E8 | Echtes Seitenverhältnis | Thumbnails sind „fit inside“ (003), das Seitenverhältnis kennt erst das geladene Bild: der Renderer passt das Buch beim `load` ein (`fitCover`, auch vergrößernd) und merkt sich die Größe je URL (≤ 20 000) → jede weitere Zeichnung hat sofort die richtige Größe, kein Flackern beim Scrollen |
| E9 | Buch ohne Cover | Leineneinband (`--shelf-linen`) mit Etikett: Titel = Name ohne Endung, unten das Format statt des Autors – wie die beigen Bücher in `img.png`; nur `textContent` |
| E10 | Hell/dunkel | das Regal ist in beiden Schemata gleich (die Fotos); Tokens `--shelf-*` nur in `:root`. Toolbar, Menüs, Badges folgen dem Schema |
| E11 | Fokus | zweifarbig: 3 px weißer Rahmen + 2 px dunkelblauer Ring außen (`--shelf-focus`, `--shelf-focus-ring`) – auf hellem und dunklem Holz und jedem Cover sichtbar |
| E12 | Umschalten | Aktionen `view.look.grid`/`view.look.shelf` (Radio im Menü „View“, `checked`) und `view.look.toggle` (**`Mod+Shift+B`**, frei in allen Keymaps); in der Toolbar eine zweite Radiogruppe (`fa-th`/`fa-book`, APG-Pfeiltasten) neben den Ansichten; Live-Region sagt „Grid“/„Shelf“ |

## Bestand

| Baustein | wofür | Befund |
|---|---|---|
| `grid-math.ts` (`gridLayout`, `pageRows`, `scrollToShow`, `topIndex`, `scrollForTop`) | Raster-Arithmetik | **passt**: die Funktionen rechnen mit „Zeilenhöhe“; das Grid übergibt jetzt `rowHeight` statt `coverHeight` |
| `CoverGrid` (`layout`, `applyModel`, `onScroll`, `openMenu`, Aktionen) | Grid | **erweitert**: `layout` = `geometry(look, …)`, Modell-„Cover“ = Zelle, `syncBackdrop()` |
| `CoverRenderer` | Kachel | **erweitert**: Zweig `renderBook` für das Regal |
| `view-state.ts` (v2) | je Kategorie | **v3**: `look` |
| `GridStore` | Zustand | **erweitert**: `look`, `setLook`, `toggleLook` |
| GuiExpert Table 1.1.102 | Cover-Grid | **passt** (transparenter Hintergrund, Scroll-Ereignis synchron) – keine Lücke |

## Verträge

Kein Rust, keine Commands. Neue Frontend-Typen: `Look = 'grid' | 'shelf'` (`view-state.ts`), `ShelfLayout`,
`Geometry` (`shelf-math.ts`). Aktionen `view.look.grid`, `view.look.shelf`, `view.look.toggle`.

```
 Toolbar (schwebend): ☰ Kategorie | Filter | [▦ ⧉ 🗀] Ansicht | [▦ 📖] Darstellung | Größe | Ordnung | …
 Fokus-Reihenfolge: … Ansicht (eine Gruppe, Pfeile) → Darstellung (eine Gruppe, Pfeile) → Größe → …
```

Aufbau: Tabelle „Aufbau“ in [`015-regalansicht.md`](015-regalansicht.md); umgesetzt in `shelf-math.ts` (`SHELF`)
und `shelf.css`.

## Tests

- `shelf-math.spec.ts`: Spalten/Abstände/Positionen exakt wie `img.png` (42, 210, … 882) und `img_2.png`
  (42, 188, … 626), Buch in seiner Zelle (7 Breiten × 3 Größen), schmal, Skalierung, `geometry`, `visibleShelves`,
  `fitCover`.
- `cover-renderer.spec.ts`: Regal-DOM, Größe nach `load` + Merken, Buch ohne Cover (Escaping), Fehler → Leinen,
  Gruppe, `displayTitle`.
- `shelf-backdrop.spec.ts`: Ebenen, Zeilen je Fensterhöhe, Scrollen, Pool.
- `view-state.spec.ts` (v3, v2 → grid), `grid.store.spec.ts` (merken, umschalten).
- **Optischer Abgleich** `scripts/shelf-compare.py`: Attrappe bzw. App-Screenshot gegen `img_2.png` – 14 Farbpunkte
  (ΔE00 ≤ 8) und Kanten der Böden/Bücher (± 2 px), Bilder nebeneinander.

## Fortschritt

- [x] Phase 1: Fotos und PSD ausgemessen, Generator `scripts/shelf-slices.py`, Attrappe
      `015-shelf-mock.html`, Abgleich grün (alle Punkte ΔE00 ≤ 5,1, Kanten ± 1 px)
- [x] Phase 3: Frontend (Specs zuerst für Mathematik, dann Renderer/Hintergrund/Store/Aktionen)
- [x] Phase 4: Ende-zu-Ende (Xvfb, Debug-Build): Testsammlung mit Umlauten, Emoji, Serien, kaputtem Archiv, ZIP als
      CBR, breitem Cover; 50 000 leere Bücher. Befunde behoben: (1) Holz außerhalb des Viewports lief bei schnellem
      Mausrad hinterher und ließ unter Software-Rendering Bilder ausfallen → Holz im Scroll-Viewport, nativ
      mitscrollend (A55); (2) die Höhe des Holzes aus `scrollHeight` schrumpfte nie → nach einem Filter stand die
      Table im Leeren (`shelfHeight`, roter Test zuerst). Abgleich der App mit `img_2.png`: alle Holz-Punkte
      ΔE00 ≤ 5,7, Böden ± 2 px. Bilder in `015-screenshots/` (`compare-*`, `app-*`)
- [x] Phase 5/6: Doku (README, architecture A54–A56 + Messung, CLAUDE.md), Abschlussprüfung

Nicht geprüft: macOS (natives Menü mit dem neuen Radio-Paar, Retina-Schärfe der 2x-Fragmente, GPU-Scrollen), Windows;
hell (die App startet fest dunkel bis 009 – das Regal ist ohnehin in beiden Schemata gleich).
