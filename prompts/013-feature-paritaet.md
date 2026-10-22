# Prompt 013: Feature-Parität mit comiccommander

> Braucht: 002–010 · Umfang: S–M · Branch `feat/feature-paritaet`
> Gemeinsame Regeln: [`000-arbeitsweise.md`](000-arbeitsweise.md). Vorlage: `docs/legacy-analysis.md` §1–§9.

## Ziel

Nachweis, dass jede Funktion der Vorlage in der Neuauflage vorhanden, bewusst geändert oder bewusst weggelassen ist –
als Matrix mit Testbelegen; Lücken werden zu neuen Prompts.

## Anforderungen

1. `docs/feature-parity.md`: Zeile je Funktion aus legacy §2–§9 (Konfiguration, Scan + Cache, Cover-Wahl,
   Sidecar-Reihenfolge, Thumb-Größen, Filter-Syntax, Serie filtern, Overlay-Aktionen, Scrollposition, Leser-Modi und
   -Tasten, Touch, Thumbs erzeugen mit Fortschritt, Duplikate) mit Status ✅/🟡/❌/➖ (bewusst weggelassen, z. B.
   HTTP-Server, Docker, Port), Verweis auf Test oder E2E-Schritt.
2. Abweichungen aus legacy §10 je Zeile begründen.
3. Fehlendes als neue Prompts in `prompts/` anlegen und im Index einordnen.
4. Ende-zu-Ende-Durchlauf mit Marcs echter Sammlung (nur lesend!) – Messwerte (Scan, erstes Grid, Thumb-Erzeugung je
   1 000 Bücher) in `docs/architecture.md`.

## Akzeptanzkriterien

- [ ] Matrix vollständig, jede ✅-Zeile mit Beleg.
- [ ] Offene Punkte als Prompts angelegt.
