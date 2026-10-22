# Prompt 000: Gemeinsame Arbeitsweise für alle Feature-Prompts

> Gilt für alle Prompts in `prompts/` (Index und Reihenfolge: `prompts/README.md`). Jeder Feature-Prompt verweist
> hierher und beschreibt nur, was für sein Feature dazukommt. **Zuerst diese Datei lesen, dann den Feature-Prompt.**
> Bei Widersprüchen gilt diese Datei, außer der Feature-Prompt weicht ausdrücklich ab.
> Übernommen und angepasst aus files-and-folders-tauri (`prompts/000-arbeitsweise.md`).

---

## 1. Vor dem Start

- `CLAUDE.md` vollständig lesen, dazu `docs/architecture.md` und die im Feature-Prompt genannten Abschnitte aus
  `docs/legacy-analysis.md` („legacy §N“, Vorlage comiccommander). Der Quellcode der Vorlage liegt auf Marcs Mac unter
  `~/WebstormProjects/comiccommander` (in Remote-Sitzungen per `device_bash` lesen).
- Nennt der Prompt Code aus **files-and-folders-tauri** zum Übernehmen: dort zuerst das Design-Dokument
  (`prompts/done/NNN-*.design.md`, Abschnitte „Entscheidungen“/„Verträge“) und die Modulköpfe lesen, dann nur das
  Nötige übernehmen – mit Herkunftsvermerk und Tests (CLAUDE.md §8).
- **Abhängigkeiten prüfen:** Jeder Prompt nennt oben, welche Prompts vorher umgesetzt sein sollten
  (`prompts/README.md` → Status). Fehlt etwas: anhalten und fragen.
- Prüfen, ob es schon einen Stand gibt (Branch `feat/<slug>`, Design-Dokument, abgehakte Definition of Done).
- Toolchain prüfen (`node -v` ≥ 22.22.3, `pnpm -v`, `cargo -V`), `pnpm install`, einmal `pnpm check` – rote Checks
  vor dem Start sind ein eigener Befund, nicht stillschweigend „mitreparieren“.
- Branch **`feat/<slug>`** von `main`. Commits nach jeder grünen Phase (Conventional Commits). Pushen ist erlaubt;
  kein Release, kein Force-Push ohne ausdrückliche Anweisung.
- Taskliste mit einem Eintrag je Phase führen.

## 2. Phasen

| Phase | Ergebnis | Haltepunkt |
|---|---|---|
| 1 | Design-Dokument `prompts/NNN-<slug>.design.md` | 🛑 Freigabe abwarten |
| 2 | Rust: Specs zuerst (rot), dann Implementierung (grün) | Commit |
| 3 | Frontend: Specs zuerst, dann Implementierung | Commit |
| 4 | Ende-zu-Ende in der echten App | |
| 5 | Doku | Commit |
| 6 | Abschlussprüfung + Bericht | |

Kleine Features dürfen Phasen zusammenlegen (in Phase 1 entscheiden und im Design-Dokument festhalten). Reine
Frontend-Features lassen Phase 2 aus.

### Phase 1 – Bestand prüfen und entwerfen 🛑

- Die im Prompt genannten Code-Stellen lesen (eigenes Repo, Vorlage comiccommander, ggf. files-and-folders-tauri und
  – bei Grid-Themen – die GuiExpert Table im Mono-Repo, `CLAUDE.md` §5). Tabelle „Baustein → wofür → passt / fehlt /
  muss erweitert werden / wird übernommen aus …“.
- Verhalten der Vorlage aus `docs/legacy-analysis.md` übernehmen oder **begründet** abweichen (Desktop statt Server,
  moderne Plattform-Konventionen, Sicherheit, Lücken aus legacy §10).
- Für jede Entscheidungsfrage im Prompt: Optionen, Empfehlung, Begründung.
- **Verträge zuerst:** Rust-Commands (Name, Parameter, Rückgabe, Fehlercodes, Events/Channels, URI-Schema) und die
  passenden TS-Typen; Tastenkürzel je OS; UI-Skizze (ASCII reicht) mit Fokus-Reihenfolge und ARIA-Rollen.
- Tests planen: welche Fälle in Rust, welche im Frontend, welche nur Ende-zu-Ende. Testdateien (Archive, Bilder, PDF)
  klein halten und per Generator erzeugen, wo möglich.
- Ergebnis als `prompts/NNN-<slug>.design.md` (Kopf: Status, Datum, Entscheidungen E1…; unten Abschnitt
  „Fortschritt“ für Sitzungswechsel). **Danach anhalten** und bestätigen lassen.

### Phase 2 – Rust

- Logik in reinen Modulen ohne Tauri (testbar), Command-Schicht dünn (`commands.rs` bzw. `commands/<bereich>.rs`),
  Commands `async` (Test `command_rules`).
