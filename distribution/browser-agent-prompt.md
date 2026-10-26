# Prompt für Claude Browser: Distribution von Comic Commander

> So benutzen: den Abschnitt ab **„— PROMPT BEGINNT —“** vollständig in eine neue Sitzung von Claude im Browser
> (Claude in Chrome oder der eingebaute Browser der Claude-App) kopieren. Voraussetzung: der Ordner `distribution/`
> ist auf `main` von `krocon/comic-commander-tauri` gepusht (der Agent liest die Manifeste dort im Browser).
> Erstellt am 26.10.2026 für Release **v1.0.1**. Für ein neues Release zuerst `distribution/facts.json` und die
> Manifeste aktualisieren (`distribution/README.md`).

---

— PROMPT BEGINNT —

# Auftrag: Comic Commander bei Paketmanagern, Software-Verzeichnissen und Discovery-Plattformen eintragen

Du arbeitest im Browser für **Marc Kronberg**, den Entwickler von **Comic Commander**. Du trägst Comic Commander bei
geeigneten Plattformen ein bzw. bereitest die Einträge so weit vor, dass Marc nur noch das tun muss, was ein Browser
nicht kann. Ziel sind **wenige, aber hochwertige, dauerhaft funktionierende Einträge** – nicht möglichst viele.

Arbeite sequenziell, Plattform für Plattform. Halte nach jeder Aktion den tatsächlichen Stand fest. Melde nie einen
Erfolg, den du nicht auf der Plattform selbst gesehen hast (Bestätigungsseite, PR-Nummer, Eintrags-URL).

## 1. Unverrückbare Regeln

1. **Nichts erfinden.** Funktionen, Plattformen, Versionen, Lizenz, Download-URLs, Prüfsummen, Nutzerzahlen,
   Auszeichnungen, Zitate – nur aus den Quellen in Abschnitt 2. Was dort fehlt, ist **unbekannt** und wird weggelassen
   oder als offen gemeldet.
2. **Nur offizielle Einreichungswege** (Formular der Plattform, Pull Request im offiziellen Repository, Developer-
   Konsole). Keine angeblichen Ein-Klick-Wege, keine Drittanbieter-„Submission-Services“, keine bezahlten Listungen.
3. **Keine Duplikate.** Vor jeder Einreichung auf der Plattform nach „Comic Commander“, „ComicCommander“,
   „comic-commander“ und „krocon“ suchen; bei Paket-Repos zusätzlich offene und geschlossene PRs/Issues durchsuchen.
   Gefunden → Status `DUPLIKAT_VORHANDEN`, Link festhalten, nichts ändern.
4. **Sicherheit:** Captchas, MFA, Login und Sicherheitswarnungen nie umgehen; Passwörter, Tokens, API-Keys nie
   anzeigen, kopieren oder eintippen. Ist ein Login nötig → anhalten, Marc bitten, sich anzumelden, danach weiter.
5. **Persönliche Daten:** Öffentlich nur „Marc Kronberg“, https://krocon.de/ und die GitHub-Issues als Kontakt.
   **Keine E-Mail-Adresse, Postanschrift oder Telefonnummer** in öffentliche Felder. Verlangt ein Formular eine
   E-Mail für die Rückmeldung (nicht öffentlich), frage Marc, welche Adresse du nehmen darfst.
6. **Keine blinden Wiederholungen.** Schlägt etwas fehl: Fehlermeldung lesen, Ursache bestimmen, beheben (nur mit
   belegten Angaben), höchstens **ein** weiterer Versuch. Danach `BLOCKIERT` mit Ursache.
7. **Vorbereitet ≠ eingereicht.** Ein ausgefülltes, nicht abgeschicktes Formular ist `VORBEREITET`. Ein abgeschicktes
   ist `EINGEREICHT`, erst eine sichtbare Freischaltung ist `VERÖFFENTLICHT`.
8. **Inhalt rechtlich sauber halten:** Comic Commander ist für rechtmäßig besessene Comics. Keine Portale, Foren oder
   Subreddits mit Bezug zu Raubkopien/„Piracy“/Scanlation-Downloads, keine Formulierungen in diese Richtung.

## 2. Quellen und Fakten (Stand v1.0.1)

Lies zuerst diese Seiten im Browser und gleiche ab. Weicht etwas von der Tabelle ab, gilt die Quelle – dann den
Unterschied im Bericht nennen.

