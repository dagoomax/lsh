// Settings phrase book: English text → [pl, de, fr, es, it, uk].
// Loaded on demand by loadPhrases() in src/i18n.js. Placeholders ({n}, {name}…)
// must stay as they are. Phrases that read the same in every language (brand
// and product names, sample values) are listed in SAME instead.
// `node scripts/settings-phrases.mjs missing` lists what still needs translating;
// regenerate this file with scripts/gen-settings-book-index.sh after adding a part.
import { P1 } from './book-1.js'
import { P2, S2 } from './book-2.js'
import { P3, S3 } from './book-3.js'
import { P4, S4 } from './book-4.js'
import { P5, S5 } from './book-5.js'
import { P6, S6 } from './book-6.js'
import { P7, S7 } from './book-7.js'
import { P8, S8 } from './book-8.js'
import { P9, S9 } from './book-9.js'
import { P10, S10 } from './book-10.js'
import { P11, S11 } from './book-11.js'
import { P12, S12 } from './book-12.js'
import { P13, S13 } from './book-13.js'
import { P14, S14 } from './book-14.js'

export const LANGS = ['pl', 'de', 'fr', 'es', 'it', 'uk']
export const BOOK = { ...P1, ...P2, ...P3, ...P4, ...P5, ...P6, ...P7, ...P8, ...P9, ...P10, ...P11, ...P12, ...P13, ...P14, }
export const SAME = [...S2, ...S3, ...S4, ...S5, ...S6, ...S7, ...S8, ...S9, ...S10, ...S11, ...S12, ...S13, ...S14, ]
