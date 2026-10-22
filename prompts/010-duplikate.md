# Prompt 010: Duplikate finden und aufräumen

> Braucht: 003, 004, 007 · Umfang: M–L · Branch `feat/duplikate`
> Gemeinsame Regeln: [`000-arbeitsweise.md`](000-arbeitsweise.md). Vorlage: legacy §8 (+ TODO „doppelte Files löschen
> (cbt/cbz -01/-1)“).
> Übernahme aus files-and-folders-tauri (Design 042): `duplicates/` (Größe → Teil-Hash → SHA-256, Hardlinks als
> Einheit, `comic.rs`-Fingerabdruck: Seitenzahl + pHash der ersten 4 Seiten, `phash.rs`), Löschen über `trash`.

## Ziel

Doppelte Comics einer Kategorie finden – **identische Dateien** und **dasselbe Buch in anderem Format/Namen**
(`Band 01.cbr` vs. `Band 1.cbz`) –, Gruppen nebeneinander mit Cover vergleichen und überzählige Exemplare sicher in den
Papierkorb legen.

## Anforderungen

1. **Suche als Job** (007-Engine): Stufe 1 identisch (Größe → Kopf/Ende-Hash → voller SHA-256, wie Vorlage SHA-256);
   Stufe 2 ähnlich (Seitenzahl + pHash Titel + 3 Seiten, Schwelle einstellbar); Stufe 3 Namensnähe (normalisierter
   Name: Endung, `-01`/`-1`/`_01`, Klammerzusätze – reine Funktion mit Katalog).
2. **Ergebnis-Ansicht**: Gruppen mit Covern (Grid aus 004 oder eigene Liste), je Exemplar Format, Größe, Seiten,
   Pfad, Datum; Vorschlag „behalten“ nach Regeln (bevorzugt CBZ, größere Auflösung, mehr Seiten, kürzerer Pfad – E1).
3. **Aufräumen**: Bestätigungsdialog mit Liste, Papierkorb als Standard, Prüfung je Datei im Backend
   (unverändert seit der Suche, nicht das letzte Exemplar einer Gruppe), danach Scan-Cache aktualisieren.

## Entscheidungsfragen

- **E1** Regel-Engine wie files-and-folders 042 (konfigurierbar) oder feste Regeln?
- **E2** Ähnlichkeit über Formate hinweg (PDF ↔ CBZ) – braucht 006.

## Tests

- Rust: identisch/Hardlink/ähnlich (gleiches Buch neu gepackt, eine Seite mehr am Ende = gleich, am Anfang =
  anders), Namensnormalisierung, Löschprüfung (geändert → abgelehnt), Papierkorb (wo im Container möglich).
- Frontend: Regel-Logik (Katalog), Auswahl/Bestätigung.

## Akzeptanzkriterien

- [ ] Test-Sammlung mit 3 Arten Duplikaten: alle Gruppen gefunden, keine falschen Treffer bei Bänden derselben Serie.
- [ ] Löschen geht in den Papierkorb, nie das letzte Exemplar; Grid aktualisiert sich.
- [ ] Review durch separaten Agenten (Löschen).