| Quelle | URL |
|---|---|
| Produktseite (maßgeblich für Features) | https://krocon.de/products/comiccommander/ |
| Repository | https://github.com/krocon/comic-commander-tauri |
| Release v1.0.1 (Pakete, Prüfsummen) | https://github.com/krocon/comic-commander-tauri/releases/tag/v1.0.1 |
| **Faktendatei** | https://github.com/krocon/comic-commander-tauri/blob/main/distribution/facts.json |
| **Eintragstexte EN/DE, Tags, Kategorien** | https://github.com/krocon/comic-commander-tauri/blob/main/distribution/listing.md |
| **Manifeste** | https://github.com/krocon/comic-commander-tauri/tree/main/distribution/manifests |
| Rohdateien (zum Kopieren) | `https://raw.githubusercontent.com/krocon/comic-commander-tauri/main/distribution/<pfad>` |

Kernfakten (aus Release-API, Paketen und Produktseite am 26.10.2026 geprüft):

- **Name:** Comic Commander (mit Leerzeichen) · **Version:** 1.0.1 (Tag `v1.0.1`, veröffentlicht 25.10.2026, kein
  Pre-release) · **Lizenz:** MIT (mitgelieferte Drittteile inkl. unRAR-Quellen: `THIRD-PARTY-NOTICES.txt`) ·
  **Preis:** kostenlos, Open Source · **Autor/Publisher:** Marc Kronberg · **Technik:** Tauri 2, Rust, Angular.
- **Plattformen:** macOS ≥ 12 (universal: Apple Silicon + Intel, `.dmg`) · Windows 10/11 x64 (NSIS-`setup.exe` pro
  Nutzer, `.msi` pro Rechner; braucht WebView2) · Linux x86_64 mit WebKitGTK 4.1 (`.deb`, `.rpm`, `.AppImage`).
  Keine ARM-Builds für Windows/Linux.
- **Signierung:** **keine** (macOS weder signiert noch notarisiert, Windows unsigniert). Das blockiert manche
  Plattformen (s. Abschnitt 4).
- **Oberfläche:** Englisch (Deutsch geplant, nicht vorhanden).
- **Downloads (stabil, versioniert):**

| Paket | URL | SHA-256 |
|---|---|---|
| macOS dmg | https://github.com/krocon/comic-commander-tauri/releases/download/v1.0.1/Comic.Commander_1.0.1_universal.dmg | `943aa9c06d385423ea9e9884429d215041ca82f3f953cdff06177b2f28d17bdc` |
| Windows setup.exe | https://github.com/krocon/comic-commander-tauri/releases/download/v1.0.1/Comic.Commander_1.0.1_x64-setup.exe | `1f4baa5c529b5b615b0cc0ae66b47f1cd61c8c57f6c27d65b1debe7ca374d197` |
| Windows msi | https://github.com/krocon/comic-commander-tauri/releases/download/v1.0.1/Comic.Commander_1.0.1_x64_en-US.msi | `f5dc02010f1a27d270b7b0de5893f9bed4ef9a5036203b6b00970ec787035215` |
| Linux deb | https://github.com/krocon/comic-commander-tauri/releases/download/v1.0.1/Comic.Commander_1.0.1_amd64.deb | `f7ecb25bde57031e1695e86a7a3fe2452be1d51d1e945b9fbe67ac03f88de4e6` |
| Linux rpm | https://github.com/krocon/comic-commander-tauri/releases/download/v1.0.1/Comic.Commander-1.0.1-1.x86_64.rpm | `b7ef7621928c5f89fe13764713ed62812a4bcb05fe2240c1b3f62344268ce40a` |
| Linux AppImage | https://github.com/krocon/comic-commander-tauri/releases/download/v1.0.1/Comic.Commander_1.0.1_amd64.AppImage | `eb365bd80421a6da76add696b295b6ac04c50a83bbf15f91c7209921d601914a` |

  Für Verzeichnisse, die nur einen Download-Link wollen: **https://github.com/krocon/comic-commander-tauri/releases**
  (bleibt bei neuen Versionen gültig). Für Paketmanager immer die versionierten URLs oben.
- **Bilder:** Icon https://raw.githubusercontent.com/krocon/comic-commander-tauri/main/src-tauri/icons/icon.png ·
  Screenshots https://krocon.de/products/comiccommander/img/grid.png (Cover-Wand), …/img/shelf.png (Regal),
  …/img/view.png (Leser). Jede Bild-URL einmal öffnen und prüfen, dass sie lädt. Lädt ein Formular nur Dateien
  hoch: Marc bitten, die Datei bereitzustellen (Phase 4, Hochladen).
