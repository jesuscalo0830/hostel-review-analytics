import { GoogleGenAI, Type } from "@google/genai";
import { BookingReview } from "../types";

// ----------------------------------------------------------------------
// Response validators. The SDK enforces responseSchema on most paths,
// but the model can still emit malformed JSON or inject extra prose
// despite responseMimeType. Validate every parsed payload before use
// so a single bad response can't silently corrupt the dashboard.
// ----------------------------------------------------------------------

const isString = (v: unknown): v is string => typeof v === 'string';
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isSentiment = (v: unknown): v is 'positive' | 'negative' | 'neutral' =>
  v === 'positive' || v === 'negative' || v === 'neutral';

interface TranslationItem {
  title: string;
  pos: string;
  neg: string;
  reply: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
}

const validateTranslationArray = (raw: unknown): TranslationItem[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item: unknown): TranslationItem | null => {
      if (!item || typeof item !== 'object') return null;
      const o = item as Record<string, unknown>;
      // Coerce missing strings to empty rather than dropping the whole item
      const title = isString(o.title) ? o.title : '';
      const pos = isString(o.pos) ? o.pos : '';
      const neg = isString(o.neg) ? o.neg : '';
      const reply = isString(o.reply) ? o.reply : '';
      const sentiment = isSentiment(o.sentiment) ? o.sentiment : undefined;
      // If every field is empty, drop -- nothing to merge
      if (!title && !pos && !neg && !reply) return null;
      return { title, pos, neg, reply, sentiment };
    })
    .filter((x): x is TranslationItem => x !== null);
};

interface SentimentItem { sentiment: 'positive' | 'negative' | 'neutral'; }

const validateSentimentArray = (raw: unknown): SentimentItem[] => {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const s = (item as Record<string, unknown>).sentiment;
    return isSentiment(s) ? [{ sentiment: s }] : [];
  });
};

interface CategoriesPayload {
  categories: { name: string; count: number }[];
  summary: string;
}

const validateCategoriesPayload = (raw: unknown): CategoriesPayload | null => {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const summary = isString(o.summary) ? o.summary : '';
  if (!Array.isArray(o.categories)) return null;
  const categories = o.categories.flatMap((c: unknown) => {
    if (!c || typeof c !== 'object') return [];
    const co = c as Record<string, unknown>;
    if (!isString(co.name) || !isFiniteNumber(co.count)) return [];
    return [{ name: co.name.trim(), count: Math.max(0, Math.floor(co.count)) }];
  });
  if (categories.length === 0 && !summary) return null;
  return { categories, summary };
};

const safeParseJSON = (text: string | undefined): unknown => {
  if (!text) return null;
  // Strip markdown code fences if present
  const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch { return null; }
};


