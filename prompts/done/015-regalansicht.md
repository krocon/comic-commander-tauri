# Prompt 015: Regalansicht (Bücherregal aus Holz)

> Braucht: 004, 008, 011 · Umfang: M–L · Branch `feat/regalansicht` · reines Frontend (Phase 2 entfällt)
> Gemeinsame Regeln: [`000-arbeitsweise.md`](../000-arbeitsweise.md). Table: `CLAUDE.md` §5. Vorgänger-Designs:
> `004-cover-grid.design.md` (Layout, Cursor, Scroll), `011-metadaten-serien.design.md` (Gruppenkacheln).

## Ziel

Neben der heutigen **Darstellung „Raster“** (Cover randlos aneinander, Default) eine zweite Darstellung **„Regal“**,
die **so aussieht wie auf den Referenzfotos**: Cover stehen wie Bücher auf Holzböden vor einer Holzrückwand zwischen
zwei Seitenwänden, leicht dreidimensional, mit Schatten. Umschalten jederzeit per Toolbar, Menü und Tastatur; alles
andere (Filter, Sortierung, Ansichten flach/Serie/Ordner, Cursor, Aktionen, Lesestand, Scrollposition) funktioniert in
beiden Darstellungen gleich.

**Begriffe:** „Ansicht“ ist belegt (011: flach / Serie / Ordner, `ViewMode`). Das hier ist eine **Darstellung**
(`look: 'grid' | 'shelf'`) quer dazu – Regal + Serienansicht ist gültig.

## Referenzfotos (verbindlich)

| Datei | Zeigt | Wofür |
|---|---|---|
| `015-screenshots/img.png` (1024 × 768) | iBooks-Regal quer, 6 Bücher je Boden, auch Bücher ohne Cover (beiger Leineneinband mit Etikett) | **Zielbild** Gesamteindruck, Spalten, Platzhalter-Buch |
| `015-screenshots/img_2.png` (768 × 1024) | iBooks-Regal hoch, fast leer, 4 Bücher, leere Böden bis unten | **Zielbild** Maße und Farben (Tabelle unten), Regal läuft leer weiter |
| `015-screenshots/img_1.png` (600 × 590) | Newsstand: Zeitschriften (Comic-Format!) auf dem Regal | Zeitschriften ohne Buchrücken, nur Schatten (E5) |
| `015-screenshots/img_3.png` (800 × 1100) | leeres Regal, sauber, ohne Bücher/Wasserzeichen | **Material**: Quelle der Bildfragmente (Rückwand, Böden, Seitenwände) |