- **Kontakt öffentlich:** https://github.com/krocon/comic-commander-tauri/issues

## 3. Statusmodell und Arbeitsliste

Führe von Anfang an eine Tabelle (im Chat, nach jeder Plattform aktualisiert) mit den Spalten:

`# | Plattform | Kategorie | Einreichungs-URL | Methode | Voraussetzungen | Account nötig | Kosten | Dateien/Metadaten | Status | Nächste Aktion | Nutzen (H/M/N) | Begründung | Beleg-Link`

**Methoden:** `FORMULAR` (Webformular) · `PR-WEB` (Pull Request über die GitHub-Weboberfläche) · `REPO-NÖTIG`
(eigenes neues Repository nötig, z. B. Tap/Bucket) · `BUILD-SYSTEM` (externer Build/Store-Upload, z. B. Snapcraft,
Flathub-Build, Chocolatey-Push) · `CLI-NÖTIG` (nur per Kommandozeile/SSH, Browser reicht nicht) · `POST` (Community).

**Status:** `NEU` → `RECHERCHIERT` → `VORBEREITET` → `WARTET_AUF_MARC` → `EINGEREICHT` → `IN_PRÜFUNG` →
`VERÖFFENTLICHT`; außerdem `ABGELEHNT` (mit Grund), `BLOCKIERT` (mit Blocker), `UNGEEIGNET` (mit Begründung),
`DUPLIKAT_VORHANDEN` (mit Link).

**Entscheidungsregeln für Aufnahme:**

- Plattform aktiv? (letzte Einträge/Commits/Antworten der Moderation aus den letzten 6 Monaten; auf der Seite selbst
  prüfen, nicht aus Suchergebnissen.) Nein → `UNGEEIGNET`.
- Passt das Produkt? (Desktop-App, kostenlos, Open Source, die angebotenen OS.) Nein → `UNGEEIGNET`.
- Technische Voraussetzung erfüllt? (Signierung, Architektur, Build aus Quellen, Bekanntheitsschwellen wie Stars.)
  Nein → `BLOCKIERT` mit genauer Anforderung und Quelle (Link auf die Regel).
- Kostet etwas? → nur mit Freigabe (Abschnitt 6), sonst `WARTET_AUF_MARC`.
- Priorität = Reichweite × Relevanz × Erfolgsaussicht ÷ Aufwand. Reihenfolge innerhalb von Abschnitt 4 einhalten,
  außer eine Prüfung ergibt etwas anderes (dann begründen).

## 4. Plattforminventar mit Vorbewertung

Die Vorbewertung stammt aus einer Recherche vom 26.10.2026. **Prüfe jede Zeile auf der Plattform selbst** (Regeln,
Formular, Aktivität) und korrigiere sie, wenn sie nicht mehr stimmt.

### 4.1 Vorarbeit (zuerst)

| Plattform | Methode | Vorbewertung |
|---|---|---|
| GitHub-Repo `krocon/comic-commander-tauri` | Einstellungen | **Description, Website und Topics sind leer.** Viele Kuratoren und Verzeichnisse lesen sie. Vorschlag: Description = Kurzbeschreibung EN aus `listing.md`; Website = Produktseite; Topics = `comic-reader comics manga cbz cbr pdf tauri rust angular desktop-app macos windows linux`. Öffentliche Änderung → **Freigabe A** (Abschnitt 6). |

### 4.2 Paketmanager

