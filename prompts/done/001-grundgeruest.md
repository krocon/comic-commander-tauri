# Prompt 001: Grundgerüst (Walking Skeleton)

> **Status: erledigt** (22.10.2026, Sitzung „Schritt 0“). Braucht: – · Umfang: M
> Gemeinsame Regeln: [`../000-arbeitsweise.md`](../000-arbeitsweise.md). Klein genug, um die Phasen zusammenzulegen
> (kein eigenes Design-Dokument; Entscheidungen A1–A8 in `docs/architecture.md`).

## Ziel

Ein lauffähiges, geprüftes Gerüst in der Architektur von files-and-folders-tauri, auf dem alle weiteren Prompts
aufbauen: Tauri 2 + Angular 22 (zoneless, Signals, OnPush, Standalone) + Rust – mit einem echten Durchstich vom UI über
eine typisierte Fassade bis in einen Rust-Command und zurück.

## Umfang

- Projektdateien: `package.json` (pnpm, Versionen wie files-and-folders), `angular.json` (Port 1430), `tsconfig*`,
  ESLint (angular-eslint), Prettier, `.editorconfig`, `.gitignore`, MIT-`LICENSE`.
- Rust: Crate `comic-commander-tauri` (Lib `cc_lib`), Module `error`, `model`, `paths`, `library`, `about`,
  `commands`; Capabilities nur `core:default`; strikte CSP; App-Icon aus `icons/source/app-icon.svg`.
- Commands (alle `async`): `get_app_info`, `default_library_root` (`~/Comics` oder Home), `scan_library(root)`
  (rekursiv, natürliche Sortierung, keine Symlinks, versteckte/`._`-Einträge aus, Limit 500 000, nicht lesbare
  Ordner gezählt).
- Frontend: `core/backend/call.ts` (einzige Stelle mit `invoke`, ohne Tauri → `backend_unavailable`),
  `core/errors/fs-error.ts`, Fassaden `LibraryApi`/`AboutApi`, `LibraryStore` (Signals, Request-Sequenz),
  `LibraryView` (Ordnerfeld, Scannen, Status als Live-Region, Liste ≤ 500 Zeilen), Design-Tokens light/dark.
- Tests: Rust (Pfade, Fehler-Mapping, Scan mit tempfile inkl. Unicode/Symlinks/Rechte/nicht-UTF-8, `command_rules`),
  Frontend (Fehler-Mapping, Store inkl. veralteter Antwort, View-Zustände).
- Doku: `CLAUDE.md`, `README.md`, `docs/architecture.md`, `docs/legacy-analysis.md`, `prompts/`.

## Akzeptanzkriterien

- [x] `pnpm check` grün (format, lint, test, build, rust fmt/clippy/test).
- [x] `pnpm tauri build --debug --no-bundle` baut; die App startet und listet die Bücher eines Ordners.
- [x] Ohne Tauri (`pnpm start`) erscheint ein verständlicher Hinweis statt eines Absturzes.