export async function generateInsights(reviews: BookingReview[], targetLanguage: string = "English") {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return "AI Analysis Error: No valid API key found. Please configure your GEMINI_API_KEY in the environment secrets.";
  }
  const ai = new GoogleGenAI({ apiKey });
  
  // Take a sample of reviews to avoid token limits if the list is huge
  const sampleReviews = reviews.slice(0, 20).map(r => ({
    score: r.reviewScore,
    pos: r.translatedPositive || r.positiveReview,
    neg: r.translatedNegative || r.negativeReview
  }));

  const prompt = `
    You are a boutique hostel management consultant and data scientist. Analyze these Booking.com reviews and provide a high-level strategic synthesis:
    1. **Strategic Strengths**: What are our top 3 competitive advantages that we should market?
    2. **Critical Vulnerabilities**: What are the top 3 systemic issues damaging our reputation?
    3. **Departmental Action Plan**:
       - **Housekeeping**: One specific task to improve cleanliness scores.
       - **Front Desk**: One protocol change to enhance guest welcome.
       - **Maintenance**: One priority repair based on recurring complaints.
    4. **The "North Star" Metric**: What is the single most important change needed to raise our overall rating by 1.0 point?

    IMPORTANT: Write the entire analysis in ${targetLanguage}. Use a professional tone.

    Reviews Data Sample:
    ${JSON.stringify(sampleReviews)}

    Return the analysis in a professional, structured markdown format with clear headers and bullet points. Use bold text for emphasis.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    return response.text;
  } catch (error) {
    console.error("Error generating insights:", error);
    return `Failed to generate insights. Please check your API key.`;
  }
}

/**
 * Result of an offline translation attempt, or undefined when the dictionary
 * had no match.
 *
 * offlineTranslate echoes its input when it cannot translate. Storing that
 * echo in `translated*` made untranslated reviews look translated: the
 * fields were populated, so success counters and any `translated || original`
 * render path treated them as done while the text was unchanged.
 */
const translatedOrUndefined = (source: string | undefined): string | undefined => {
  if (!source || !source.trim()) return undefined;
  const out = offlineTranslate(source);
  return out && out.trim() && out.trim() !== source.trim() ? out : undefined;
};

export async function translateReview(text: string, targetLanguage: string = "English") {
  if (!text || text.trim().length === 0 || text === "-") return text;
  
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  
  const prompt = `Translate the following text to ${targetLanguage}. If it's already in ${targetLanguage}, return it as is. Only return the translated text, nothing else.
  
  Text: "${text}"`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    return response.text?.trim() || text;
  } catch (error) {
    console.error("Error translating review:", error);
    return text;
  }
}

/**
 * Rule-based offline translator for common hostel review expressions across
 * German, French, Spanish, Catalan, Italian, Portuguese, and Dutch. Used as an
 * automatic fallback when Gemini API daily quota (429) is exhausted.
 */
/**
 * Verified human translations of review text present in the uploaded data.
 *
 * Checked before the regex phrase list and matched on the whole trimmed
 * string, so these render correctly with no API key configured. This covers
 * the reviews already in the dataset -- new foreign-language reviews still
 * need GEMINI_API_KEY, since a fixed table cannot translate unseen text.
 */
const EXACT_TRANSLATIONS: [string, string][] = [
  ["Qualche problema con l'aria condizionata, posizionata sopra la testa del letto. Per il resto ottima posizione e ottimo rapporto qualità prezzo per essere una città come Singapore", "Some problems with the air conditioning, positioned above the head of the bed. Otherwise, excellent location and excellent value for money for a city like Singapore."],
  ["Alloggio centrale, comodo ed economico per Singapore. Camera e bagno datati, posto letto davvero piccolo, senza mensole ne comodini.", "Central accommodation, convenient and affordable for Singapore. Room and bathroom are dated, the bed space is really small, with no shelves or bedside tables."],
  ["安くて清潔でした", "It was cheap and clean"],
  ["ホステルなのに2段ベッドでないところ", "That it isn't bunk beds, even though it's a hostel"],
  ["还满期待再回去住的", "I'm quite looking forward to staying there again"],
  ["床很舒服，很柔暖，还满干净的", "The bed is very comfortable, soft and warm, and quite clean"],
  ["建议柜台有人比较好，有些不懂英语的不会自己登记", "I'd suggest having someone at the front desk -- some people who don't understand English can't check themselves in"],
  ["Prima Lage, sehr sauber, netter Aufenthaltsraum, nette andere Reisende, komfortable Betten", "Prime location, very clean, nice common room, nice fellow travellers, comfortable beds"],
  ["Leider stört der Bass der Musik der vielen Bars in der Umgebung beim Schlafen. Umso weiter innen  das Bett im Dorm liegt, umso leiser!", "Unfortunately the bass from the music of the many bars nearby disturbs your sleep. The further inside the dorm your bed is, the quieter it gets!"],
  ["La sala relax con caffè, tè , la vicinanza con il centro città, bagni in comune ma puliti.", "The lounge with coffee and tea, the closeness to the city centre, shared bathrooms but clean."],
  ["A volte la notte è un po' rumorosa o al mattino si sentono le sveglie, anche se non si potrebbe farle suonare.", "Sometimes the night is a bit noisy, or in the morning you hear alarm clocks, even though people shouldn't be setting them off."],
  ["Molt mal tracte per part del personal", "Very bad treatment from the staff"],
  ["Res", "Nothing"],
  ["Tot", "Everything"],
  ["Goede locatie en prima voor kort verblijf", "Good location and fine for a short stay"],
  ["Goede locatie", "Good location"],
  ["Hygiëne was niet overal even goed", "Hygiene was not equally good everywhere"],
  ["Pas fou", "Not great"],
  ["Positive: Pas grand chose. Negative: Les toilettes, horriblement sale personne nettoie apres etre aller, le bruit jusqu'a 3h du matin voir plus horrible egalement, les lumieres sans cesse allumer dans les couloirs par les autres, les odeurs d'egouts.", "Positive: not much. Negative: the toilets, horribly dirty -- nobody cleans after using them; the noise until 3am or later, equally horrible; the lights constantly left on in the corridors by other people; the smell of sewage."],
];

const EXACT_LOOKUP = new Map<string, string>(
  EXACT_TRANSLATIONS.map(([src, en]) => [src.trim().replace(/\s+/g, ' '), en])
);

export function offlineTranslate(text: string | undefined | null): string {
  if (!text || text.trim() === '' || text === '-') return text || '';
  const trimmed = text.trim();

  // Whole-string match first: a verified translation always beats the
  // partial regex substitutions below.
  const exact = EXACT_LOOKUP.get(trimmed.replace(/\s+/g, ' '));
  if (exact) return exact;

  // Phrase-level dictionary
  const PHRASES: [RegExp, string][] = [
    [/Prima Lage, sehr sauber, netter Aufenthaltsraum, nette andere Reisende, komfortable Betten/i, 'Great location, very clean, nice common room, nice other travelers, comfortable beds'],
    [/Pas grand chose\.? Negative:? Les toilettes,? horriblement sale.*$/i, 'Positive: Not much. Negative: Toilets horribly dirty, no one cleans after using, noise until 3am or worse, lights constantly left on in hallways, sewage smells.'],
    [/Pas grand chose/i, 'Not much'],
    [/Les toilettes, horriblement sale/i, 'The toilets, horribly dirty'],
    [/le bruit jusqu'a 3h du matin/i, 'noise until 3am'],
    [/les odeurs d'egouts/i, 'sewage smells'],
    [/Prima Lage/i, 'Great location'],
    [/sehr sauber/i, 'very clean'],
    [/netter Aufenthaltsraum/i, 'nice common room'],
    [/nette andere Reisende/i, 'nice other travelers'],
    [/komfortable Betten/i, 'comfortable beds'],
    [/^Tot$/i, 'All / Everything'],
    [/Sehr gut und sauber/i, 'Very good and clean'],
    [/Sehr gut/i, 'Very good'],
    [/Das Zimmer war sehr laut/i, 'The room was very loud'],
    [/Freundliches Personal/i, 'Friendly staff'],
    [/Tolle Lage/i, 'Great location'],
    [/Muy bueno y limpio/i, 'Very good and clean'],
    [/La ubicación es excelente/i, 'The location is excellent'],
    [/Habitación cómoda/i, 'Comfortable room'],
    [/personal muy amable/i, 'very friendly staff'],
    [/Très bon emplacement/i, 'Very good location'],
    [/chambre propre/i, 'clean room'],
    [/Personnel accueillant/i, 'Welcoming staff'],
    [/Ottima posizione/i, 'Great location'],
    [/stanza molto pulita/i, 'very clean room'],
    [/Muito bom hostel/i, 'Very good hostel'],
    [/perto de tudo/i, 'close to everything'],
    [/Zeer goed en schoon/i, 'Very good and clean'],
    [/Vriendelijk personeel/i, 'Friendly staff'],
  ];

  let result = trimmed;
  for (const [regex, replacement] of PHRASES) {
    if (regex.test(result)) {
      result = result.replace(regex, replacement);
    }
  }

  // Word-level replacement for residual terms if string was modified
  if (result !== trimmed) {
    return result;
  }

  // Single-word catalog fallback
  const WORD_MAP: Record<string, string> = {
    'tot': 'All / Everything',
    'sehr': 'very',
    'gut': 'good',
    'sauber': 'clean',
    'lage': 'location',
    'zimmer': 'room',
    'laut': 'loud',
    'bett': 'bed',
    'betten': 'beds',
    'muy': 'very',
    'bueno': 'good',
    'limpio': 'clean',
    'cama': 'bed',
    'tres': 'very',
    'très': 'very',
    'bon': 'good',
    'propre': 'clean',
    'lit': 'bed',
  };

  const lower = trimmed.toLowerCase();
  if (WORD_MAP[lower]) {
    return WORD_MAP[lower];
  }

  return trimmed;
}

/**
 * Progress callback fired after each chunk finishes.
 *
 * `partial` is the full review array with everything translated so far, so a
 * caller can persist as it goes. Without this, a long run that is cut short
 * loses every translation it had already paid for.
 */
export type TranslationProgress = (
  partial: BookingReview[],
  done: number,
  total: number
) => void;

export async function translateReviewsBatch(
  reviews: BookingReview[],
  targetLanguage: string,
  onProgress?: TranslationProgress
) {
  if (reviews.length === 0) return reviews;
  
  const apiKey = process.env.GEMINI_API_KEY;
  const isKeyInvalid = !apiKey || apiKey === "MY_GEMINI_API_KEY";
  
  // We'll translate title, positive, negative reviews and property replies
  const toTranslate = reviews.map((r, i) => ({
    id: i,
    title: r.reviewTitle,
    pos: r.positiveReview,
    neg: r.negativeReview,
    reply: r.propertyReply
  })).filter(r => 
    (r.title && r.title !== "-") || 
    (r.pos && r.pos !== "-") || 
    (r.neg && r.neg !== "-") || 
    (r.reply && r.reply !== "-")
  );

  if (toTranslate.length === 0) return reviews;

  const updatedReviews = [...reviews];

  if (isKeyInvalid) {
    console.warn("Translation: No valid API key. Applying offline dictionary fallback.");
    toTranslate.forEach(item => {
      updatedReviews[item.id] = {
        ...updatedReviews[item.id],
        translatedTitle: translatedOrUndefined(item.title),
        translatedPositive: translatedOrUndefined(item.pos),
        translatedNegative: translatedOrUndefined(item.neg),
        translatedReply: translatedOrUndefined(item.reply),
      };
    });
    return updatedReviews;
  }

  const ai = new GoogleGenAI({ apiKey });

  // Split into chunks of 20 to reduce total API request count
  const chunkSize = 20;
  /** 15 requests/minute on the free tier -> one every 4s, plus a margin. */
  const MIN_REQUEST_GAP_MS = 4500;
  const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

  /** A 429 means the quota is spent; hammering it wastes the remaining budget. */
  const isRateLimit = (err: unknown): boolean =>
    /\b429\b|RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(String((err as any)?.message ?? err ?? ''));
  let rateLimited = false;

  for (let i = 0; i < toTranslate.length; i += chunkSize) {
    const chunk = toTranslate.slice(i, i + chunkSize);

    // Gemini's free tier allows 15 requests per minute -- one every 4s. A
    // 2.5s gap is 24/min, which overruns the limit and gets nearly every
    // request rejected with 429 after the first one or two succeed.
    if (i > 0) await delay(MIN_REQUEST_GAP_MS);

    const prompt = `
      You are a professional translator specializing in travel and hospitality. 
      Translate the following hostel review segments to ${targetLanguage}.
      
      CRITICAL RULES:
      1. Every response field ("title", "pos", "neg", "reply") MUST be translated into ${targetLanguage} regardless of the source language.
      2. If the source text contains encoding artifacts (like "Ã³", "Ã±", "Ã"), interpret them correctly as their intended characters (e.g., "Ã³" is "ó") before translating.
      3. If a segment is already in ${targetLanguage}, you may return it as is, but ensure any encoding errors are fixed.
      4. DO NOT include any text other than the JSON array in your response.
      5. Maintain the original sentiment and intensity of the guest's feedback.
      
      Data to translate (JSON array):
      ${JSON.stringify(chunk.map(t => ({ title: t.title, pos: t.pos, neg: t.neg, reply: t.reply })))}
    `;

    let success = false;
    let retries = 3;

    while (!success && retries > 0) {
      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.6-flash",
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  pos: { type: Type.STRING },
                  neg: { type: Type.STRING },
                  reply: { type: Type.STRING },
                  sentiment: { type: Type.STRING, enum: ["positive", "negative", "neutral"] }
                },
                required: ["title", "pos", "neg", "reply", "sentiment"]
              }
            }
          }
        });

        const results = validateTranslationArray(safeParseJSON(response.text));
        if (results.length === 0) {
          console.warn(`Batch translation: dropped malformed response for chunk ${i}`);
          retries--;
          if (retries > 0) await delay(1500);
          continue;
        }

        chunk.forEach((item, index) => {
          const r = results[index];
          if (r) {
            updatedReviews[item.id] = {
              ...updatedReviews[item.id],
              translatedTitle: r.title || translatedOrUndefined(item.title),
              translatedPositive: r.pos || translatedOrUndefined(item.pos),
              translatedNegative: r.neg || translatedOrUndefined(item.neg),
              translatedReply: r.reply || translatedOrUndefined(item.reply),
            };
          }
        });
        success = true;
      } catch (error: any) {
        retries--;
        const errMsg = String(error?.message || error || '');
        console.warn(`Batch translation chunk ${i} failed (${retries} retries left). Error:`, errMsg);
        if (isRateLimit(error)) {
          // Exponential backoff, then give up on the whole run. Continuing to
          // send requests against an exhausted quota just returns more 429s
          // and delays the point at which the user is told what happened.
          if (retries > 0) {
            await delay(8000 * (3 - retries));
          } else {
            rateLimited = true;
            console.warn(
              `[translate] Gemini quota exhausted at chunk ${i}. ` +
              `${i} of ${toTranslate.length} reviews were translated and saved; ` +
              `the rest resume on the next load once quota resets.`
            );
          }
        } else if (retries > 0) {
          await delay(2500);
        } else {
          // If Gemini API fails (e.g. 429 Rate Limit / Quota Exhausted), apply offline translation fallback
          console.warn(`Chunk ${i} API calls exhausted. Applying offline dictionary translation...`);
          chunk.forEach(item => {
            updatedReviews[item.id] = {
              ...updatedReviews[item.id],
              translatedTitle: translatedOrUndefined(item.title),
              translatedPositive: translatedOrUndefined(item.pos),
              translatedNegative: translatedOrUndefined(item.neg),
              translatedReply: translatedOrUndefined(item.reply),
            };
          });
        }
      }
    }

    // Hand back what is done so far. The caller persists it, so a timeout or
    // a rate-limit stop keeps the chunks already translated.
    onProgress?.(
      [...updatedReviews],
      Math.min(i + chunkSize, toTranslate.length),
      toTranslate.length
    );

    if (rateLimited) break;
  }

  return updatedReviews;
}

export async function categorizeNegativeReviews(reviews: BookingReview[], targetLanguage: string = "English") {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    throw new Error("No valid API key found. Please configure your GEMINI_API_KEY.");
  }
  const ai = new GoogleGenAI({ apiKey });
  
  const negativeText = reviews
    .filter(r => r.reviewScore <= 6)
    .slice(0, 30) // Sample for context
    .map(r => r.translatedNegative || r.negativeReview)
    .filter(t => t && t.length > 10)
    .join("\n---\n");

  if (!negativeText) return null;

  const prompt = `
    Analyze the following negative feedback from hostel guests. 
    Categorize the issues into the following themes and provide a count of how many reviews mention each theme (estimate based on the provided text).
    Themes: Cleanliness, Noise, Facilities, Staff, Location, Value.
    Also, provide a short 1-2 sentence summary of the most critical recurring issues.
    
    IMPORTANT: Return the "name" of each category and the "summary" in ${targetLanguage}.
    
    Feedback:
    ${negativeText}

    Return a JSON object with "categories" (array of {name, count}) and "summary" (string).
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            categories: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  count: { type: Type.NUMBER }
                },
                required: ["name", "count"]
              }
            },
            summary: { type: Type.STRING }
          },
          required: ["categories", "summary"]
        }
      }
    });

    const validated = validateCategoriesPayload(safeParseJSON(response.text));
    if (!validated) {
      console.warn("Categorize: dropped malformed response");
      return null;
    }
    return validated;
  } catch (error) {
    console.error("Error categorizing reviews:", error);
    return null;
  }
}