| # | Plattform | Methode | Vorbewertung | Vorbereitete Datei |
|---|---|---|---|---|
| P1 | **WinGet** (microsoft/winget-pkgs) | PR-WEB | geeignet. Unsignierte Installer sind zulässig, die Validierung prüft aber mit Defender/SmartScreen. Identifier `MarcKronberg.ComicCommander`. Microsoft-CLA wird im PR verlangt → **Freigabe C**. | `manifests/winget/manifests/m/MarcKronberg/ComicCommander/1.0.1/` (3 Dateien) |
| P2 | **Scoop** – Bucket `ScoopInstaller/Extras` | PR-WEB | wahrscheinlich geeignet (GUI-Apps gehören nach Extras). Aufnahmekriterien in `CONTRIBUTING.md` des Buckets lesen (Bekanntheit!). Bei Ablehnungsrisiko: eigener Bucket `krocon/scoop-bucket` → neues Repo → **Freigabe B**. | `manifests/scoop/comic-commander.json` |
| P3 | **AUR** (`comic-commander-bin`) | CLI-NÖTIG | geeignet, Binärpaket aus dem .deb. Account-Anlage geht im Browser (aur.archlinux.org/register), das Hochladen nur per `git push` über SSH → Marc. Prüfe, dass der Name frei ist. | `manifests/aur/comic-commander-bin/PKGBUILD`, `.SRCINFO` |
| P4 | **AppImageHub** (AppImage/appimage.github.io) | PR-WEB | wahrscheinlich geeignet: neue Datei `data/ComicCommander` mit der Releases-URL. Die CI dort startet das AppImage auf einer älteren Distribution – kann an WebKitGTK 4.1 scheitern; dann CI-Log lesen und als `BLOCKIERT` melden. README/Regeln des Repos zuerst lesen. | `manifests/appimagehub/ComicCommander` |
| P5 | **Chocolatey** Community | BUILD-SYSTEM / CLI-NÖTIG | geeignet, aber das Paket wird per `choco push` mit API-Key hochgeladen; prüfe, ob die Website heute noch einen Upload im Browser anbietet. Moderation prüft das Paket, Wochen Laufzeit. Account im Browser möglich; API-Key nie anzeigen. | `manifests/chocolatey/comic-commander/` (`.nuspec`, `tools/chocolateyinstall.ps1`; Platzhalter `{{CHOCOLATEY_USERNAME}}`) |
| P6 | **Homebrew Cask** – offizieller Tap | PR-WEB | **BLOCKIERT**: Homebrew verlangt seit 2025, dass Casks Gatekeeper bestehen (signiert + notarisiert); unsignierte Casks werden bis September 2026 aus dem offiziellen Tap entfernt. v1.0.1 ist unsigniert. Regel auf https://docs.brew.sh/Acceptable-Casks nachlesen und zitieren. | `manifests/homebrew/comic-commander.rb` |
| P6b | Homebrew – eigener Tap `krocon/homebrew-tap` | REPO-NÖTIG | möglich, aber Nutzer müssen die unsignierte App selbst freigeben. Nur mit **Freigabe B**; sonst `WARTET_AUF_MARC`. | dieselbe `.rb` unter `Casks/` |
| P7 | **Flathub** | PR-WEB + BUILD-SYSTEM | grundsätzlich geeignet (App-ID `io.github.krocon.comiccommander` passt zum GitHub-Konto, Verifizierung über GitHub). Flathub erwartet bei Open Source in der Regel einen Build aus den Quellen (Cargo- und Node-Quellen offline); der Entwurf nutzt das .deb und ist **nur für lokale Tests**. Einreichung = PR gegen `flathub/flathub` (Branch `new-pr`) – erst nach lokalem Build durch Marc → `VORBEREITET`, Status `WARTET_AUF_MARC`. Aktuelle Anforderungen unter https://docs.flathub.org/docs/for-app-authors/requirements lesen. | `manifests/flathub/io.github.krocon.comiccommander.yml`, `.metainfo.xml` |
| P8 | **Snap Store** | BUILD-SYSTEM | möglich: Name `comic-commander` auf snapcraft.io im Browser registrieren (Account nötig, **Freigabe C** für die Bedingungen), Bauen/Hochladen per snapcraft-CLI oder Launchpad → Marc. Prüfe, ob snapcraft.io heute noch „Build from GitHub“ anbietet. | `manifests/snap/snapcraft.yaml` (Entwurf, ungetestet) |
| P9 | MacPorts | PR-WEB | **UNGEEIGNET vorerst**: Ports bauen aus den Quellen; ein Tauri-Build mit pnpm und Rust ohne Netz im Build-Schritt ist aufwendig, ein Binär-Port aus der unsignierten .dmg unüblich. Im Bericht als „später, nach Signierung prüfen“ führen. | – |
| P10 | Debian/Ubuntu-Archiv | – | **UNGEEIGNET**: braucht Sponsor/Debian-Maintainer, Build aus Quellen mit paketierten npm-/Rust-Abhängigkeiten; der unRAR-Anteil ist nicht DFSG-frei (höchstens `non-free`). | – |
| P11 | Fedora-Repos | – | **UNGEEIGNET**: Fedora lässt unRAR-Code nicht zu (nicht freie Lizenz). Alternative Copr nur nach Prüfung der Copr-Regeln zu Binärpaketen; sonst nicht. | – |
| P12 | Microsoft Store | BUILD-SYSTEM | **BLOCKIERT**: Win32-Installer (MSI/EXE) müssen mit einem Zertifikat signiert sein, das Microsoft vertraut. Erst nach Windows-Signierung. Regel nachlesen und verlinken. | – |
| P13 | Mac App Store | – | **UNGEEIGNET**: verlangt App-Sandbox und Apple-Entwicklerprogramm; die App ist nicht sandboxed. | – |

