# Prompt 003: Cover finden und Thumbnails erzeugen (Rust)

> Braucht: 001, 002 · Umfang: L · Branch `feat/cover-thumbnails`
> Gemeinsame Regeln: [`000-arbeitsweise.md`](000-arbeitsweise.md). Vorlage: legacy §4, §10.2–10.4.
> Übernahme aus files-and-folders-tauri (CLAUDE.md §8): `archive/` (Index ZIP/TAR/7z/RAR mit Grenzen, `sanitize`),
> `duplicates/comic.rs` (`pages`, `natural_cmp`), `duplicates/images.rs` (Decoder mit Limits, Semaphor),
> `duplicates/thumbs.rs`, `preview/mod.rs` + `lib.rs` (asynchrones URI-Schema mit Tokens).

## Ziel

Für jedes Buch einer Bibliothek liefert Rust ein **Cover-Thumbnail** in der gewünschten Größe – schnell, begrenzt,
sicher und ohne externe Programme. Das Frontend lädt es per `<img src>` über ein eigenes URI-Schema. Grundlage für das
Cover-Grid (004) und die Stapel-Erzeugung (007). PDF folgt in 006 (hier nur die Schnittstelle vorsehen).

## Anforderungen

1. **Archive lesen** (CBZ = ZIP, CBR = RAR, CB7 = 7z, CBT = TAR) – **nach Inhalt** (Magic Bytes), nicht nach Endung:
   ein `.cbr`, das ZIP ist, funktioniert (legacy §4: Fallback der Vorlage). Code aus files-and-folders `archive/`
   übernehmen (nur Lesen + einzelnen Eintrag extrahieren; kein Packen, keine Passwörter → verschlüsselt = „kein
   Cover“).
2. **Cover-Wahl** wie legacy §4, verbessert: Bilder `jpg jpeg png webp gif bmp` (Groß-/Kleinschreibung egal), keine
   versteckten Einträge/`__MACOSX`; Reihenfolge: `cover.` im Namen → weniger Ordnerebenen → **natürliche** Sortierung.
   Optional `ComicInfo.xml` mit `FrontCover`-Seite (E3).
3. **Bild verkleinern**: Decoder mit Grenzen (Pixel, Bytes, `catch_unwind`), Skalierung `fit inside` ohne Vergrößern
   (wie `sharp` der Vorlage), JPEG Qualität 80 (E2: oder WebP). Größen kommen aus dem Frontend (Standard 200×300,
   400×600, 800×1200 wie die Vorlage) – Rust akzeptiert nur eine feste Liste.
4. **Thumb-Cache** im App-Cache: Schlüssel = Hash(Pfad, Größe, mtime, Thumb-Größe); bei Änderung des Buchs neu. Größe
   begrenzen (LRU nach Zugriff, Grenze aus den Einstellungen, Default 1 GiB) – E4.
5. **Alte Sidecars lesen** (Kompatibilität mit der Vorlage und der App „Panels“): vor dem Erzeugen prüfen, ob
   `Band<suffix>.jpg`, `Band.cbz<suffix>.jpg`, `.Panels/thumbnails/Band<suffix>.jpg` … existiert (Reihenfolge legacy
   §4) und passt. Schreiben neben das Buch nur, wenn der Nutzer es einschaltet (E5) – Standard aus.
6. **URI-Schema** `ccimg` (Name im Design festlegen), asynchron registriert, Tokens statt Pfade in der URL (der
   WebView darf keine beliebigen Pfade anfordern), Parallelität begrenzt (Semaphor, sonst 503 + Retry im Frontend),
   `Cache-Control` für den WebView-Cache. CSP `img-src` ergänzen.
7. **Fehlerfälle** sauber unterscheiden: kein Bild im Archiv, verschlüsselt, kaputt, zu groß, nicht lesbar → eigenes
   Platzhalter-Bild/Status im Frontend; „fehlt“ zählt für 007 mit.
8. Frontend-Fassade `CoversApi` (Token/URL für Buch + Größe holen, auch gebündelt für die sichtbaren Zellen) und
   Fake. Noch kein Grid – zur Sichtprüfung reicht ein Cover-Bildchen in der Skelett-Liste von 001.

## Entscheidungsfragen

- **E1 Lieferung**: Token je Buch über `invoke` holen und dann `<img src="ccimg://localhost/<token>">` vs. URL mit
  signiertem Schlüssel (Buch-Id aus dem Scan) ohne Vorab-Aufruf. Empfehlung mit Blick auf 30 000 Zellen.
- **E2 Format**: JPEG q80 (wie Vorlage, Sidecar-kompatibel) vs. WebP (kleiner; Encoder-Crate?).
- **E3 ComicInfo.xml** beachten? (kleiner XML-Parser oder `quick-xml`)
- **E4 Cache-Grenze und Aufräumen** (beim Start, im Hintergrund).
- **E5 Sidecars schreiben** als Option (Pfad, Rechte, schreibgeschützte Laufwerke)?
- **E6 RAR**: `unrar-ng-sys` (C++-Quellen, unRAR-Lizenz, wie files-and-folders) vs. reines Rust (gibt es nicht
  vollständig) – Lizenzhinweis in 012.

## Tests

- Rust (Testdateien per Generator in `src-tauri/testdata/`): ZIP/RAR/7z/TAR mit Cover an verschiedenen Stellen,
  `cover.jpg` tief im Ordner, nur PNG/WebP, falsche Endung, verschlüsselt, leer, kaputt, Zip-Slip-Namen, Bombe
  (Größe/Rate), 20 000×20 000-Bild (abgelehnt vor dem Dekodieren), Sidecar-Reihenfolge, Cache-Treffer/-Ungültigkeit
  nach mtime, Schema-Antworten (200/404/503).
- Frontend: Fassade/Fake, Retry nach 503, veraltete Antworten.

## Akzeptanzkriterien

- [ ] Für eine Test-Sammlung mit allen vier Archivformaten erscheinen die richtigen Cover; das zweite Laden kommt aus
      dem Cache (messbar < 5 ms je Cover).
- [ ] Vorhandene `Band.jpg`/`Band_xl.jpg` der Vorlage werden benutzt statt neu erzeugt.
- [ ] Kaputte/feindliche Archive bringen die App nicht zum Hängen oder Abstürzen; Speicher bleibt begrenzt.
- [ ] Review durch einen separaten Agenten (Archive, Decoder, URI-Schema).
