# Prompt 007: Fehlende Thumbnails im Stapel erzeugen (Job mit Fortschritt)

> Braucht: 003 (006 für PDF) · Umfang: M · Branch `feat/thumbs-generieren`
> Gemeinsame Regeln: [`000-arbeitsweise.md`](000-arbeitsweise.md). Vorlage: legacy §5.
> Übernahme aus files-and-folders-tauri: `jobs/` (Engine: Warteschlange, `Control` mit Abbruch/Pause, Drosselung
> `report`), soweit nötig – schlank halten.

## Ziel

Auf Wunsch alle fehlenden Cover-Thumbnails einer oder aller Kategorien im Hintergrund erzeugen, damit das Grid danach
ohne Wartezeit scrollt – mit Fortschritt, Restzeit, Pause und Abbruch, während die App bedienbar bleibt.

## Anforderungen

1. **Job-Engine** (erste Job-Art `generateThumbs`): Start liefert Job-Id, Ereignisse über `tauri::ipc::Channel`,
   Abbruch-Token, Pause, höchstens ein Lauf dieser Art gleichzeitig (Vorlage: `isProcessing`). Weitere Job-Arten
   (Duplikate 010, Cache leeren) sollen später dazukommen können.
2. **Ablauf** wie legacy §5: zuerst zählen (unbestimmter Fortschritt), dann erzeugen; Parallelität = min(4, Kerne−1)
   (Vorlage: 4), alle Größen der Kategorie; vorhandene Thumbs (Cache oder Sidecar) überspringen.
3. **Fortschritt** (`GenerateThumbsProgress` der Vorlage übernehmen): `total`, `processed`, `currentFile`,
   `errorCount`, `skippedCount` (kein Bild im Archiv), `generated`, verstrichene/geschätzte Restzeit; gedrosselt
   (≤ 10 Ereignisse/s). Fehlerliste (Name + Code) am Ende abrufbar.
4. **UI**: Dialog/Seite „Thumbnails erzeugen“ (Kategorie wählen oder alle, Start, Fortschrittsbalken, Zahlen,
   aktuelle Datei, Pause/Abbrechen, Abschlussmeldung „N Thumbnails erzeugt“), zusätzlich kleine Fortschrittsanzeige in
   der Toolbar, solange der Job läuft. Das Grid zeigt neue Cover sofort (Ereignis „thumb ready“ → Zelle neu zeichnen).
5. Optional (E2): automatisch nach jedem Scan im Hintergrund mit niedriger Priorität.

## Entscheidungsfragen

- **E1** Wie viel der files-and-folders-Job-Engine übernehmen (Warteschlange, Konflikte braucht es nicht)?
- **E2** Automatisch im Hintergrund vs. nur auf Knopfdruck (Akku, Netzlaufwerke).
- **E3** Thread-Pool: eigene Worker-Threads vs. `rayon` (neue Abhängigkeit begründen).

## Tests

- Rust: Zählen/Überspringen/Fehler/leere Archive, Abbruch mitten im Lauf (keine halben Dateien im Cache), Pause,
  zweiter Start abgelehnt, Drosselung der Ereignisse.
- Frontend: Job-Store mit Fake-Kanal (indeterminate → Fortschritt → fertig/abgebrochen), Restzeit-Formatierung als
  reine Funktion.

## Akzeptanzkriterien

- [ ] 1 000 Bücher: Lauf mit plausibler Restzeit, App bleibt flüssig bedienbar (Grid scrollt, Leser blättert).
- [ ] Abbrechen hinterlässt keinen kaputten Cache-Eintrag; erneuter Start setzt fort (überspringt Fertiges).
- [ ] Fehlerhafte Archive werden gezählt und aufgelistet, der Lauf geht weiter.