### 4.3 Software-Verzeichnisse

Für jedes: Richtlinie für neue Software lesen, Duplikat prüfen, Formular ausfüllen. Kategorie wählen, unter der
dort andere Comic-Reader stehen. Texte aus `listing.md` (EN; deutsche Portale DE).

| # | Plattform | Einstieg | Vorbewertung |
|---|---|---|---|
| V1 | **AlternativeTo** | https://alternativeto.net/ → „Add an app“ (Login) | hoch: Nutzer suchen dort „Alternative zu ComicRack/YACReader/CDisplayEx“. Plattformen, Lizenz „Open Source“, „Free“, Tags. Als Alternative nur zu Programmen eintragen, die dort als Comic-Reader geführt sind. |
| V2 | **SourceForge** | https://sourceforge.net/ → Create a project / GitHub-Import | mittel: Projekt mit Spiegelung der GitHub-Releases. Erstellt ein neues öffentliches Projekt in Marcs Namen → **Freigabe B**. |
| V3 | **Softpedia** | „Submit program“ auf https://www.softpedia.com/ (Windows, Mac, Linux getrennt) | mittel: kostenloses Formular. Prüfe, ob sie unsignierte Software mit einem Hinweis listen. |
| V4 | **MacUpdate** | Developer-Bereich auf https://www.macupdate.com/ | mittel: Mac-only. Prüfe Kosten (früher gab es kostenpflichtige Developer-Angebote → nur kostenlose Option). |
| V5 | **FileHorse** | „Submit Software“ auf https://www.filehorse.com/ | mittel, Windows/Mac. |
| V6 | **Uptodown** | Developer-Konsole auf https://www.uptodown.com/ | mittel; prüfe, ob Desktop-Apps (Windows/Mac) eingereicht werden können und ob Uptodown die Datei selbst hostet (Download-URL dann von dort; Prüfsumme gleich?). |
| V7 | **MajorGeeks** | Kontakt/Submit auf https://www.majorgeeks.com/ | niedrig–mittel, Windows; oft nur per E-Mail → dann `WARTET_AUF_MARC` mit fertigem Text. |
| V8 | **SaaSHub** | https://www.saashub.com/ → Submit | niedrig–mittel (auch Desktop-Software). Keine kostenpflichtige „Featured“-Option. |
| V9 | **FossHub** | Bewerbung auf https://www.fosshub.com/ | niedrig: richtet sich an etablierte Projekte mit eigenem Hosting-Bedarf. Kriterien prüfen; voraussichtlich `UNGEEIGNET` (zu neu). |
| V10 | **CHIP.de** (Download-Bereich) | Software-Einreichung für Hersteller (auf chip.de suchen) | mittel für DE, deutsche Texte. |
| V11 | **heise Download** | „Software melden/einreichen“ (auf heise.de/download suchen) | mittel für DE. |
| V12 | **Softonic** | Developer-/Publisher-Bereich | niedrig; prüfen, ob eigene Installer-Wrapper verwendet werden – **dann ablehnen** (`UNGEEIGNET`, Begründung: kein Wrapper um Marcs Installer). |
| V13 | **Neowin Software** / **TechSpot Downloads** | jeweilige Submit-Seite | niedrig; nur, wenn ein Formular ohne Kosten existiert. |
| V14 | **LinuxLinks** | https://www.linuxlinks.com/ (Kontakt/Submit) | niedrig–mittel für Linux. |

Allgemeine Regel für Verzeichnisse: Nur kostenlose Grundeinträge; keine „Featured“, „Express-Review“, „Sponsored“.
Ein Portal, das Software nur mit eigenem Downloader/Installer-Wrapper ausliefert, ist `UNGEEIGNET`.

### 4.4 Kuratierte Listen (GitHub)

Je Liste: `CONTRIBUTING.md` lesen (Kriterien, Format, Sortierung, Mindest-Stars), Duplikat prüfen, PR über die
Weboberfläche (Fork → Datei bearbeiten → PR). Eine Zeile im Stil der Liste, keine Werbesprache.

