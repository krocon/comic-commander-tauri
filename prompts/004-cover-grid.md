# Prompt 004: Cover-Grid mit der GuiExpert Table

> Braucht: 002, 003 · Umfang: L · Branch `feat/cover-grid`
> Gemeinsame Regeln: [`000-arbeitsweise.md`](000-arbeitsweise.md). Vorlage: legacy §6. Table: `CLAUDE.md` §5.

## Ziel

Die Hauptansicht: alle Bücher der aktiven Bibliothek als **virtualisiertes Raster aus Covern** (GuiExpert
`CoverGridTableModel`), flüssig bei 50 000 Büchern, mit Filter, Größenwahl und Tastaturbedienung. Ersetzt die
Skelett-Liste aus 001.

## Anforderungen

1. **Grid**: `TableSignalComponent` + `CoverGridFactory.createCoverGridModel(books, renderer, w, h, width, paddingTop)`;
   Breite über `ResizeObserver` → `setParentWidth` + `recalcHeightAndPadding` + `repaintHard` (Vorlage nutzte
   `window:resize`). Neue Bücher aus dem Hintergrund-Scan (002) ohne Neuaufbau einspielen (Modell-API prüfen; Lücke
   → Mono-Repo, `CLAUDE.md` §5).
2. **Renderer ohne Angular** (`CellRendererIf`): `<img loading="lazy">` mit URL aus 003, Platzhalter mit Format-Kürzel
   während des Ladens und bei Fehler, Titel (Name ohne Endung) unter oder über dem Cover (E1), `title`/`alt` mit
   `relPath`. Kein `innerHTML` mit Nutzerdaten.
3. **Cover-Größen** 200×300, 400×600, 800×1200 (Vorlage `thumbsDims`), Wahl je Bibliothek gemerkt; zusätzlich
   stufenlos mit `Ctrl/Cmd +/-` (E2).
4. **Filter** unten oder in der Toolbar (Vorlage: unten): Syntax der Vorlage – Wörter = ODER, `+wort` = muss,
   `-wort` = darf nicht, ohne Groß-/Kleinschreibung auf `relPath` – als **reine Funktion** mit Testkatalog
   (`filter-logic.ts` + `.cases.json`, Fälle aus `cc-overview-filter.service.spec.ts` der Vorlage übernehmen).
   Entprellt, je Bibliothek gemerkt, `initialFilter` der Bibliothek. Zähler „gefiltert / gesamt“. `Esc` leert.
5. **Serie filtern** (`extractSeriesFilter` der Vorlage, legacy §6) als reine Funktion mit Testfällen.
6. **Cursor & Tastatur**: ein Fokus-Cover (sichtbar), Pfeiltasten im Raster, `Home`/`End`, `PgUp`/`PgDn`, `Enter` =
   lesen (005), `Space` = Aktions-Overlay, Tippen = in den Filter springen (E3). ARIA: `role="grid"` oder Listbox –
   im Design begründen, was die Table hergibt.
7. **Aktionen je Buch** (Overlay wie Vorlage „View / Download / Filter Series / Cancel“ bzw. Kontextmenü):
   Lesen, Mit Standard-App öffnen, Im Finder/Explorer zeigen, Serie filtern, Pfad kopieren. Öffnen/Zeigen über
   schmale Commands (`opener.rs`, `platform/desktop.rs` aus files-and-folders übernehmen).
8. **Scrollposition** je Bibliothek merken und nach Rückkehr aus dem Leser/Neustart wiederherstellen (Vorlage:
   `autoRestoreOptions` + `?scroll=`). Knöpfe „nach oben/unten“ (Vorlage) bzw. `Ctrl+Home/End`.
9. Sortierung (E4): Name natürlich (Default), Ordner, Datum, Größe.

## Entscheidungsfragen

- **E1** Titel unter dem Cover (Höhe +2 Zeilen) vs. nur Tooltip (Vorlage) vs. Einstellung.
- **E2** Feste Größen vs. stufenlos (Thumb-Größe aus 003 passend wählen, z. B. nächstgrößere Stufe).
- **E3** Tastatur-Tippen → Filter oder Schnellsuche (springt zum ersten Treffer, wie Total Commander)?
- **E4** Sortierung: im Grid (`tableApi.sort`) oder in Rust vor der Lieferung?

## Tests

- Frontend: `filter-logic` (Katalog), `series-filter` (Katalog), Grid-Store (Bücher, Filter, Größe, Cursor,
  veraltete Scans), Renderer (Escaping, Platzhalter) in jsdom; Grid-Verhalten im echten Fenster.
- Performance: 50 000 Bücher (Fake-Scan) – Scrollen ohne Ruckeln, Filter < 50 ms; Zahlen in `docs/architecture.md`.

## Akzeptanzkriterien

- [ ] Bibliothek öffnen → Cover erscheinen beim Scrollen; schnelles Scrollen lädt nur sichtbare Cover.
- [ ] Filter `+asterix -album` zeigt die erwarteten Bücher, Zähler stimmt; „Serie filtern“ auf einem Cover setzt den
      Filter wie die Vorlage.
- [ ] Ganze Bedienung per Tastatur möglich, Fokus sichtbar, light und dark geprüft.
- [ ] Nach Rückkehr aus dem Leser steht das Grid an derselben Stelle.
