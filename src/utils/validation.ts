/**
 * Returns true when the string contains real, analysable feedback --
 * i.e. it isn't empty, a placeholder, or a single punctuation mark.
 *
 * Filters out the common Booking.com placeholders surveyed in the wild:
 *   "-", "--", "n/a", "na", "nothing", "none", "no", "null", "...", "?", "."
 * and any combination of just punctuation / whitespace / numbers.
 *
 * Letter detection uses the Unicode `\p{L}` (any-script letter) class so
 * Vietnamese, Korean, Japanese, Chinese, Cyrillic, Arabic, etc. all pass.
 *
 * Requires at least 2 characters of meaningful content so single-letter
 * replies don't pollute keyword extraction or sentiment.
 */
export const isValidFeedback = (t: string | undefined | null): boolean => {
  if (!t) return false;
  const trimmed = t.trim();
  if (trimmed.length < 2) return false;

  const lower = trimmed.toLowerCase();

  // Exact-match placeholders
  const PLACEHOLDERS = new Set([
    '-', '--', '---', '—', '–',
    'n/a', 'na', 'n.a.', 'n/a.',
    'no', 'nope', 'none', 'nothing', 'nothing.', 'nothing!',
    'null', 'undefined', 'tbd',
    '...', '..', '.', '?', '!',
    'no comments', 'no comment', 'no review', 'no feedback',
  ]);
  if (PLACEHOLDERS.has(lower)) return false;

  // Reject strings made entirely of punctuation / whitespace / numbers --
  // i.e. require at least one letter from any script.
  if (!/\p{L}/u.test(trimmed)) return false;

  return true;
};


/**
 * True when a review carries written feedback in EITHER field.
 *
 * Critical-issue reports use this instead of checking `negativeReview`
 * alone. Two reasons:
 *  1. A 1/10 with no text at all is unactionable -- it drags the average
 *     down but tells you nothing, so it is excluded from the lists.
 *  2. Guests on some platforms type their complaint into the "liked" box,
 *     and formats with a single text column (Agoda, Guest Reviews) put
 *     everything in one field. Checking only `negativeReview` silently
 *     dropped those.
 */
export const hasWrittenFeedback = (r: {
  positiveReview?: string;
  negativeReview?: string;
}): boolean => isValidFeedback(r.negativeReview) || isValidFeedback(r.positiveReview);

/** The review text to show for a critical review, whichever field holds it. */
export const criticalFeedbackText = (r: {
  positiveReview?: string;
  negativeReview?: string;
  translatedPositive?: string;
  translatedNegative?: string;
}): string => {
  const neg = r.translatedNegative || r.negativeReview;
  if (isValidFeedback(neg)) return neg as string;
  return (r.translatedPositive || r.positiveReview || '') as string;
};

/**
 * True when a review is tied to a real reservation, i.e. a "verified stay".
 *
 * There is no explicit `Verified` column in any supported export. The signal
 * is the booking reference: Booking.com, Agoda and Expedia only accept a
 * review from a guest with a completed reservation, and carry that reference
 * on every row. Open platforms like Google let anyone post and supply no
 * reference, so those come through unverified.
 *
 * Placeholder values ("-", "n/a", "undefined") are treated as absent -- some
 * exports fill the column rather than leaving it blank.
 */
export const isVerifiedStay = (r: { reservationNumber?: string }): boolean => {
  const id = (r.reservationNumber || '').trim();
  if (!id) return false;
  const lower = id.toLowerCase();
  if (['-', '--', 'n/a', 'na', 'none', 'null', 'undefined', '0'].includes(lower)) return false;
  // Require at least one alphanumeric character.
  return /[a-z0-9]/i.test(id);
};

/**
 * Common non-English stop words and characteristic terms across top guest origin languages
 * (German, Spanish, French, Italian, Portuguese, Dutch, Catalan, etc.).
 */
