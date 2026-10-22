# Prompt 008: Aktionen, Tastaturkürzel und Menüleiste

> Braucht: 004, 005 · Umfang: M · Branch `feat/aktionen-menue`
> Gemeinsame Regeln: [`000-arbeitsweise.md`](000-arbeitsweise.md). Vorlage: legacy §6, §7, §9.
> Übernahme aus files-and-folders-tauri (Designs 002 und 014): `core/actions/` (Aktionskatalog, Kürzel-Notation,
> Keymaps je OS, `ActionService`, `KeyboardDispatcher`), `features/menus/menu-model.ts`, `app_menu.rs` – auf das
> Nötige gekürzt.

## Ziel

Jede Funktion ist eine **Aktion** mit Id, Text und Kürzel je OS; Grid und Leser nutzen dasselbe System statt
verstreuter `keydown`-Handler (bis hierhin erlaubt, ab hier Regel wie in files-and-folders). Eine native Menüleiste
(macOS) bzw. HTML-Menüleiste (Windows/Linux) und ein Kontextmenü am Cover entstehen aus einem Menümodell.

## Anforderungen

1. **Aktionskatalog** (`action-catalog.ts`): Grid (Cursor, Lesen, Öffnen, Im Finder zeigen, Serie filtern, Filter
   fokussieren/leeren, Größe ±, Sortierung, nach oben/unten), Leser (weiter/zurück/Anfang/Ende, Modus, Breite,
   Vollbild, nächstes Buch, schließen), App (Kategorie wechseln 1–9, Kategorien verwalten, Thumbnails erzeugen,
   Einstellungen, About, Beenden).
2. **Keymaps je OS** als JSON (`Mod` = Cmd/Ctrl), Kontext Grid/Leser/Dialog; Override-Datei des Nutzers im
   App-Config-Ordner (Editor optional – E2).
3. **Menüleiste** nativ auf macOS (App-Menü, Ablage, Ansicht, Kategorie, Fenster, Hilfe), HTML auf Windows/Linux –
   ein Modell, Kürzel aus den Keymaps; Zustände (aktiviert/abgehakt) live.
4. **Kontextmenü** am Cover (ersetzt/ergänzt das Overlay aus 004) nach APG-Muster.
5. **Befehlspalette** (`Mod+Shift+P`) mit Suche über alle Aktionen – E1.
6. About-Dialog (`get_app_info`, Version, Plattform, Lizenz).

## Entscheidungsfragen

- **E1** Befehlspalette jetzt oder später?
- **E2** Kürzel-Editor im UI oder nur Override-Datei?
- **E3** Wie viel aus files-and-folders übernehmen (dort: Modifier-Sätze der Button-Leiste, TC-Auswahl – hier nicht
  nötig)?

## Tests

- Kürzel-Notation/Parser, Keymap-Auflösung je OS und Kontext, Menümodell (rein), Dispatcher (Fokus in Eingabefeld →
  keine Aktion außer `Esc`), Rust: Validierung des Menü-Specs.

## Akzeptanzkriterien

- [ ] Alle bisherigen Tastenfunktionen laufen über Aktionen; kein `HostListener('document:keydown…')` mehr.
- [ ] macOS-Menüleiste nativ, Windows/Linux HTML; Kürzel stimmen je OS.
- [ ] Kontextmenü am Cover per Maus und Tastatur (`Shift+F10`/Menütaste).