| # | Liste | Vorbewertung |
|---|---|---|
| L1 | `tauri-apps/awesome-tauri` | hoch: Abschnitt „Applications“; Tauri-App passt genau. |
| L2 | `serhii-londar/open-source-mac-os-apps` | mittel: Kategorie „Graphics“ o. ä.; Sprachen-Badges (Rust, TypeScript) laut Liste. |
| L3 | `jaywcjlove/awesome-mac` | mittel: Kennzeichnung „Open Source“ und „Free“ nach den Regeln der Liste. |
| L4 | `rust-unofficial/awesome-rust` | prüfen: hat Mindestkriterien (Stars/Downloads). Werden sie nicht erreicht → `BLOCKIERT` mit Kriterium. |
| L5 | Listen für Comic-/Manga-Reader | suchen (z. B. GitHub-Suche „awesome comic reader“, „awesome manga“): nur aktiv gepflegte Listen ohne Piracy-Bezug. |

### 4.5 Launch und Community (getrennt behandeln – das sind keine Pakete)

Jeder öffentliche Beitrag erscheint in Marcs Namen → **immer Freigabe D** mit dem fertigen Text, vorher nichts
posten. Regeln der Community zur Eigenwerbung vorher lesen und im Bericht verlinken.

| # | Plattform | Vorbewertung |
|---|---|---|
| C1 | **Show HN** (news.ycombinator.com) | mittel–hoch für Entwickler; Entwurf in `listing.md`. Nur Marc selbst darf posten (eigener Account, HN-Regeln: Show HN für etwas, das man selbst gemacht hat und das man ausprobieren kann). Du bereitest Titel + Text vor. |
| C2 | **Product Hunt** | mittel; Launch braucht Vorbereitung (Bilder, Maker-Profil, Termin). Nur vorbereiten, Termin mit Marc. |
| C3 | Reddit: r/macapps, r/opensource, r/rust (Selbstgebautes), r/tauri, r/comicbooks, r/manga, r/linux | einzeln Regeln prüfen (Selbstwerbung, Flair, Wochen-Threads). Wo Eigenwerbung verboten ist → `UNGEEIGNET`. |
| C4 | Tauri-Community (Discord „showcase“, GitHub Discussions von tauri-apps) | niedrig–mittel; nur mit Freigabe D. |

## 5. Ablauf

### Phase 1 – Bestandsaufnahme (≈ 15 min)

1. Produktseite, Repository, Release v1.0.1, `facts.json` und `listing.md` öffnen (Abschnitt 2).
2. Prüfe: Name, Beschreibung, Features, OS, Lizenz, Version, Release-Assets und Prüfsummen (auf der Release-Seite
   steht je Asset ein `sha256:`), Signierstatus, Bild-URLs, Kontakt. Notiere Abweichungen.
3. Prüfe: Gibt es eine neuere Version als 1.0.1? Dann **anhalten**: Manifeste passen nicht mehr → Marc bitten,
   `distribution/` zu aktualisieren (oder nur Verzeichnisse mit der allgemeinen Releases-URL bearbeiten).
4. Ergebnis: kurze Faktenliste im Chat, Spalte „unbekannt“ für Fehlendes.

### Phase 2 – Inventar und Priorisierung (≈ 30–60 min)

1. Jede Zeile aus Abschnitt 4 auf der Plattform selbst prüfen: aktiv? Einreichungsweg? Kosten? Regeln (Link)?
   Duplikat?
2. Weitere seriöse, aktive Portale ergänzen, die du dabei findest (höchstens 5, jeweils mit Begründung).
3. Arbeitsliste (Abschnitt 3) vollständig ausfüllen, nach Priorität sortieren.
4. **Sammel-Freigabe:** Stelle Marc *eine* Liste mit allen Freigaben, die du absehbar brauchst (Abschnitt 6), mit
   je einer Zeile Begründung und dem genauen Text/den Daten, die veröffentlicht würden. Arbeite in der Zwischenzeit
   an allem weiter, was keine Freigabe braucht.

### Phase 3 – Einträge vorbereiten

1. Texte aus `listing.md`, Fakten aus `facts.json`, Manifeste aus `distribution/manifests/`. Nicht umformulieren,
   was belegt ist; nur an Längengrenzen der Formulare anpassen (kürzen, nicht ergänzen).
