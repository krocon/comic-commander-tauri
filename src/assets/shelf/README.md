# Holz der Regalansicht (Prompt 015)

Bildfragmente für die Darstellung „Regal“ (`src/app/features/grid/shelf.css`). Erzeugt von
`scripts/shelf-slices.py`. Nicht von Hand bearbeiten, sondern den Generator neu laufen lassen.

| Datei | Inhalt | CSS-Größe (s = 1) |
|---|---|---|
| `wall.webp` | Rückwand, nahtlos in x und y | 326 × 426 px |
| `board.webp` | Boden: 12 px Oberseite + 16 px Vorderkante, Maserung quer | 526 × 28 px (repeat-x) |
| `upright.webp` | Seitenwand links (rechts gespiegelt), nahtlos in y | 30 × 426 px |

Die Dateien liegen in doppelter Auflösung vor und werden in halber Größe gezeichnet (Retina).

## Quellen

- **Layout und Holz:** Thoriq Firdaus, „Create an iBook Inspired Bookshelf Mock-up“, Naldz Graphics, 4.11.2011,
  <https://naldzgraphics.net/how-to-create-an-ibook/>. Die PSD des Tutorials (`Bookshelf.psd`, 800 × 1100,
  Vorschau `img_3.png`) liefert die rohe Holztextur (Smart-Objekt `wood (right).psb`). Aus ihr kommt nur die
  **Maserung**: Helligkeit geteilt durch ihr weiches Mittel, Kontrast angepasst. Eine Lizenz für die PSD nennt die
  Seite nicht (Stand 24.10.2026). Freigabe für die Nutzung: Marc Kronberg, 24.10.2026.
- **Maße und Farben:** gemessen an den Fotos des iBooks-Regals (iPad, 2010; `img.png`, `img_2.png`, Newsstand
  `img_1.png`). Übernommen sind nur Zahlen (Breiten, Höhen, Farbwerte; Tabelle „Aufbau“ in
  `prompts/done/015-regalansicht.md`), keine Pixel.

Referenzbilder liegen bei Prompt 015 (`prompts/done/015-screenshots/`); die PSD (24 MB) ist nicht im Repo
(`.gitignore`) – herunterladen und nach `prompts/` oder `prompts/done/015-screenshots/` legen.