- Tests mit `tempfile`: Normalfall, Unicode/Leerzeichen/Umlaute/Emoji, Symlinks, fehlende Rechte (als root nicht
  prüfbar → bedingt testen), kaputte und feindliche Eingaben (Archive, Bilder), Abbruch mitten in der Operation, große
  Mengen. Plattformspezifisches mit `#[cfg(...)]`; Pfade nur über `std::path`.
- Lange Arbeit: Job mit Fortschritt (`tauri::ipc::Channel`), Abbruch-Token, nie auf dem Async-Runtime-Thread
  blockieren.
- `cargo fmt`, `cargo clippy --all-targets -D warnings`, `cargo test` grün → Commit.

### Phase 3 – Frontend

- Backend nur über die typisierte Fassade (`app/core/...Api`), Fake-Implementierung für Tests in `src/testing/`.
- Zustand mit Signals; Stores je Ansicht (kein `providedIn: 'root'`), Globales in Root-Services. `OnPush`, zoneless.
- Tastatur über das Aktionssystem (ab Prompt 008), vorher über einen zentralen Handler je Ansicht – nie verstreute
  `keydown`-Handler in Kind-Komponenten.
- **Barrierefreiheit:** sichtbarer Fokus, jede Funktion per Tastatur, Dialoge mit `role="dialog"`/`aria-modal`,
  Fokusfalle und Rückgabe des Fokus, Live-Region für Statusmeldungen, Kontraste in light und dark.
- Texte zentral in `*-texts.ts` (ab Prompt 009 übersetzt). Dateinamen sind Nutzerdaten: nie unescaped in `innerHTML`.
- Styling nur über Tokens aus `src/styles.css` (neue Tokens dort für light **und** dark ergänzen).
- `pnpm format:check`, `pnpm lint`, `pnpm test`, `pnpm build` grün → Commit.

### Phase 4 – Ende-zu-Ende

- Die App wirklich starten (`pnpm tauri dev`; im Container Debug-Build + Xvfb, s. `CLAUDE.md` §9) und jedes
  Akzeptanzkriterium des Prompts durchspielen – mit einer Test-Sammlung, die Umlaute, Leerzeichen, Emoji, tiefe
  Ordner, kaputte Archive, falsche Endungen (CBR, das ZIP ist), PNG/WebP-Seiten und PDF enthält.
- Nie in echten Nutzerdaten schreiben oder löschen; eigene Testordner anlegen.
- Nicht Prüfbares (z. B. macOS-Papierkorb aus dem Linux-Container) im Bericht ausdrücklich nennen.

### Phase 5 – Doku

- `docs/architecture.md` (Entscheidungen, Commands, neue Abhängigkeiten mit Begründung), README („Was
  funktioniert“, Tastenkürzel), `CLAUDE.md`, wenn sich Regeln, Befehle oder Layout geändert haben.
- Im Prompt-Index `prompts/README.md` den Status abhaken; Design-Dokument „Fortschritt“ abschließen.
- **Fertige Prompts nach `prompts/done/` verschieben** (Auftrag, `*.design.md`, Bilder; `git mv`, Links im Index
  umstellen) – in `prompts/` liegen nur offene Prompts.

### Phase 6 – Abschlussprüfung

```bash
pnpm check
pnpm tauri build --debug --no-bundle
```

Danach Ende-zu-Ende-Durchlauf (Phase 4) wiederholen. Bei Archiv-/Bild-/PDF-Parsing, Löschen und allem
Sicherheitsrelevanten: Review durch einen separaten Agenten, der den Code nicht geschrieben hat (Schwerpunkte nennt der
Feature-Prompt).

**Abschlussbericht** (kurz, konkret): Was wurde geändert? Welche Dateien? Welche Befehle liefen tatsächlich? Welche
Checks grün? Welche Probleme/Einschränkungen (inkl. nicht getesteter Plattformen)? Nächster Schritt? Commits (Hash +
Titel). Gefundene Lücken in der GuiExpert Table mit Vorschlag für das Mono-Repo.

## 3. Definition of Done (zusätzlich zu der des Feature-Prompts)

- [ ] Design-Dokument freigegeben 🛑
- [ ] Rust- und Frontend-Specs grün, `pnpm check` grün, Debug-Build der App gebaut
- [ ] Akzeptanzkriterien Ende-zu-Ende geprüft (Test-Sammlung mit Unicode, kaputten Archiven, PDF)
- [ ] Tastaturbedienung und Fokus geprüft, light und dark angesehen
- [ ] Doku aktuell, Prompt-Status abgehakt, Prompt nach `done/` verschoben
- [ ] Commits auf `feat/<slug>`, gepusht (oder Bundle übergeben)
