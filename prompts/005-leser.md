# Prompt 005: Leser (Seiten anzeigen und blättern)

> Braucht: 003, 004 · Umfang: L · Branch `feat/leser`
> Gemeinsame Regeln: [`000-arbeitsweise.md`](000-arbeitsweise.md). Vorlage: legacy §7, §10.4.

## Ziel

Ein Buch per `Enter`/Doppelklick öffnen und lesen – Einzelseite oder fortlaufend, mit Tastatur, Maus und Touch, so wie
die Vorlage, aber **ohne das ganze Archiv zu entpacken** und mit allen Bildformaten.

## Anforderungen

1. **Seitenliste** aus Rust: Bilder des Archivs in natürlicher Reihenfolge (`comic::pages` aus files-and-folders),
   mit Breite/Höhe, sobald bekannt (für Layout ohne Springen). PDF-Seiten kommen in 006 über dieselbe Schnittstelle.
2. **Seiten liefern** über das URI-Schema aus 003: einzelner Eintrag direkt aus dem Archiv (ZIP/TAR/7z: Stream;
   RAR: ggf. App-Cache – E1), Original oder auf Fensterbreite skaliert (E2). Vorausladen der nächsten 2–3 Seiten,
   begrenzter Speicher-/Platten-Cache, Aufräumen (legacy §10.4: Vorlage räumt nie auf).
3. **Modi** (gemerkt): Einzelseite (Breite voll / Höhe voll, `W`), fortlaufend (virtualisiert), optional Doppelseite
   (E3); `S` schaltet Einzel/fortlaufend.
4. **Blättern** wie legacy §7: `→`/`↓`/`n`/`Space` weiter, `←`/`↑`/`b`/`Shift+Space` zurück, mit `Cmd/Ctrl` an
   Anfang/Ende; in einer hohen Seite erst bildschirmweise scrollen, dann blättern; Klick ins linke/rechte Drittel;
   Wischen; Mausrad im fortlaufenden Modus. Manga-Modus (rechts → links) als Option (E4).
5. **Position je Buch** merken (letzte Seite) und beim Öffnen fortsetzen; Lesefortschritt optional im Grid anzeigen
   (Balken am Cover) – E5.
6. **Navigation**: `Esc`/Zurück-Knopf → Grid an derselben Stelle (004); nächstes/vorheriges Buch der (gefilterten)
   Liste mit `]`/`[` (E6). Vollbild `F11`/`Cmd+Ctrl+F`.
7. **Seitenanzeige** „12 / 48“, Schieberegler zum Springen, Miniaturleiste optional.
8. Barrierefreiheit: Seiten mit `alt` „Seite 12 von 48“, Live-Region bei Seitenwechsel (gedrosselt), alle Knöpfe mit
   Beschriftung, Fokus bleibt im Leser.

## Entscheidungsfragen

- **E1** Seiten direkt aus dem Archiv streamen vs. Buch einmal in den App-Cache entpacken (Vorlage) – Messung mit
  großem CBR (RAR ist nicht wahlfrei lesbar).
- **E2** Originalbild vs. auf Bildschirmgröße skaliert (Speicher bei 6000-px-Scans, HiDPI).
- **E3** Doppelseiten (Titelseite einzeln, Querformat-Seiten als Doppelseite erkennen)?
- **E4** Leserichtung rechts → links je Buch/Kategorie?
- **E5** Lesefortschritt: Speicherort (`reading-state.json` im App-Config-Ordner), Anzeige im Grid?
- **E6** Routing: Angular-Router (Vorlage `/view/:id`) vs. Zustand im Root-Store (Desktop-App ohne URL-Leiste).

## Tests

- Rust: Seitenliste (natürlich, versteckte/`__MACOSX` aus, PNG/WebP enthalten), Eintrag streamen, Grenzen,
  Cache-Aufräumen, Abbruch beim Schließen.
- Frontend: Reader-Store (Modus, Seite, Blätter-Logik inkl. „erst scrollen, dann blättern“ als reine Funktion),
  Tastatur, Position merken.

## Akzeptanzkriterien

- [ ] CBZ mit 200 Seiten öffnet in < 500 ms die erste Seite; Blättern ohne sichtbare Ladepause.
- [ ] CBR, CB7, CBT und ein Buch mit PNG/WebP-Seiten lassen sich lesen.
- [ ] Position bleibt über einen Neustart erhalten; Zurück führt an dieselbe Grid-Stelle.
- [ ] Nach dem Lesen von 20 Büchern ist der Cache nicht unbegrenzt gewachsen.
