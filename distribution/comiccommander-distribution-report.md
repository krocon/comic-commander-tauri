# Comic Commander – Distributionsbericht
Stand: 26.10.2026, 09:29 (Zwischenstand nach Phase 1–4, Freigaben offen) · Version: 1.0.1 · Bearbeitet von: Claude (Browser) für Marc Kronberg

## Kurzfassung
Drei Pull Requests sind eingereicht: winget (#462052), AppImageHub (#10776, Test grün) und awesome-mac (#3890). Noch ist nichts veröffentlicht.
winget wartet auf Marcs CLA-Zustimmung (Label `Needs-CLA`). Ohne sie wird nicht gemergt.
Durch die Bekanntheitsschwellen bei 0 Stars sind Scoop Extras (≥ 100 Stars/50 Forks) und awesome-rust (≥ 50 Stars) blockiert. Homebrew Cask und Microsoft Store sind wegen der fehlenden Signierung blockiert.
open-source-mac-os-apps verlangt ein **englisches README**. Das README des Repos ist deutsch, deshalb wurde der PR dort nicht eröffnet.
Die Software-Verzeichnisse brauchen Marcs Login und teils seine Antworten (s. Abschnitt 6).

## 1. Veröffentlicht
| Plattform | Link zum Eintrag | Datum | Anmerkung |
|---|---|---|---|
| – | – | – | noch nichts freigeschaltet |

## 2. In Prüfung (eingereicht)
| Plattform | Link (PR/Ticket/Bestätigung) | eingereicht am | erwartete Dauer laut Plattform | wie man den Stand prüft |
|---|---|---|---|---|
| WinGet | https://github.com/microsoft/winget-pkgs/pull/462052 | 26.10.2026 | nicht angegeben; Validierung automatisch, danach Moderator | Labels im PR. Aktuell `Needs-CLA` und `New-Package`. Die Installer-Validierung läuft erst nach der CLA. |
| AppImageHub | https://github.com/AppImage/appimage.github.io/pull/10776 | 26.10.2026 | nicht angegeben (Merge durch Maintainer) | Bot-Kommentar „✅ Test passed“ (getestet: Comic.Commander_1.0.1_amd64.AppImage, glibc ≥ 2.35). Warnungen: startet dunkel, obwohl das System hell ist; keine Update-Information (zsync). |
| awesome-mac | https://github.com/jaywcjlove/awesome-mac/pull/3890 | 26.10.2026 | nicht angegeben | PR-Seite. Eintrag in „Ebooks“ in allen 4 README-Sprachen (en/zh/ja/ko), wie es die Contributing-Regeln verlangen. |

## 3. Vorbereitet, nicht eingereicht
| Plattform | was fehlt | wer muss was tun | Link |
|---|---|---|---|
| open-source-mac-os-apps | Regel: „Projects are ineligible if … README is not clear or not written in English“. Das README ist deutsch. | Marc: README auf Englisch umstellen (oder englischen Abschnitt ergänzen), dann PR eröffnen | Branch ist fertig (+19 Zeilen in applications.json): https://github.com/krocon/open-source-mac-os-apps/tree/add-comic-commander |
| AlternativeTo | Login („Sign In“ sichtbar); kein bestehender Eintrag („no apps was found“) | Marc anmelden, dann fülle ich „Suggest new application“ aus | https://alternativeto.net/ |
| MacUpdate, Uptodown, heise Download, SaaSHub, LinuxLinks | Login/Developer-Account | Marc legt die Accounts an bzw. meldet sich an, ich fülle die Formulare aus | s. Anhang |
| Softpedia | Softpedia lehnt laut Einreichungsseite Software mit LLM-geschriebenem Code ab. Das README nennt eine „Prompt“-basierte Entwicklung. | Marc entscheidet, ob die Bedingung zutrifft. Wenn ja → ungeeignet. | https://www.softpedia.com/user/submit.shtml |
| FileHorse, MajorGeeks | Einreichung nur per Kontaktformular bzw. E-Mail; dafür ist eine Rückmelde-E-Mail nötig (Freigabe F) | Marc: Adresse nennen oder selbst senden; Text aus listing.md | filehorse.com/submit/ · majorgeeks.com |
| Show HN, Product Hunt, Reddit | Freigabe D | Marc postet selbst; Entwurf steht in listing.md | – |

## 4. Technisch blockiert
| Plattform | Blocker | Quelle der Regel | was es lösen würde |
|---|---|---|---|
| Homebrew Cask (offiziell) | Casks müssen Gatekeeper bestehen („must not require … Gatekeeper to be disabled or bypassed“); die .dmg ist weder signiert noch notarisiert. Ein festes Datum zur Entfernung unsignierter Casks steht auf der Seite nicht (Abweichung vom Prompt). | https://docs.brew.sh/Acceptable-Casks | Developer-ID-Signierung + Notarisierung |
| Scoop Extras | Paketanfrage per Issue nötig, Kriterium „at least 100 stars and/or 50 forks“; Repo hat 0/0 | https://github.com/ScoopInstaller/Extras/blob/master/.github/ISSUE_TEMPLATE/package-request.yml · https://github.com/ScoopInstaller/.github/blob/main/.github/CONTRIBUTING.md | Bekanntheit; Alternative: eigener Bucket (Freigabe B) |
| awesome-rust | „Accepted: (stars > 50 \| downloads > 2000)“ | https://github.com/rust-unofficial/awesome-rust/blob/main/CONTRIBUTING.md | ≥ 50 Stars |
| Microsoft Store (MSI/EXE) | „The binary and all of its PE files must be digitally signed …“ | https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements | Windows-Code-Signing oder MSIX (Microsoft signiert) |
| Flathub | Build aus den Quellen Pflicht (inkl. Abhängigkeiten); das .deb neu zu verpacken ist nicht zulässig | https://docs.flathub.org/docs/for-app-authors/requirements | Flatpak-Manifest mit Offline-Cargo- und npm-Quellen; lokaler Test durch Marc |
| AUR | Paket-Upload nur per `git push` über SSH; Name `comic-commander` ist frei | https://aur.archlinux.org/ | Marc (Checkliste) |
| Chocolatey | Upload per `choco push` mit API-Key; einen Web-Upload beschreibt die Doku nicht | https://docs.chocolatey.org/en-us/create/commands/push | Marc per CLI |
| Snap Store | Namensregistrierung und Upload per snapcraft (Build from GitHub laut Forum seit 03/2026 unzuverlässig) | https://forum.snapcraft.io/t/build-from-github/26004 | Marc per CLI/CI |

## 5. Abgelehnt
| Plattform | Begründung | Link | neuer Versuch sinnvoll? |
|---|---|---|---|
| – | – | – | – |

## 6. Manuelle Aktionen für Marc (Checkliste)
- [ ] **winget CLA:** im PR #462052 kommentieren: `@microsoft-github-policy-service agree` (nur wenn du die CLA akzeptierst; Freigabe C)
- [ ] Repo-„About“ füllen (Freigabe A): Description = Kurzbeschreibung EN, Website = Produktseite, Topics = `comic-reader comics manga cbz cbr pdf tauri rust angular desktop-app macos windows linux`
- [ ] README englisch (oder englischer Abschnitt) → dann PR für open-source-mac-os-apps öffnen (Branch steht bereit)
- [ ] AUR: Account anlegen, SSH-Key hinterlegen, `git push` von `distribution/manifests/aur/comic-commander-bin` (PKGBUILD, .SRCINFO; Platzhalter `{{AUR_MAINTAINER}}` füllen)
- [ ] Chocolatey: Account + `choco pack` / `choco push` (`{{CHOCOLATEY_USERNAME}}` füllen)
- [ ] Logins für AlternativeTo, MacUpdate, Uptodown, heise Download (danach fülle ich die Formulare aus)
- [ ] Softpedia: entscheiden, ob deren Regel zu LLM-geschriebenem Code zutrifft
- [ ] Optional für AppImageHub: helles Theme als Standard, Update-Info (zsync) ins AppImage

## 7. Nicht geeignet
| Plattform | Begründung |
|---|---|
| awesome-tauri | Die Liste hat keinen Abschnitt „Applications“ mehr (nur Guides, Articles, Templates, Plugins, Integrations) – Abweichung vom Prompt |
| MacPorts | Port aus Quellen sehr aufwendig, Binär-Port aus unsignierter .dmg unüblich – nach Signierung neu prüfen |
| Debian/Ubuntu-Archiv | Sponsor nötig, unRAR nicht DFSG-frei |
| Fedora | unRAR-Lizenz nicht zulässig |
| Mac App Store | Sandbox + Apple-Programm nötig |
| FossHub | „We aren't accepting applications for file-hosting accounts“ |
| Neowin, TechSpot | kein öffentlicher Einreichungsweg gefunden |

## 8. Links
- winget PR: https://github.com/microsoft/winget-pkgs/pull/462052 (Fork-Branch krocon/winget-pkgs:comic-commander-1.0.1)
- AppImageHub PR: https://github.com/AppImage/appimage.github.io/pull/10776
- awesome-mac PR: https://github.com/jaywcjlove/awesome-mac/pull/3890
- open-source-mac-os-apps (Branch, kein PR): https://github.com/krocon/open-source-mac-os-apps/tree/add-comic-commander

## 9. Empfohlene nächste Schritte
1. CLA für winget, dann Validierung abwarten. Unsignierte Installer können bei SmartScreen/Defender auffallen.
2. Englisches README. Das öffnet open-source-mac-os-apps und hilft bei allen Verzeichnissen.
3. Signierung + Notarisierung (macOS) und Windows-Signierung. Das öffnet Homebrew Cask und den Microsoft Store.
4. AppImage: Update-Info (zsync), helles Standard-Theme. `.desktop`-Kategorie `Viewer;` (laut listing.md fürs nächste Release geplant).
5. Flatpak-Build aus den Quellen, falls Flathub gewünscht ist.

## Anhang: Abweichungen zwischen Quellen und facts.json
- Version, Datum, Lizenz und alle 6 SHA-256-Prüfsummen stimmen mit der Release-Seite überein. Zusätzlich enthält das Release `Comic.Commander_universal.app.tar.gz` (Updater-Artefakt, nicht in facts.json, für Verzeichnisse irrelevant).
- Die Bild-URLs (Icon, grid/shelf/view.png) laden (HTTP 200).
- Das GitHub-„About“ ist leer: keine Description, keine Website, keine Topics (wie im Prompt vermerkt).
- Das README des Repos ist deutsch. Der Prompt erwähnt das nicht, es ist aber für mehrere Listen relevant.
- winget-Manifeste: Die internen Kommentarzeilen wurden vor dem Einreichen entfernt, Felder und Werte sind unverändert. Schema 1.10.0 ist laut Repo weiterhin akzeptiert (empfohlen: 1.12.0).
- Homebrew: Die Seite nennt kein Datum zur Entfernung unsignierter Casks. Die Gatekeeper-Pflicht gilt trotzdem.