2. Prüfe vor jeder PR-Einreichung das Manifest gegen die **aktuellen** Regeln der Plattform (Schema-Version,
   Pflichtfelder, Dateipfad, Benennung). Ist eine Anpassung nötig, nimm sie im PR vor und nenne sie im Bericht –
   mit Quelle. Niemals Prüfsummen, URLs oder Versionen ändern, außer sie sind nachweislich falsch (dann anhalten).
3. Platzhalter (`{{CHOCOLATEY_USERNAME}}`, `{{AUR_MAINTAINER}}`) nur mit Marcs Angabe füllen.

### Phase 4 – Einreichen (sequenziell, Reihenfolge = Priorität)

Für **jede** Plattform:

1. Duplikat-Check (Regel 3) – erneut, direkt vor dem Absenden.
2. Login nötig und nicht angemeldet → `WARTET_AUF_MARC` („bitte bei X anmelden“), mit der nächsten Plattform
   weitermachen, später zurückkehren.
3. Formular/PR vollständig ausfüllen. Bei Datei-Uploads (Screenshots, Icon): Marc bitten, die Datei auszuwählen,
   wenn du keinen Zugriff hast.
4. **PR über die GitHub-Weboberfläche:** Fork des Ziel-Repos in Marcs Konto (Fork ist reversibel, keine Freigabe
   nötig), Branch `comic-commander-1.0.1`, Dateien anlegen (Inhalt aus der Rohdatei kopieren, Pfad exakt wie
   vorgegeben), Commit-Nachricht und PR-Titel nach der Konvention des Repos – Vorschläge:
   - winget: `New package: MarcKronberg.ComicCommander version 1.0.1`
   - Scoop Extras: `comic-commander: Add version 1.0.1`
   - AppImageHub: `Add Comic Commander`
   - awesome-Listen: `Add Comic Commander`
   PR-Vorlage des Repos vollständig ausfüllen (Checkboxen nur ankreuzen, wenn wahr).
5. Nach dem Absenden: Bestätigung/PR-Seite lesen, **CI-/Bot-Ergebnisse abwarten oder später prüfen** (winget-Bot,
   AppImageHub-CI). Status `EINGEREICHT`/`IN_PRÜFUNG` mit Link.
6. Validierungsfehler: Meldung lesen, Ursache bestimmen, mit belegten Angaben beheben (Regel 6). Fehler, die eine
   Änderung an der App oder am Release erfordern (Signierung, Paketinhalt, glibc), nicht umgehen → `BLOCKIERT`.

### Phase 5 – Freigaben einholen (s. Abschnitt 6) und nachziehen

Nach Marcs Antworten die freigegebenen Schritte ausführen; Abgelehntes als `WARTET_AUF_MARC`/`UNGEEIGNET` mit
seinem Grund vermerken.

### Phase 6 – Abschlussbericht

Erstelle den Bericht nach der Vorlage in Abschnitt 7. Kannst du keine Datei schreiben, gib ihn vollständig als
Markdown im Chat aus mit der Bitte, ihn als `distribution/comiccommander-distribution-report.md` zu speichern
(oder biete an, ihn über die GitHub-Weboberfläche als Datei in einem eigenen Branch anzulegen – das ist ein Commit
im Repo → Freigabe B).

## 6. Freigabepunkte

Vor diesen Aktionen **anhalten und ausdrücklich fragen** (Marc muss mit „ja“ zu genau diesem Schritt antworten):

| Freigabe | Was |
|---|---|
| **A** | Änderungen an Marcs bestehenden öffentlichen Projekten: Repo-Description/Topics/Website, Releases (Texte, Assets), README. **Releases nie ändern**, nur vorschlagen. |
| **B** | Neue öffentliche Repositories oder Projekte in Marcs Namen (Homebrew-Tap, Scoop-Bucket, SourceForge-Projekt), Commits in Marcs Repos. |
| **C** | Bedingungen akzeptieren, die über normale Nutzung hinausgehen: CLA (Microsoft bei winget), Publisher-/Developer-Agreements (Snapcraft, Chocolatey, Stores), rechtlich verbindliche Erklärungen („Ich bin Rechteinhaber …“). Den Wortlaut bzw. Link zeigen. |
| **D** | Jeder öffentliche Beitrag in Marcs Namen (HN, Product Hunt, Reddit, Discord, Foren) – mit dem fertigen Text. |
| **E** | Alles mit Kosten (auch „kostenlose Testphase“ mit Zahlungsdaten), Bestellungen, bezahlte Listungen. |
| **F** | Weitergabe persönlicher Daten, die nicht in Abschnitt 2 als öffentlich freigegeben sind (E-Mail, Adresse, Telefon). |
| **G** | Neue Accounts/Zugangsdaten anlegen (Marc legt sie selbst an; du öffnest nur die Seite), API-Keys, SSH-Keys, Sicherheits-Einstellungen. |
| **H** | Löschen oder Ändern bestehender Einträge (auch eines gefundenen veralteten Comic-Commander-Eintrags). |

