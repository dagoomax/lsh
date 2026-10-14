#!/bin/sh
# Regenerates src/i18n/settings/index.js from the book-N.js parts (P<n> phrases, optional S<n> same-in-every-language list)
cd "$(dirname "$0")/../src/i18n/settings" || exit 1
{
  echo "// Settings phrase book: English text → [pl, de, fr, es, it, uk]."
  echo "// Loaded on demand by loadPhrases() in src/i18n.js. Placeholders ({n}, {name}…)"
  echo "// must stay as they are. Phrases that read the same in every language (brand"
  echo "// and product names, sample values) are listed in SAME instead."
  echo "// \`node scripts/settings-phrases.mjs missing\` lists what still needs translating;"
  echo "// regenerate this file with scripts/gen-settings-book-index.sh after adding a part."
  for f in $(ls book-*.js | sort -t- -k2 -n); do
    n=${f#book-}; n=${n%.js}
    if grep -q "export const S$n" "$f"; then echo "import { P$n, S$n } from './$f'"; else echo "import { P$n } from './$f'"; fi
  done
  echo
  echo "export const LANGS = ['pl', 'de', 'fr', 'es', 'it', 'uk']"
  printf "export const BOOK = { "
  for f in $(ls book-*.js | sort -t- -k2 -n); do n=${f#book-}; n=${n%.js}; printf "...P$n, "; done
  echo "}"
  printf "export const SAME = ["
  for f in $(ls book-*.js | sort -t- -k2 -n); do n=${f#book-}; n=${n%.js}; grep -q "export const S$n" "$f" && printf "...S$n, "; done
  echo "]"
} > index.js