export async function analyzeSentimentBatch(reviews: BookingReview[]) {
  if (reviews.length === 0) return reviews;
  
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  
  // Sentiment is pinned to ORIGINAL-language text. We read from reviewTitle /
  // positiveReview / negativeReview (never the translated* variants) and skip
  // any review whose sentiment is already set, so re-translation passes don't
  // re-trigger sentiment analysis on stale-but-fine data.
  const toAnalyze = reviews
    .map((r, i) => ({
      id: i,
      title: r.reviewTitle,
      pos: r.positiveReview,
      neg: r.negativeReview,
      hasSentiment: !!r.sentiment,
    }))
    .filter(r => !r.hasSentiment && (r.pos || r.neg));

  if (toAnalyze.length === 0) return reviews;

  const chunkSize = 15;
  const updatedReviews = [...reviews];

  for (let i = 0; i < toAnalyze.length; i += chunkSize) {
    const chunk = toAnalyze.slice(i, i + chunkSize);
    
    const prompt = `
      Determine the overall sentiment of each review (positive, negative, or neutral).
      Return a JSON array of objects with "sentiment" keys in the same order.
      "sentiment" must be one of: "positive", "negative", "neutral".
      
      Data:
      ${JSON.stringify(chunk.map(t => ({ title: t.title, pos: t.pos, neg: t.neg })))}
    `;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                sentiment: { type: Type.STRING, enum: ["positive", "negative", "neutral"] }
              },
              required: ["sentiment"]
            }
          }
        }
      });

      const results = validateSentimentArray(safeParseJSON(response.text));
      if (results.length === 0) {
        console.warn(`Sentiment: dropped malformed response for chunk ${i}`);
        continue;
      }
      
      chunk.forEach((item, index) => {
        const r = results[index];
        if (r) {
          updatedReviews[item.id] = {
            ...updatedReviews[item.id],
            sentiment: r.sentiment
          };
        }
      });
    } catch (error) {
      console.error(`Sentiment analysis error for chunk ${i}:`, error);
    }
  }

  return updatedReviews;
}

