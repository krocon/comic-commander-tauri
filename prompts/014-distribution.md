# Aufgabe: Meta-Prompt für die automatische Distribution von ComicCommander über den Browser erstellen

## Deine Rolle

Du bist ein erfahrener Agent-Workflow-Architekt, spezialisiert auf Claude, Claude Browser, Browser-Automatisierung, Software-Distribution, Paketmanager und Developer-Marketing.

Deine Aufgabe ist **nicht**, ComicCommander selbst einzutragen. Du sollst einen vollständigen, ausführbaren Prompt für Claude Browser schreiben, der anschließend die Registrierung und Einreichung von ComicCommander bei möglichst vielen geeigneten Paketmanagern, Software-Verzeichnissen und Discovery-Plattformen übernimmt.

Der von dir erstellte Prompt soll so konkret sein, dass Claude Browser ihn ohne weitere konzeptionelle Vorbereitung abarbeiten kann.

Was du aber tun kannst, sollst du eine Liste von Paketmanagern, Software-Verzeichnissen und Discovery-Plattformen erstellen und im Prompt angeben, die ComicCommander unterstützen könnten. Du kannst auch eine Liste von möglichen Download-URLs erstellen, die ComicCommander unterstützen könnten.

Du kannst auch hier im Projekt die entsprechenden manifest-Dateien anlegen, die Claud-Browser dann zusammen mit dem geschriebenen Prompt nutzen kann.


## Projekt

**Produkt:** ComicCommander  
**Offizielle Produktseite:** https://krocon.de/products/comiccommander/  
**Hersteller-/Entwicklerwebsite:** https://krocon.de/  
**GitHub-Organisation bzw. Profil:** https://github.com/krocon

ComicCommander ist ein selbst entwickelter Desktop-Comic-Viewer. Prüfe die tatsächlichen Produktinformationen auf der offiziellen Website und den dort verlinkten Quellen. Erfinde keine Funktionen, Plattformen, Lizenzdetails, Versionsnummern oder Download-URLs.

## Hauptziel

Erstelle einen Browser-Agent-Prompt, der selbstständig:

1. ComicCommander und seine tatsächlichen technischen Eigenschaften recherchiert.
2. Die geeigneten Paketmanager, Software-Kataloge und Discovery-Plattformen identifiziert.
3. Alle Einreichungsmöglichkeiten über Weboberflächen, GitHub-Webseiten oder offizielle Einreichungsformulare ermittelt.
4. Die notwendigen Einträge vorbereitet und – soweit autorisiert, technisch möglich und ohne unbelegte Angaben – einreicht.
5. Den Fortschritt, die Ergebnisse, offene Voraussetzungen und erforderliche manuelle Aktionen dokumentiert.

**Wichtig:** Das Ziel ist nicht, möglichst viele beliebige Einträge zu erzeugen, sondern möglichst viele qualitativ hochwertige, dauerhaft funktionierende und passende Distributionseinträge.

## Zu prüfende Plattformen

Der erstellte Prompt soll mindestens die folgenden Kandidaten überprüfen und bei Eignung bearbeiten.

### A. Paketmanager

**macOS**
- Homebrew Cask: https://github.com/Homebrew/homebrew-cask
- MacPorts: https://www.macports.org/

**Windows**
- WinGet: https://github.com/microsoft/winget-pkgs
- Scoop: https://github.com/ScoopInstaller
- Chocolatey: https://community.chocolatey.org/

**Linux**
- Flathub: https://flathub.org/
- Snap Store: https://snapcraft.io/
- AppImageHub beziehungsweise geeignete AppImage-Verzeichnisse
- Debian-/Ubuntu-Paketarchive, sofern realistisch und technisch geeignet
- Fedora-Paketquellen, sofern realistisch und technisch geeignet
- AUR für Arch Linux, sofern ein geeignetes Installationspaket erstellt werden kann

Prüfe für jede Plattform, ob ComicCommander die technischen Voraussetzungen erfüllt. Berücksichtige Tauri, die tatsächlich vorhandenen Build-Artefakte, unterstützte Betriebssysteme, Architektur, Signierung, Lizenz und Installationsverfahren.

Unterscheide zwischen:
- direkter Einreichung über ein Webformular,
- Einreichung per Pull Request über die Weboberfläche,
- erforderlicher Veröffentlichung eines Git-Repositories,
- notwendiger Konfiguration eines externen Build- oder Distributionssystems,
- Plattformen, bei denen eine echte Browser-Einreichung nicht ausreicht.

