# Prompt 012: Release, Pakete und Lizenzen

> Braucht: – (sinnvoll nach 006) · Umfang: M · Branch `feat/release`
> Gemeinsame Regeln: [`000-arbeitsweise.md`](000-arbeitsweise.md).
> Übernahme aus files-and-folders-tauri (Design 017): `scripts/version.mjs` (eine Version aus `package.json`),
> `release-notes.mjs`, `licenses.mjs`, `docs/release.md`, `docs/ci/` (Workflow-Vorlagen).

## Ziel

Installierbare Pakete für macOS (universal, DMG), Windows (MSI/NSIS) und Linux (deb, rpm, AppImage) mit einer
Versionsquelle, Lizenzbericht und vorbereiteter Signierung/Notarisierung.

## Anforderungen

1. Version nur in `package.json` (`tauri.conf.json` zeigt schon dorthin), `pnpm version:check`/`version:set`,
   Release-Notes aus Conventional Commits.
2. `docs/licenses.md`: eigene MIT-Lizenz, Drittlizenzen (npm + crates, Bericht per Skript), **unRAR-Lizenz** (003 E6),
   PDF-Renderer (006) inkl. Pflichten beim Mitliefern einer Bibliothek.
3. Pakete je OS (`pnpm tauri build` mit Targets), App-Icon final (`icons/source/app-icon.svg`), Dateizuordnung
   `.cbz/.cbr/.cb7/.cbt` optional (E1: „Öffnen mit Comic Commander“ → direkt im Leser).
4. CI-Vorlagen unter `docs/ci/` (Workflows kann die Remote-Sitzung nicht schreiben – Marc übergeben): Checks je OS,
   Build-Matrix, Artefakte, Release-Entwurf.
5. `docs/release.md`: Signierung (Apple Developer ID, Notarisierung; Windows-Zertifikat) Schritt für Schritt –
   vorbereitet, nicht eingerichtet.

## Entscheidungsfragen

- **E1** Dateizuordnungen registrieren (Tauri `fileAssociations` + Öffnen-Ereignis)?
- **E2** Auto-Update (`tauri-plugin-updater`) – jetzt, später oder nie?

## Akzeptanzkriterien

- [ ] `pnpm tauri build` erzeugt unter Linux deb/rpm/AppImage; macOS/Windows über CI-Vorlage dokumentiert.
- [ ] Lizenzbericht vollständig, About zeigt Version und Lizenz.