const NON_ENGLISH_WORDS = new Set([
  // German
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines',
  'und', 'ist', 'sind', 'war', 'waren', 'sehr', 'gut', 'gute', 'gutes', 'guter', 'sauber',
  'freundlich', 'personal', 'zimmer', 'lage', 'unterkunft', 'frühstück', 'fruehstueck',
  'dusche', 'bad', 'laut', 'ruhig', 'früh', 'bett', 'betten', 'sauberkeit', 'großartig',
  'schön', 'schoen', 'nicht', 'alles', 'keine', 'auch', 'mit', 'ohne', 'aber', 'wieder',
  'empfehlen', 'empfehlenswert', 'prima', 'aufenthaltsraum', 'reisende', 'komfortable',
  'tolle', 'balkon', 'küche', 'kueche', 'gastgeber',
  // Spanish & Catalan
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'pero', 'por', 'para',
  'con', 'sin', 'del', 'al', 'es', 'son', 'fue', 'fueron', 'muy', 'bueno', 'buena', 'buenos',
  'buenas', 'excelente', 'habitacion', 'habitación', 'habitaciones', 'ubicacion', 'ubicación',
  'limpio', 'limpia', 'limpieza', 'personal', 'ruido', 'ruidoso', 'estancia', 'instalaciones',
  'desayuno', 'cama', 'camas', 'baño', 'banio', 'atencion', 'atención', 'increible',
  'increíble', 'gracias', 'nada', 'todo', 'todos', 'todas', 'tot', 'tota', 'tots', 'totes',
  'bien', 'mal', 'mala', 'lugar', 'volveria', 'volvería', 'recomendable', 'amable', 'gente',
  'limpiesito', 'ubicadissimo',
  // French
  'les', 'le', 'la', 'une', 'des', 'et', 'ou', 'mais', 'par', 'pour', 'avec', 'sans',
  'du', 'dans', 'sur', 'est', 'sont', 'ont', 'pas', 'plus', 'tres', 'très',
  'bien', 'bon', 'bonne', 'chambre', 'chambres', 'personnel', 'propre', 'propreté',
  'emplacement', 'bruit', 'bruyant', 'douche', 'lit', 'lits', 'petit', 'déjeuner',
  'petit-déjeuner', 'colazione', 'accueil', 'magnifique', 'parfait', 'parfaite', 'superbe',
  'calme', 'confortable', 'tous', 'tout', 'merci', 'chose', 'grand', 'sale', 'personne',
  'nettoie', 'apres', 'après', 'matin', 'soir', 'egalement', 'également', 'odeurs',
  'lumieres', 'lumières', 'couloirs', 'egouts', 'égouts', 'horrible', 'horriblement',
  // Italian
  'il', 'lo', 'la', 'gli', 'le', 'uno', 'una', 'ma', 'per', 'con',
  'senza', 'del', 'della', 'degli', 'molto', 'buono', 'buona', 'ottimo', 'ottima', 'pulito',
  'pulita', 'pulizia', 'posizione', 'camera', 'camere', 'personale', 'colazione', 'bagno',
  'letto', 'letti', 'rumore', 'rumoroso', 'accoglienza', 'magico', 'tutto', 'grazie',
  // Portuguese
  'os', 'as', 'uns', 'umas', 'ou', 'mas', 'por', 'para', 'com',
  'sem', 'do', 'da', 'dos', 'das', 'na', 'nos', 'nas', 'muito', 'bom', 'boa', 'otimo',
  'ótimo', 'otima', 'ótima', 'excelente', 'limpo', 'limpa', 'limpeza', 'quarto', 'quartos',
  'localização', 'localizacao', 'equipe', 'equipa', 'café', 'cafe', 'atendimento', 'tudo',
  'obrigado', 'obrigada', 'lugar',
  // Dutch
  'het', 'een', 'en', 'of', 'maar', 'voor', 'met', 'zonder', 'van', 'zeer',
  'goed', 'goede', 'schoon', 'schoonheid', 'kamer', 'kamers', 'personeel', 'locatie',
  'ontbijt', 'douche', 'bedden', 'lawaai', 'rustig', 'vriendelijk', 'niet',
]);

/**
 * Returns true if text contains non-English characters or vocabulary.
 * Evaluates non-Latin scripts (Chinese, Japanese, Korean, Cyrillic, Arabic, Thai, Greek, etc.),
 * Latin-script diacritics/accents, and characteristic non-English terms.
 */
export const isNonEnglishText = (text: string | undefined | null): boolean => {
  if (!text || !isValidFeedback(text)) return false;
  const trimmed = text.trim();

  // 1. Non-Latin scripts (Han, Hiragana, Katakana, Hangul, Cyrillic, Arabic, Thai, Greek, Hebrew, etc.)
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Thai}\p{Script=Greek}\p{Script=Hebrew}]/u.test(trimmed)) {
    return true;
  }

  // 2. Accented characters common in non-English Latin scripts
  if (/[áéíóúñäöüßàâçèêëîïôùûœãõìòùøåæ¿¡]/i.test(trimmed)) {
    return true;
  }

  // 3. Check for distinct non-English vocabulary words
  const words = trimmed.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return false;

  // Words that also occur in ordinary English sentences. Counting them as
  // foreign flagged plainly English reviews (e.g. one mentioning "a la carte"
  // or "no" and "so") for re-translation on every load, wasting API quota.
  const AMBIGUOUS_WITH_ENGLISH = new Set([
    'a', 'an', 'as', 'at', 'be', 'but', 'can', 'do', 'die', 'don', 'el', 'em',
    'en', 'era', 'es', 'fine', 'for', 'had', 'he', 'in', 'is', 'it', 'la',
    'las', 'le', 'les', 'man', 'me', 'mine', 'no', 'not', 'on', 'or', 'os',
    'of', 'per', 'plus', 'sale', 'so', 'son', 'te', 'the', 'to', 'un', 'us', 'van',
    'was', 'we', 'wed', 'wij', 'you',
  ]);

  let nonEnglishWordCount = 0;
  for (const word of words) {
    if (NON_ENGLISH_WORDS.has(word) && !AMBIGUOUS_WITH_ENGLISH.has(word)) {
      nonEnglishWordCount++;
    }
  }

  // Trigger if at least 1 non-English word for ultra-short feedback (1-5 words),
  // or at least 2 words / 15% ratio for longer feedback
  if (words.length <= 5 && nonEnglishWordCount >= 1) return true;
  if (words.length > 5 && (nonEnglishWordCount >= 2 || (nonEnglishWordCount / words.length) >= 0.15)) return true;

  return false;
};

/**
 * Returns true if a review contains non-English text that lacks a translated English version,
 * or whose current translation remains non-English.
 */
export const needsEnglishTranslation = (review: {
  reviewTitle?: string;
  positiveReview?: string;
  negativeReview?: string;
  propertyReply?: string;
  translatedTitle?: string;
  translatedPositive?: string;
  translatedNegative?: string;
  translatedReply?: string;
}): boolean => {
  const titleNeeds = isNonEnglishText(review.reviewTitle) && (!review.translatedTitle || isNonEnglishText(review.translatedTitle));
  const posNeeds = isNonEnglishText(review.positiveReview) && (!review.translatedPositive || isNonEnglishText(review.translatedPositive));
  const negNeeds = isNonEnglishText(review.negativeReview) && (!review.translatedNegative || isNonEnglishText(review.translatedNegative));
  const replyNeeds = isNonEnglishText(review.propertyReply) && (!review.translatedReply || isNonEnglishText(review.translatedReply));

  return titleNeeds || posNeeds || negNeeds || replyNeeds;
};