/**
 * Drafts a professional, empathetic reply to a negative review for a hotel/
 * hostel property manager. Returns the reply text in the requested language.
 * Returns null when no API key is configured or the call fails.
 */
export async function draftReplyToReview(
  review: BookingReview,
  targetLanguage: string = "English"
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    console.warn("draftReplyToReview: no API key configured");
    return null;
  }
  const ai = new GoogleGenAI({ apiKey });

  const propertyName = review.property || 'our property';
  const guestName = review.guestName?.trim() || 'guest';
  const negativeText = (review.translatedNegative || review.negativeReview || '').slice(0, 1200);
  const positiveText = (review.translatedPositive || review.positiveReview || '').slice(0, 400);
  const score = review.reviewScore;

  const prompt = `
You are a hospitality manager replying to a critical guest review on Booking.com.
Write a reply in ${targetLanguage} that:
  1. Thanks the guest by name (use "${guestName}" if it is a real first name, otherwise "you").
  2. Acknowledges the specific concerns they raised, without making excuses.
  3. Briefly states what is being done to address each concern (be concrete, not generic).
  4. Invites them to return so the team can show the improvement.
  5. Keeps the tone warm, professional, and under 130 words.
  6. Does NOT promise refunds, discounts, or compensation.
  7. Does NOT use stock phrases like "your feedback is important to us".

Context:
  Property: ${propertyName}
  Score: ${score}/10
  What the guest liked: ${positiveText || '(none provided)'}
  What the guest disliked: ${negativeText || '(none provided)'}

Return ONLY the reply text, no preamble, no markdown, no quotation marks.
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const text = response.text?.trim();
    if (!text) return null;
    // Strip accidental wrapping quotes
    return text.replace(/^["']|["']$/g, '').trim();
  } catch (err) {
    console.error("draftReplyToReview failed:", err);
    return null;
  }
}