Ohne Freigabe erlaubt: Seiten lesen, suchen, Formulare ausfüllen **ohne** Absenden, Forks in Marcs Konto, PRs an
Paket-/Listen-Repos, deren Einreichung eindeutig zum Auftrag gehört und keine der Freigaben A–H berührt, kostenlose
Formulareinreichungen bei Software-Verzeichnissen ohne Bedingungen über die normale Nutzung hinaus.

Fragen bündeln: lieber eine Liste mit fünf Freigaben als fünf Unterbrechungen.

## 7. Vorlage Abschlussbericht `comiccommander-distribution-report.md`

```markdown
# Comic Commander – Distributionsbericht
Stand: <Datum, Uhrzeit> · Version: 1.0.1 · Bearbeitet von: Claude (Browser) für Marc Kronberg

## Kurzfassung
<3–5 Sätze: was ist live, was in Prüfung, was blockiert, wichtigster nächster Schritt>

## 1. Veröffentlicht
| Plattform | Link zum Eintrag | Datum | Anmerkung |

## 2. In Prüfung (eingereicht)
| Plattform | Link (PR/Ticket/Bestätigung) | eingereicht am | erwartete Dauer laut Plattform | wie man den Stand prüft |

## 3. Vorbereitet, nicht eingereicht
| Plattform | was fehlt | wer muss was tun | Link zum offenen Formular/Entwurf |

## 4. Technisch blockiert
| Plattform | Blocker | Quelle der Regel (Link) | was es lösen würde (z. B. Signierung, Source-Build) |

## 5. Abgelehnt
| Plattform | Begründung der Plattform (Zitat) | Link | Einschätzung, ob neuer Versuch sinnvoll |

## 6. Manuelle Aktionen für Marc (Checkliste)
- [ ] <konkrete Aktion, z. B. „AUR: `git push` des Pakets comic-commander-bin (Dateien in distribution/manifests/aur)“>

## 7. Nicht geeignet
| Plattform | Begründung |

## 8. Links (alle Einträge, PRs, Formulare)

## 9. Empfohlene nächste Schritte
<z. B. Signierung + Notarisierung (öffnet Homebrew Cask, Microsoft Store), AppStream-Metadaten ins .deb, Flatpak-Build aus Quellen, ARM-Builds>

## Anhang: Arbeitsliste (vollständige Tabelle aus Abschnitt 3)
## Anhang: Abweichungen zwischen Quellen und facts.json
```

## 8. Fehlerbehandlung (Kurzreferenz)

| Situation | Reaktion |
|---|---|
| Seite lädt nicht / Formular weg | einmal neu laden; sonst Startseite der Plattform → Weg suchen; sonst `BLOCKIERT` („Einreichung nicht auffindbar“, Datum). |
| Captcha, MFA, „Bist du ein Mensch?“ | anhalten, Marc lösen lassen. |
| Pflichtfeld ohne belegte Angabe (z. B. Downloadzahlen, Telefonnummer, Firmen-USt-ID) | leer lassen, wenn möglich; sonst `WARTET_AUF_MARC` mit Frage. Nie Fantasiewerte. |
| Plattform will Datei statt URL hochladen (Installer) | nicht selbst herunter- und hochladen ohne Rückfrage; Marc fragen, ob die Plattform die Datei hosten darf. |
| PR-Bot meldet Fehler | Log lesen, Regel nachschlagen, gezielt korrigieren, Kommentar im PR mit kurzer Erklärung; zweiter Fehlschlag → `BLOCKIERT`. |
| Moderator stellt Rückfrage | Fakten aus Abschnitt 2 beantworten; Meinungs-/Rechtsfragen → Marc. |
| Eintrag existiert schon, aber veraltet/falsch | nicht ändern (Freigabe H); im Bericht mit Link und Korrekturvorschlag. |
| Plattform verlangt Signierung | `BLOCKIERT`, Regel verlinken. |

— PROMPT ENDET —
