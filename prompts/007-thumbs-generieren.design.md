# Design 007 – Fehlende Thumbnails im Stapel erzeugen

> Status: freigegeben 23.10.2026 (Marc: „arbeite wie bisher selbstständig“ – Empfehlungen gelten als freigegeben) ·
> Branch `feat/thumbs-generieren` (auf `feat/pdf`, PDF-Cover gehören dazu) · Auftrag:
> [`007-thumbs-generieren.md`](007-thumbs-generieren.md) · Vorlage: legacy §5

## Entscheidungen auf einen Blick

| Nr. | Frage | Entscheidung |
|---|---|---|
| E1 | Wie viel Job-Engine? | **Schlank, eigen** (`jobs/`): `JobHub` mit höchstens **einem Lauf je Art**, `Control` (Abbruch, Pause mit Condvar, Zeit ohne Pausen), `Reporter` (gedrosselt ≤ 10 Ereignisse/s, letzter Stand geht nie verloren). Keine Warteschlange, keine Konflikte. Die Engine aus files-and-folders ist in dieser Sitzung nicht lesbar (nur dieser Repo-Ordner ist verbunden) – Begriffe (`Control`, `report`) wie im Auftrag |
| E2 | Automatisch oder Knopfdruck | **Nur auf Knopfdruck** (Akku, Netzlaufwerke, Marcs NAS). „Automatisch nach dem Scan, niedrige Priorität“ als Einstellung in 009 |
| E3 | Threads | **eigene Worker-Threads** (`std::thread::scope`), min(4, Kerne − 1) wie der Cover-Pool, keine neue Abhängigkeit (`rayon` lohnt für eine Schleife nicht). Damit das Grid flüssig bleibt, nehmen Job-Threads Decoder-Plätze mit **niedriger Priorität**: ein Platz der 4 bleibt immer für sichtbare Cover frei |
| E4 | Welche Bücher | je Kategorie der **Scan-Cache** (002), ohne Cache ein frischer Walk; je Buch **alle Größen** der Kategorie (`thumbsDims`) |
| E5 | Was zählt als vorhanden | Cache-Datei (Schlüssel wie 003) oder Sidecar; bleibende Fehler der Sitzung (003 `failures`) zählen als Fehler, ohne das Buch erneut zu öffnen |
| E6 | Grid sofort aktuell | `progress` trägt die zuletzt fertigen Bücher (`ready: [{categoryId, bookId}]`); das Grid vergisst deren Fehlversuche (`CoverRetries.forget`) und zeichnet neu |
| E7 | Wo in der UI | Kategorie-Menü → „Generate thumbnails…“ öffnet einen Dialog (Kategorie oder alle); solange der Job läuft, zeigt die Toolbar einen kleinen Fortschritt (Knopf öffnet den Dialog). Der Dialog darf zu sein, der Job läuft weiter |
| E8 | Restzeit | Rust schickt `elapsedMs` (ohne Pausen) und Zähler; Restzeit linear im Frontend (reine Funktion, wie die Vorlage) |

## Verträge

| Command | Parameter | Rückgabe | Fehler |
|---|---|---|---|
| `start_generate_thumbs` | `categoryIds: string[]` (leer = alle), `onEvent: Channel<JobEvent>` | `string` (Job-Id) | `job_running` (neu), `unknown_category` |
| `pause_job` | `jobId`, `paused` | `void` | – (unbekannt = vorbei) |
| `cancel_job` | `jobId` | `void` | – |

```ts
export interface ThumbsProgress {
  total: number; processed: number; generated: number;
  skipped: number;          // kein Bild im Buch (Vorlage „skippedCount“)
  errors: number; currentFile: string | null;   // relPath
  elapsedMs: number; paused: boolean;
  ready: { categoryId: string; bookId: string }[];   // seit dem letzten Ereignis fertig
}
export type JobEvent =
  | { kind: 'counting'; found: number; existing: number }
  | { kind: 'progress'; progress: ThumbsProgress }
  | { kind: 'done'; progress: ThumbsProgress; cancelled: boolean; errorList: { name: string; code: FsErrorCode }[] }
  | { kind: 'failed'; error: FsError };
```

Fehlerliste ≤ 1 000 Einträge (Name = `relPath`, Code für `describeFsError`).

## Rust

```
src-tauri/src/jobs/
  mod.rs      JobHub (ein Lauf je Art, Ids), Control (cancel, pause, elapsed), Reporter (Drosselung)
  thumbs.rs   Ablauf: Bücher je Kategorie → zählen (fehlende Paare Buch × Größe) → Worker → Ereignisse
cover/mod.rs  CoverService::status(book, dim) (vorhanden/fehlt/gemerkter Fehler), generate(book, dim)
cover/image.rs Permit::take_low (ein Decoder-Platz bleibt frei)
```

Cache-Einträge entstehen nur über `write_atomic` (003) – ein Abbruch hinterlässt keine halbe Datei; ein neuer Lauf
überspringt Fertiges.

## Tests

- Rust: Zählen/Überspringen (Cache, Sidecar), Fehler und „kein Bild“ gezählt + gelistet, Lauf geht weiter; Abbruch
  mitten im Lauf (keine `.tmp`/halben Dateien, zweiter Lauf setzt fort); Pause hält an und läuft weiter; zweiter
  Start abgelehnt; Reporter drosselt und liefert den letzten Stand; Decoder-Plätze mit niedriger Priorität.
- Frontend: Job-Store mit Fake-Kanal (counting → progress → done/cancelled/failed), Restzeit-/Dauer-Formatierung,
  Dialog (Start, Pause, Abbruch, Abschluss, Fehlerliste), Toolbar-Anzeige, Grid vergisst Fehlversuche.
- Ende-zu-Ende: 1 000 Bücher, Grid scrollen und Leser während des Laufs, Abbruch und Fortsetzen.

## Fortschritt

- [x] Phase 1 Design
- [ ] Phase 2 Rust
- [ ] Phase 3 Frontend
- [ ] Phase 4 Ende-zu-Ende
- [ ] Phase 5 Doku
- [ ] Phase 6 Review + Abschluss
