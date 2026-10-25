# Werbeseite krocon.de/products/comiccommander

Eine statische, **dunkle** Seite auf Englisch (Prompt 044): `index.html` mit CSS inline, **ohne JavaScript, ohne
Webfonts, ohne Tracker, ohne Anfragen an fremde Server**. Die Bilder liegen in `img/` neben der Seite. Farben aus den
fünf Tönen des Logos (`docs/logo-5farbig.svg`, in der Seite inline; `favicon.svg` = dasselbe Logo).

## Hochladen

Kein Build-Schritt: `index.html`, `favicon.svg` und `img/` in den Ordner `/products/comiccommander` des Webspaces
kopieren (z. B. per FTP mit FnF: `Ctrl+K` / `⌘K`). Danach ist die Seite unter
`https://krocon.de/products/comiccommander/` erreichbar. Serverlogik gibt es keine.

```
/products/comiccommander/index.html
/products/comiccommander/favicon.svg
/products/comiccommander/img/grid.png, shelf.png, view.png   (zusammen ~4,6 MB)
```

## Hinweise

- **Bilder:** macOS-Fensteraufnahmen mit transparentem Schatten (1217 × 744 bzw. 1216 × 736) – sie brauchen keinen
  Rahmen. `grid.png` steht zweimal auf der Seite: oben ganz, bei Feature 1 als vergrößerter Ausschnitt per CSS
  (`.shot.detail`, Werte im Kommentar). Neue Aufnahmen mit anderem Maß: `width`/`height` der `<img>` und den
  Ausschnitt anpassen.
- **Open-Graph-Bild** (Vorschau beim Teilen): `https://krocon.de/products/comiccommander/img/grid.png` – passt nur,
  wenn die Seite wirklich dort liegt; sonst `og:url`/`og:image` im Kopf anpassen.
- **Rechtliches:** Fuß und FAQ sagen, dass die App nur für selbst gescannte, DRM-freie oder frei lizenzierte Comics
  gedacht ist und keine Raubkopien unterstützt; die Cover in den Screenshots gehören den Verlagen. Impressum und
  Datenschutz: Link im Fuß auf `https://krocon.de`.
- **Datenschutz:** keine Cookies, kein JavaScript, keine fremden Server – nur die Zugriffsprotokolle des Webservers.
- **Texte ändern:** direkt in `index.html`. Was die Seite verspricht, muss der Stand halten (Formate, Plattformen,
  Sprachen – Deutsch erst mit Prompt 009, Signierung erst mit 012) – gleiche Aussagen wie in der README.
- Lokal ansehen: `site/index.html` im Browser öffnen.