Erfinde keine APIs, Einreichungsformulare oder angeblichen Ein-Klick-Registrierungen.

### B. Software-Verzeichnisse

Prüfe unter anderem:

- AlternativeTo: https://alternativeto.net/
- SaaSHub: https://www.saashub.com/
- MacUpdate: https://www.macupdate.com/
- Softpedia: https://www.softpedia.com/
- FileHorse: https://www.filehorse.com/
- MajorGeeks: https://www.majorgeeks.com/
- SourceForge: https://sourceforge.net/
- FossHub: https://www.fosshub.com/
- Uptodown: https://www.uptodown.com/

Füge weitere seriöse, geeignete und aktuell aktive Portale hinzu. Prüfe die jeweiligen Richtlinien und tatsächlichen Möglichkeiten, neue Software einzureichen.

### C. Produkt-Launch und Community-Discovery

Prüfe:

- Product Hunt: https://www.producthunt.com/
- Hacker News / Show HN: https://news.ycombinator.com/
- Reddit-Communities mit passenden Regeln zur Eigenwerbung
- kuratierte Listen für Open-Source-macOS-Apps
- kuratierte Listen für Rust- und Tauri-Desktop-Software
- geeignete Verzeichnisse für Comic- und Manga-Reader

Diese Plattformen sollen getrennt von klassischen Paketmanagern behandelt werden. Ein Community-Post ist kein Softwarepaket und kein offizieller Katalogeintrag.

## Arbeitsweise des zu erstellenden Browser-Agent-Prompts

### Phase 1: Bestandsaufnahme

Der Browser-Agent soll zunächst die offizielle Produktseite und verlinkte Projektseiten öffnen.

Er soll feststellen:
- Produktname und offizielle Beschreibung,
- tatsächliche Features,
- unterstützte Betriebssysteme,
- Lizenz,
- Quellcode-Repository,
- aktuelle Version,
- vorhandene Releases und Installer,
- stabile und dauerhaft erreichbare Download-URLs,
- vorhandene Prüfsummen,
- Signierungs- und Notarisierungsstatus,
- Screenshots und Produktgrafiken,
- Kontaktmöglichkeiten des Entwicklers.

Fehlende Angaben müssen als unbekannt dokumentiert werden. Der Agent darf keine Angaben erfinden.

Falls notwendige Informationen fehlen, soll er zunächst alle anderen vorbereitenden Arbeiten durchführen und anschließend gezielt nur die wirklich erforderlichen Rückfragen stellen.

### Phase 2: Plattforminventar und Priorisierung

Der Agent soll eine vollständige Arbeitsliste mit mindestens folgenden Feldern erstellen:

- Plattform
- Kategorie
- offizielle Einreichungs-URL
- Einreichungsmethode
- technische Voraussetzungen
- erforderliche Accounts
- Kosten, sofern verlässlich feststellbar
- benötigte Dateien und Metadaten
- Status
- konkrete nächste Aktion
- erwarteter Nutzen
- Begründung für Aufnahme oder Ausschluss

Priorisiere nach Reichweite, Relevanz, Einreichungsaufwand und Erfolgsaussicht.

Prüfe, ob die Plattform aktuell aktiv ist. Verlasse dich nicht allein auf Suchmaschinenausschnitte oder veraltete Anleitungen.

### Phase 3: Vorbereitung der Einträge

Bereite für jede geeignete Plattform die benötigten Inhalte vor, soweit die tatsächlichen Projektdaten dies erlauben:

- Produktname
- kurze und lange Beschreibung
- englische Beschreibung und gegebenenfalls deutsche Beschreibung
- offizielle Website
- Repository-URL
- Lizenz
- aktuelle Version
- unterstützte Betriebssysteme
- passende Kategorien und Tags
- Release- und Download-URLs
- Prüfsummen
- Screenshots und gegebenenfalls Icon
- versionsspezifische Installationsanweisungen

Nutze konsistente Produktinformationen. Erstelle keine widersprüchlichen Versionsnummern, erfundenen Download-Links oder unbelegten Feature-Aussagen.

Wo sinnvoll, bereite die erforderlichen Paketmanifest-Dateien und Einreichungsbeschreibungen vor. Der Browser-Agent soll jedoch keine nicht vorhandenen Dateien oder Release-Artefakte vortäuschen.

### Phase 4: Browser-Einreichungen

Der Browser-Agent soll jede geeignete Plattform nacheinander öffnen und die offiziellen Einreichungsprozesse bearbeiten.

