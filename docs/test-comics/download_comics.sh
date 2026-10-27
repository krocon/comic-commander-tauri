#!/usr/bin/env bash
# Lädt 55 gemeinfreie / CC-lizenzierte Comics (CBZ/CBR, ~1,6 GB) von archive.org.
# Aufruf:  bash download_comics.sh [Zielordner]   (Standard: ~/comics_download/gemeinfrei)
# Abgebrochene Downloads werden beim nächsten Aufruf fortgesetzt; fertige Dateien übersprungen.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-$HOME/comics_download/gemeinfrei}"
LIST="$HERE/comics.tsv"
ok=0; fail=0; skip=0
while IFS=$'\t' read -r group name size url details; do
  [ -z "$group" ] && continue
  dir="$TARGET/$group"; mkdir -p "$dir"; out="$dir/$name"
  if [ -f "$out" ] && [ "$(stat -f%z "$out" 2>/dev/null || stat -c%s "$out")" = "$size" ]; then
    skip=$((skip+1)); continue
  fi
  echo "↓ $group/$name ($((size/1000000)) MB)"
  if curl -L --fail --retry 3 --retry-delay 5 -C - -# -o "$out" "$url"; then
    have=$(stat -f%z "$out" 2>/dev/null || stat -c%s "$out")
    if [ "$have" = "$size" ]; then ok=$((ok+1)); else echo "  ⚠ Größe $have statt $size"; fail=$((fail+1)); fi
  else
    echo "  ✗ Fehler bei $url"; fail=$((fail+1))
  fi
done < "$LIST"
cp "$HERE/QUELLEN.md" "$TARGET/QUELLEN.md" 2>/dev/null
echo; echo "Fertig: $ok geladen, $skip schon vorhanden, $fail Fehler → $TARGET"