Die Fotos sind Referenz, nicht Spielraum: Wo dieser Prompt und ein Foto auseinandergehen, gilt das Foto. Dazu die
Quell-PSD `Bookshelf.psd` (Naldz Graphics, <https://naldzgraphics.net/how-to-create-an-ibook/>; 24 MB, nur lokal). Ausschnitte daraus dürfen als
Bildfragmente in die App (Marc, 24.10.2026); Herkunft in `docs/architecture.md` vermerken.

### Aufbau (aus `img_2.png`, `shelf.png` gemessen; Cover 100 × 150 px, 1×)

```
 ┌──┬──────────────────────────────────────────────┬──┐  ← schwebende Toolbar wirkt wie der oberste Boden
 │  │▓▓▓▓▓ Schatten unter dem Boden (≈ 20 px dunkel,│  │
 │S │      Verlauf bis ≈ 60 px)  ↓                  │S │
 │e │   ┌────┐            ┌────┐            ┌────┐  │e │  20 px Luft über dem Cover
 │i │   │▌   │            │▌   │            │▌   │  │i │  ▌ = Buchrücken-Falz links (≈ 8–10 px Verlauf)
 │t │   │▌   │░           │▌   │░           │▌   │░ │t │  ░ = Schatten rechts auf die Rückwand (≈ 8 px)
 │e │   │▌   │░           │▌   │░           │▌   │░ │e │
 │  │   └────┘            └────┘            └────┘  │  │
 ├──┴───▀▀▀▀──────────────▀▀▀▀──────────────▀▀▀▀──┴──┤  Oberseite Boden ≈ 12 px (hinten dunkel → vorn hell),
 │═══════════════════════════════════════════════════│  Buch steht ≈ 5 px hinter der Kante, davor Kontaktschatten
 └───────────────────────────────────────────────────┘  Vorderkante ≈ 16 px, läuft über die Seitenwände
```

| Element | Maß (1×, Cover 100 px) | Farben (sRGB, gemessen) |
|---|---|---|
| Seitenwand links/rechts | 30 px breit, ganze Höhe, Böden laufen davor durch | außen `#7a4b1f` → innen `#5c3912`, 1 px Kante `#4b2804` |
| Rückwand | zwischen den Seitenwänden, senkrechte Maserung, geringe Kontraste | Mitte `#caa061`; seitliche Abdunklung **in px, nicht %**: 0 px `#5c3912`, 32 `#7e5528`, 96 `#a37a44`, 160 `#bd9258`, ab ≈ 200 px voll hell |
| Schatten unter Boden | auf der Rückwand, oben im Fach | direkt darunter `#48220d`, +14 px `#7e5732`, +34 px `#b2854b`, +64 px `#c99f60` (= Wand) |
| Boden-Oberseite | ≈ 12 px, perspektivisch | hinten `#855a2f` → vorn `#bc9d61` |
| Boden-Vorderkante | ≈ 16 px, volle Breite inkl. Seitenwände | oben 1–2 px Licht `#fbe4ac`, `#f4d599` → `#e1c07e`, unterste px `#c7a378`; über den Seitenwänden etwas dunkler (`#dbb577` → `#c5a05c`) |
| Zeilenraster | Zeile = 20 Luft + 150 Cover + 5 Kontaktstreifen + 16 Kante ≈ 191–192 px | – |
| Spalten | Außenrand 42 px (= 30 Seitenwand + 12), Cover gleich verteilt (erste/letzte bündig), Mindestabstand ≈ 44 % Coverbreite → 1024 px: 6 Spalten (Abstand 68), 768 px: 5 (Abstand 46; das Foto zeigt nur 4 Bücher) | – |
| Buch | unbeschnitten im echten Seitenverhältnis, Unterkante auf der Oberseite | Falz links `#857564` → Cover über ≈ 10 px; Schatten rechts `#6d512d` → Wand über ≈ 8 px; schmaler Schatten links (2–3 px); Kontaktschatten `#492a0b` → `#825c2b` auf den 5 px Oberseite vor dem Buch |
| Leeres Regal | unter der letzten Reihe weitere leere Böden bis zum Fensterende (`img_2.png`) | – |

Das Material in `img_3.png` ist heller und hat dickere Böden (≈ 22 + 22 px, Zeile 250 px, Seitenwände 50 px) – es wird
auf die Maße oben gebracht (skaliert/geschnitten) und farblich auf die gemessenen Werte abgestimmt (z. B. per
Farbkorrektur im Generator, nicht per CSS-Filter zur Laufzeit).

## Anforderungen

1. **Umschalten**: Aktionen `view.look.grid`, `view.look.shelf` (prüfbar, `checked`) und `view.look.toggle` im
   `action-catalog.ts`; Kürzel in `keymap.base.json` (Vorschlag `Mod+Shift+b`, auf Konflikte prüfen); Menü „View“
   (nativ + HTML, 008), Befehlspalette; **Umschalt-Knopfpaar in der schwebenden Toolbar** (Raster-/Listen-Symbol wie
   oben rechts in `shelf.png`, als Radiogruppe nach APG).
2. **Gemerkt** im Ansichtszustand (`view-state.ts` → v3, v2 liest sich als `grid`) – je Kategorie oder global (E1).
   Der Wechsel behält Cursor-Buch und oberstes sichtbares Buch (Ids, 004 E10).
3. **Layout als reine Funktion** (`shelf-math.ts` oder in `grid-math.ts`): aus Fensterbreite, Cover-Größe und
   Skalierung → Spalten, Abstand, Zellbreite, **Zeilenhöhe**, Cover-Box, Positionen von Boden und Schatten – genau nach
   der Tabelle oben (Testfälle: 1024 → 6 Spalten/Abstand 68, 768 → 5/46, 1 Spalte bei schmalem Fenster). Heute gilt
   Zeilenhöhe = Coverhöhe: trennen (`rowHeight`) und `pageRows`, `scrollToShow`, `topIndex`, `scrollForTop` sowie die
   Koordinaten des Aktionsmenüs (`cover-grid.ts`) umstellen; im Raster bleibt `rowHeight = coverHeight` (alte Tests
   grün). **Skalierung**: die Holzmaße gelten für Cover 100 px; bei anderen Größen mit `s = clamp(coverW / 100, 1, 1.6)`
   mitwachsen (E4). Größenwahl (`Mod +/-`, Select) wirkt in beiden Darstellungen, die Thumb-Stufe (`loadDimIndex`)
   richtet sich nach der Cover-Box.
4. **Bildfragmente** (erlaubt und gewünscht – sie liefern die Holzoptik der Fotos):
   - Aus `img_3.png` geschnitten von einem **Generator-Skript im Repo** (`scripts/shelf-slices.*`, reproduzierbar,
     feste Koordinaten, Farbkorrektur auf die Tabelle), Ausgabe `src/assets/shelf/` als WebP (oder PNG mit Alpha für
     Schatten), **@1x und @2x** (Retina), zusammen ≤ 300 KiB.
   - Mindestens: Rückwand-Kachel (nahtlos in x **und** y – Kanten im Generator überblenden/spiegeln), Boden-Streifen
     (Oberseite + Vorderkante, 3-Slice: Ende links über der Seitenwand, Mitte `repeat-x`, Ende rechts), Seitenwand
     links/rechts (`repeat-y`). Abdunklung der Rückwand zu den Seiten und Schatten unter den Böden als CSS-Gradients
     darüber (so bleiben sie bei jeder Breite/Zeilenhöhe richtig).
   - Keine neue Laufzeit-Abhängigkeit; braucht der Generator ein Werkzeug (Pillow, sharp …), Begründung in
     `docs/architecture.md` („Abhängigkeiten“, nur Entwicklung).
5. **Zeichnen**: Rückwand, Seitenwände und Böden **einmal** als Hintergrund unter dem Grid (mehrere
   `background`-Ebenen mit `background-size`/`-repeat` im Zeilenraster, verschoben um `paddingTop − scrollTop`), nicht
   je Zelle – so gibt es keine Nähte zwischen Zellen und das Regal läuft unter der letzten Reihe leer bis zum
   Fensterende weiter. Wie das mit der Table geht (Scroll-Container, Ereignis, transparenter Body), im Design klären
   (E2); Lücke → `mono/TODO.md` + `// TODO(guiexpert): …`. Die Zellen zeichnen **nur das Buch**.
6. **Buch** im `CoverRenderer` (Darstellung aus dem Kontext): Wrapper eng um das Bild, unten auf der Boden-Oberseite,
   waagrecht mittig in der Zelle; Falz links und Glanz als Overlay (Gradient oder Alpha-Fragment), Schatten mit
   `box-shadow`/Pseudoelementen (kein `filter: drop-shadow` je Cover, falls die Messung ruckelt). Fortschrittsbalken,
   Fokusrahmen, Gruppenstapel, Anzahl und Name liegen **am Buch**, nicht an der Zelle. Bis das Bild geladen ist: Box im
   Seitenverhältnis der Thumb-Stufe.
7. **Buch ohne Cover** (Fehler, noch nicht erzeugt) wie die beigen Bücher in `shelf.png`: Leineneinband (`#ddcfa2`,
   feine Struktur), oben ein helles Etikett mit dem Titel (Name ohne Endung, Serifenschrift, zentriert, max. 4 Zeilen),
   unten klein das Format (CBZ …) an der Stelle des Autors. Nur `textContent`.
8. **Gruppen** (Serie/Ordner, 011) als Buch mit 2 versetzten Kanten dahinter (Stapel), Anzahl-Badge, Name auf dem
   Cover wie bisher – lesbar auf Holz.
9. **Zeile 0** unter der schwebenden Toolbar: die Toolbar wirkt als oberster Boden, direkt darunter der Schatten
   (wie unter dem Kopf in `img_2.png`). Toolbar über Holz lesbar (halbtransparent + `backdrop-filter: blur`).
10. **Hell/dunkel**: das Regal sieht in beiden Farbschemata **gleich** aus (wie die Fotos); nur Toolbar, Menüs und
    Fokusfarbe folgen dem Schema. Werte als Tokens in `src/styles.css` (`--shelf-*`), keine Farben in Komponenten-CSS;
    Renderer-DOM global stylen (`.cc-shelf …`, wie `.cc-cover`).
11. **Leistung**: 50 000 Bücher scrollen im Regal so flüssig wie im Raster (Messung in `docs/architecture.md`).
12. **Barrierefreiheit**: Fokusrahmen auf Holz deutlich (≥ 3:1 gegen Holz und Cover), Live-Region meldet den Wechsel,
    `prefers-reduced-motion` ohne Überblenden (sonst ≤ 150 ms). Texte aus `grid-texts.ts`.

## Phase 1 zusätzlich: Attrappe 🛑

Vor dem Freigabe-Halt eine **statische HTML-Attrappe** (`015-shelf-mock.html`, nutzt die erzeugten Fragmente
und das geplante CSS, Test-Cover 100 × 150 + 2 Bücher ohne Cover) bei **768 × 1024** und **1024 × 768** rendern
(Playwright/Chromium im Container) und **nebeneinander mit `img_2.png` bzw. `shelf.png`** als Bild ins Design-Dokument
legen. Erst nach Marcs Freigabe der Optik in die App einbauen.

## Entscheidungsfragen

- **E1** Darstellung je Kategorie merken (Ansichtszustand v3) oder global (zieht mit 009 in die Einstellungen)?
- **E2** Wie liegt der Regal-Hintergrund unter der Table und scrollt mit (Scroll-Ereignis → `background-position`, oder
  Hintergrund am scrollenden Inhalt mit `background-attachment: local`)? Was gibt die Table her?
- **E3** Fragmente: welche Schnitte aus `img_3.png`, wie nahtlos gemacht, WebP vs. PNG – Größe und Optik.
- **E4** Skalierung bei großen Covern: Holzmaße mitwachsen (`s` oben) oder fest bleiben?
- **E5** Buchrücken-Falz immer (Bücher, `shelf.png`) oder für dünne Hefte nur Schatten wie die Zeitschriften in
  `view.png` (z. B. abhängig von der Seitenzahl, wenn bekannt)?

## Tests

- Frontend: Layout-Funktion (Spalten/Abstände wie gemessen, Zeilenhöhe, Skalierung, Randfälle), Cursor-/Scroll-
  Mathematik mit `rowHeight ≠ coverHeight`, `view-state` v2 → v3, Aktionen (`checked`, Erhalt von Cursor/Position),
  Renderer in jsdom (Buch-DOM, Platzhalter-Buch mit Titel per `textContent`, Overlays am Buch, Escaping).
- **Optischer Abgleich**: ein Skript rendert die Attrappe bzw. die echte App (Xvfb) bei 768 × 1024 und vergleicht
  Stichpunkte mit `img_2.png`: Lage von Seitenwand, Boden-Oberseite/-Kante und Schatten (± 2 px), Farben an den
  Punkten der Tabelle (ΔE00 ≤ 8). Ergebnis-Tabelle ins Design-Dokument.
- Ende-zu-Ende (Xvfb, light **und** dark): Screenshots Raster ↔ Regal in drei Cover-Größen, Serien- und
  Ordneransicht, fehlende Cover, fast leere Kategorie (leere Böden bis unten), 50 000 Bücher (Fake-Scan).

## Akzeptanzkriterien

- [ ] Knopf, Menüpunkt, Befehlspalette und Kürzel schalten zwischen Raster und Regal; der Menüpunkt zeigt den Zustand.
- [ ] Bei 768 × 1024 und 1024 × 768 mit Covern 100 × 150 ist die App neben `img_2.png`/`shelf.png` gelegt **kaum zu
  unterscheiden**: Seitenwände, Holzmaserung, Böden mit Oberseite, Lichtkante und Schatten, 5 bzw. 6 Plätze je
  Boden mit Falz und Schatten; der optische Abgleich ist grün.
- [ ] Bücher ohne Cover sehen aus wie die beigen Bücher in `shelf.png` (mit dem eigenen Titel).
- [ ] Keine Nähte in Rückwand oder Böden, auch nicht beim Scrollen und auf Retina; leere Böden bis zum Fensterende.
- [ ] Nach dem Umschalten steht dasselbe Buch oben bzw. unter dem Cursor; Neustart stellt die Darstellung wieder her.
- [ ] Filter, Sortierung, Größe, Serien-/Ordneransicht, Aktionsmenü, Lesen und Lesestand funktionieren im Regal
      unverändert; ganze Bedienung per Tastatur, Fokus auf Holz gut sichtbar; light und dark angesehen.
- [ ] 50 000 Bücher scrollen im Regal ohne Ruckeln (Messwert dokumentiert).
