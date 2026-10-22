# Prompt 009: Einstellungen, Farbschemata, Deutsch/Englisch

> Braucht: 004, 005, 008 · Umfang: M · Branch `feat/einstellungen`
> Gemeinsame Regeln: [`000-arbeitsweise.md`](000-arbeitsweise.md). Vorlage: legacy §9 (dunkles Theme als Default).
> Übernahme aus files-and-folders-tauri (Designs 013, 015): `settings.rs` + `settings-schema.json` (gemeinsames
> Schema Rust/TS, sanitize, `.bad`), `core/settings/`, `core/i18n/` (`translatable()`, Kataloge `*-texts.ts` +
> `*.de.ts`, Vollständigkeits-Spec), `core/theme/` (Token-Katalog, Kontrastprüfung) – gekürzt.

## Ziel

Ein Einstellungsdialog für alles, was bisher fest ist; Hell/Dunkel/System plus 1–2 Comic-taugliche Schemata; die App
spricht Deutsch und Englisch und schaltet zur Laufzeit um.

## Anforderungen

1. **Einstellungen** (Datei `settings.json`, Schema-Version, Export/Import): Sprache, Farbschema, Standard-Cover-Größe,
   Titel unter Cover, Thumb-Cache-Grenze + „Cache leeren“ (Job), Sidecars lesen/schreiben (003 E5), Leser-Defaults
   (Modus, Breite, Leserichtung, Vorausladen), Parallelität beim Erzeugen, automatische Thumb-Erzeugung (007 E2).
2. **Dialog** mit vertikalen Tabs und Suche (Vorbild files-and-folders 015), sofort wirksam, entprellt gespeichert.
3. **Farbschemata**: Tokens aus `src/styles.css` als Katalog; light, dark (Default wie Vorlage? – E1), System;
   GuiExpert-Brücke (`--ge-table-*` nur in `styles/ge-table-theme.css`). Kontraste WCAG AA geprüft (Test).
4. **i18n**: alle Texte aus Katalogen (Englisch = Quelle, Deutsch vollständig; Spec prüft Vollständigkeit); Datum/
   Zahlen mit `Intl` nach Sprache; natives Menü (008) folgt der Sprache.

## Entscheidungsfragen

- **E1** Default-Theme: dunkel (Vorlage, Cover wirken besser) vs. System.
- **E2** Eigene Schemata editierbar (Live-Editor wie files-and-folders 013) oder nur Auswahl?

## Tests

- Rust: Schema/sanitize/kaputte Datei/neuere Version, Export/Import.
- Frontend: Settings-Store (Entprellen, Rückfall auf Default), Katalog-Vollständigkeit, Kontrast-Spec, Umschalten der
  Sprache ohne Neustart.

## Akzeptanzkriterien

- [ ] Sprache und Schema wechseln sofort und überleben einen Neustart.
- [ ] Jede bisher feste Zahl (Cache-Grenze, Parallelität, Größen) ist einstellbar und wirkt.
- [ ] Keine englischen Reste in der deutschen Oberfläche (Spec + Sichtprüfung).
