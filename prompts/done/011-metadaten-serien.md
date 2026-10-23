# Prompt 011: Metadaten, Serien und Ordneransicht

> Braucht: 002, 004 · Umfang: M · Branch `feat/metadaten-serien` · **optional** (über die Vorlage hinaus)
> Gemeinsame Regeln: [`000-arbeitsweise.md`](../000-arbeitsweise.md). Vorlage: legacy §6 (`extractSeriesFilter`).

## Ziel

Die flache Liste aller Bücher (Vorlage) um Struktur ergänzen: **Serien** erkennen und gruppieren, **Ordner** als
Navigationsebene anbieten und **ComicInfo.xml** auswerten – ohne die schnelle flache Ansicht zu verlieren.

## Anforderungen

1. **ComicInfo.xml** (ComicRack-Standard) beim Scan bzw. bei der Cover-Erzeugung lesen (Series, Number, Volume, Title,
   Year, Writer, Publisher, PageCount, Manga) und im Scan-Cache halten.
2. **Serie und Nummer aus dem Namen** (Heuristik der Vorlage erweitert: `Serie 01 - Titel (Verlag 2015)`,
   `Serie_01_-_…`, `Serie #12`, `Serie Band 3`, `T01`) – reine Funktion mit großem Testkatalog.
3. **Ansichten**: flach (wie bisher), nach Serie gruppiert (Serien-Cover = erstes Buch, Anzahl, Lesefortschritt),
   nach Ordner (Breadcrumb, ein Ordner = eine Kachel).
4. Sortierung nach Serie + Nummer; Filter versteht `series:`/`year:` (Erweiterung der Syntax aus 004, abwärts
   kompatibel).

## Entscheidungsfragen

- **E1** XML-Parser: `quick-xml` (neue Abhängigkeit) vs. minimaler eigener Parser für die wenigen Felder.
- **E2** Gruppierte Ansicht im selben Cover-Grid (Gruppenkachel) oder eigene Ebene mit Navigation.

## Akzeptanzkriterien

- [ ] Eine Sammlung mit 3 Serien zeigt in der Serienansicht 3 Kacheln mit richtiger Anzahl; Klick öffnet die Bände in
      Nummernfolge.
- [ ] Bücher mit ComicInfo.xml zeigen Serie/Nummer aus der XML, auch wenn der Name anders lautet.