Er soll:
- vorhandene Accounts verwenden, sofern der Nutzer bereits angemeldet ist,
- Formulare vollständig ausfüllen,
- korrekte Projektinformationen verwenden,
- bereits vorhandene ComicCommander-Einträge erkennen,
- Duplikate vermeiden,
- Einreichungen und Pull Requests nachvollziehbar benennen,
- Validierungsfehler beheben, sofern das ohne unbelegte Angaben möglich ist,
- den tatsächlichen Status nach jeder Aktion prüfen.

**Keine blinden Wiederholungen:** Wenn eine Einreichung fehlschlägt, muss der Agent den Fehler untersuchen, bevor er es erneut versucht.

### Phase 5: Freigaben und Sicherheitsgrenzen

Der Agent darf normale, reversible Formularvorbereitungen und eindeutig autorisierte Einreichungen selbstständig ausführen.

Vor folgenden Aktionen muss er die ausdrückliche Zustimmung des Nutzers einholen:
- kostenpflichtige Registrierungen oder Bestellungen,
- Veröffentlichung eines öffentlichen Community-Posts im Namen des Nutzers,
- rechtlich verbindliche Erklärungen oder Lizenzbestätigungen,
- Änderungen an bestehenden öffentlichen Releases,
- Löschungen oder Änderungen bestehender Einträge mit möglichen Auswirkungen,
- Akzeptieren von Bedingungen, die über gewöhnliche Plattformnutzung hinausgehen,
- Nutzung oder Weitergabe persönlicher Daten, die nicht ausdrücklich freigegeben wurden,
- Erstellen neuer Zugangsdaten oder Änderungen an Sicherheitskonfigurationen.

Der Agent darf niemals:
- Captchas oder Sicherheitsmechanismen umgehen,
- Passwörter oder Zugangsdaten ausgeben,
- Sicherheitswarnungen ignorieren,
- kostenpflichtige Optionen ungefragt aktivieren,
- falsche Angaben machen, um eine Plattformprüfung zu bestehen,
- eine Einreichung als erfolgreich melden, wenn sie lediglich vorbereitet wurde.

Falls ein Login, eine MFA-Bestätigung oder eine Freigabe erforderlich ist, soll der Agent anhalten, den Nutzer um die notwendige Aktion bitten und danach fortfahren.

### Phase 6: Abschlussbericht

Der Agent soll einen strukturierten Abschlussbericht erstellen mit:

1. Erfolgreich eingereichten Einträgen
2. Noch in Prüfung befindlichen Einträgen
3. Vorbereiteten, aber noch nicht eingereichten Einträgen
4. Plattformen mit technischen Blockern
5. Abgelehnten Einreichungen und den bekannten Gründen
6. Erforderlichen manuellen Aktionen
7. Nicht geeigneten Plattformen mit Begründung
8. Direkten Links zu Einträgen, Pull Requests und offenen Formularen
9. Empfohlenen nächsten Schritten

Erstelle zusätzlich eine Markdown-Datei `comiccommander-distribution-report.md`, sofern die verwendete Umgebung Dateien erstellen kann. Sie soll die Ergebnisse und die noch offenen Aufgaben dauerhaft dokumentieren.

## Qualitätskriterien

- Arbeite systematisch und sequenziell.
- Verwende ausschließlich offizielle Einreichungswege, soweit verfügbar.
- Prüfe die tatsächliche Eignung jedes Paketmanagers.
- Vermeide Duplikate.
- Bevorzuge kostenlose und seriöse Plattformen.
- Verwende Englisch für internationale Einträge, sofern sinnvoll.
- Berücksichtige, dass ComicCommander möglicherweise noch nicht alle Voraussetzungen für eine öffentliche Distribution erfüllt.
- Führe keine Aktionen aus, die durch fehlende Informationen oder Berechtigungen nicht gedeckt sind.
- Erfinde keine Ergebnisse und behaupte niemals einen Erfolg ohne überprüfbare Bestätigung.
- Dokumentiere jeden abgeschlossenen Schritt mit dem tatsächlichen Ergebnis.

## Deine Ausgabe jetzt

Gib ausschließlich den fertigen, in sich geschlossenen Prompt für Claude Browser aus.

Der Prompt muss direkt kopierbar sein und den Browser-Agenten von der Recherche bis zum dokumentierten Ergebnis führen. Er darf nicht lediglich eine Liste von Empfehlungen enthalten, sondern muss einen konkreten Arbeitsablauf mit Entscheidungsregeln, Statusverwaltung, Fehlerbehandlung und Freigabepunkten definieren.
