import Papa from 'papaparse';
import { BookingReview, ReviewPlatform } from '../types';

/**
 * Parse a numeric score cell.
 *
 * Convention: 0 means "no rating provided". Booking sub-scores never land
 * at 0 (lowest is 2.5), so 0 is safe as the missing-value sentinel.
 *
 * Robust to: whitespace, locale decimal commas (e.g. "8,5"), percent signs,
 * the literal "-" / "--" placeholder, and "N/A" variants.
 */
export const parseScore = (val: any): number => {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  const s = String(val).trim();
  if (s === '' || s === '-' || s === '—' || s === 'N/A' || s.toLowerCase() === 'n/a') return 0;
  const cleaned = s.replace(/%/g, '').replace(',', '.');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
};

const stripBOM = (s: string): string =>
  s.length > 0 && s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;

const papaOptions = {
  header: true as const,
  skipEmptyLines: true as const,
  dynamicTyping: false as const,
  transformHeader: (h: string) => h.trim(),
};

/**
 * Case-insensitive key lookup on a row object. Source exports are wildly
 * inconsistent about capitalisation ("Review date" vs "Review Date"), so
 * every parser reads cells through this rather than exact-matching keys.
 */
const getCI = (row: any, ...keys: string[]): any => {
  const lower: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) lower[k.toLowerCase().trim()] = v;
  for (const key of keys) {
    const val = lower[key.toLowerCase()];
    if (val !== undefined && val !== '') return val;
  }
  return '';
};

/**
 * Normalise a platform label from a "Platform" column ("Booking.com",
 * "Agoda", "Airbnb"...) onto the app's ReviewPlatform union.
 */
const normalisePlatformLabel = (raw: any): ReviewPlatform => {
  const s = String(raw || '').toLowerCase();
  if (s.includes('booking')) return 'Booking';
  if (s.includes('agoda')) return 'Agoda';
  if (s.includes('expedia')) return 'Expedia';
  if (s.includes('google')) return 'Google';
  if (s.includes('airbnb')) return 'Airbnb';
  if (s.includes('pms')) return 'PMS';
  return 'Other';
};

/**
 * True when the header row looks like the "Guest Reviews" consolidated
 * export: a single free-text `Review Text` column, an `Overall Rating`
 * (already on a 1-10 scale) and optionally a `Platform` column naming the
 * source site per row.
 */
const isGuestReviewsHeader = (headers: string[]): boolean => {
  const h = headers.map(k => k.toLowerCase().trim());
  const has = (needle: string) => h.some(hh => hh.includes(needle));
  return has('review text') && (has('overall rating') || has('review date'));
};

const isTripComHeader = (headers: string[]): boolean => {
  const h = headers.map(k => k.toLowerCase().trim());
  const has = (needle: string) => h.some(hh => hh.includes(needle));
  return has('star rating') || has('posted date') || has('reviewer name') || has('original score');
};

/**
 * Inspect the first non-empty header row of a CSV and decide which platform
 * format it represents. Returns 'Booking' for the legacy default and the
 * specific platform when characteristic columns are present.
 */
export const detectPlatform = (csvString: string): ReviewPlatform => {
  const firstLine = stripBOM(csvString).split('\n')[0] || '';
  const headers = firstLine.toLowerCase();

  // "Guest Reviews" consolidated export -- single Review Text column. The
  // real platform is per-row (Platform column), so report 'Other' here and
  // let the row parser assign it.
  if (isGuestReviewsHeader(firstLine.split(','))) {
    return 'Other';
  }
  // PMS-style export: External ID + Rental Name + Address + Verified Email
  if (headers.includes('external id') && headers.includes('rental name') && headers.includes('verified email')) {
    return 'PMS';
  }
  // Agoda: has "service" sub-score and a single "review" field (no positive/negative split)
  if (headers.includes('service') && headers.includes('value for money') && !headers.includes('positive review')) {
    return 'Agoda';
  }
  // Booking: positive + negative split, plus the six standard sub-scores
  if (headers.includes('positive review') && headers.includes('negative review')) {
    return 'Booking';
  }
  return 'Other';
};

// ----------------------------------------------------------------------
// Booking format
// ----------------------------------------------------------------------

const parseBookingRows = (rows: any[]): BookingReview[] => {
  return rows.flatMap((row: any) => {
    const rawDate = String(row['Check-Out Date'] || row['Review date'] || row['Date'] || '').trim();
    const resNum = String(row['External ID'] || row['Reservation Number'] || row['Reservation ID'] || row['Reservation number'] || '').trim();
    
    // Ignore duplicate header lines from concatenated CSV files
    if (resNum.toLowerCase().includes('reservation number') || rawDate.toLowerCase().includes('review date')) {
      return [];
    }

    const reviewScore = parseScore(row['Overall Score'] || row['Review score'] || row['Score']);
    const reviewTitle = String(row['Review title'] || '').trim();
    const positiveReview = String(row['Review'] || row['Positive review'] || row['Positive'] || '');
    const negativeReview = String(row['Negative review'] || row['Negative'] || '');

    // Skip empty lines
    if (!rawDate && !resNum && reviewScore === 0 && !reviewTitle && !positiveReview && !negativeReview) {
      return [];
    }

    return [{
      reviewDate: rawDate,
      reservationNumber: resNum,
      guestName: String(row['Guest name'] || row['Guest Name'] || '').trim(),
      reviewTitle,
      roomName: String(row['Rental Name'] || row['Room name'] || row['Room type'] || row['Accommodation'] || 'General').trim(),
      positiveReview,
      negativeReview,
      reviewScore,
      staff: parseScore(row['Staff Score'] || row['Staff']),
      cleanliness: parseScore(row['Cleanliness Score'] || row['Cleanliness']),
      location: parseScore(row['Location Score'] || row['Location']),
      facilities: parseScore(row['Facilities Score'] || row['Facilities']),
      comfort: parseScore(row['Comfort Score'] || row['Comfort']),
      valueForMoney: parseScore(row['Value for money Score'] || row['Value for money'] || row['Value']),
      propertyReply: String(row['Property Comment'] || row['Property reply'] || row['Response'] || ''),
      platform: 'Booking' as ReviewPlatform,
    }];
  });
};

// ----------------------------------------------------------------------
// Agoda format -- single "Review" field, no Comfort, "Service" instead of "Staff"
// ----------------------------------------------------------------------

const parseAgodaRows = (rows: any[]): BookingReview[] => {
  return rows.flatMap((row: any) => {
    // Agoda exports include header rows for property names -- skip them.
    if (!row['Review date'] || !row['Review score']) return [];
    return [{
      reviewDate: String(row['Review date'] || '').trim(),
      reservationNumber: String(row['Reservation Number'] || row['Reservation number'] || '').replace(/^BID:\s*/i, '').trim(),
      guestName: String(row['Guest name'] || row['Guest Name'] || '').trim(),
      reviewTitle: String(row['Review title'] || '').trim(),
      roomName: String(row['Room name'] || row['Rental Name'] || 'General').trim(),
      // Agoda's single "Review" field maps to positive; we don't have a separate negative
      positiveReview: String(row['Review'] || ''),
      negativeReview: '',
      reviewScore: parseScore(row['Review score']),
      staff: parseScore(row['Service']),  // Agoda's equivalent of Staff
      cleanliness: parseScore(row['Cleanliness']),
      location: parseScore(row['Location']),
      facilities: parseScore(row['Facilities']),
      comfort: 0, // Agoda doesn't report Comfort
      valueForMoney: parseScore(row['Value for money']),
      propertyReply: String(row['Property reply'] || ''),
      platform: 'Agoda' as ReviewPlatform,
    }];
  });
};

// ----------------------------------------------------------------------
// PMS / 3rd-party export -- 1-5 scale, normalised to 1-10
// ----------------------------------------------------------------------

const parsePMSRows = (rows: any[]): BookingReview[] => {
  return rows.map((row: any) => {
    const norm = (raw: any) => {
      const v = parseScore(raw);
      return v > 0 ? v * 2 : 0; // 1-5 -> 1-10
    };
    const review = String(row['Review'] || row['Property Comment'] || '');
    return {
      reviewDate: String(row['Check-Out Date'] || '').trim(),
      reservationNumber: String(row['External ID'] || '').trim(),
      guestName: [row['First Name'], row['Last Name']].filter(Boolean).map((s: any) => String(s).trim()).join(' '),
      reviewTitle: '',
      roomName: String(row['Rental Name'] || 'General').trim(),
      positiveReview: review,
      negativeReview: '',
      reviewScore: norm(row['Overall Score']),
      staff: norm(row['Staff Score']),
      cleanliness: norm(row['Cleanliness Score']),
      location: 0, // PMS export doesn't include these
      facilities: 0,
      comfort: 0,
      valueForMoney: 0,
      propertyReply: '',
      platform: 'PMS' as ReviewPlatform,
    };
  });
};

// ----------------------------------------------------------------------
// "Guest Reviews" consolidated export
//
// One row per review with a single free-text `Review Text` column, scores
// already on a 1-10 scale, and a `Platform` column naming the source site.
// Shared by the CSV and XLSX paths.
//
// Text routing: this format has no positive/negative split, so the guest's
// own score decides where the text lands -- <= 6 goes to negativeReview so
// the review surfaces in the Critical Issues / negative-theme reports, above
// that to positiveReview. Without this, single-field reviews are invisible
// to every critical-feedback view.
// ----------------------------------------------------------------------

const NEGATIVE_SCORE_CUTOFF = 6;

export const parseGuestReviewsRows = (
  rows: any[],
  property?: string
): BookingReview[] => {
  return rows.flatMap((row: any) => {
    const rawDate = getCI(row, 'Review Date', 'Date', 'Posted Date');
    const reviewScore = parseScore(
      getCI(row, 'Overall Rating (/10)', 'Overall Rating', 'Overall Score', 'Review Score', 'Score')
    );
    const text = String(getCI(row, 'Review Text', 'Review', 'Comment') || '').trim();

    // Drop spacer / subtotal rows: nothing usable at all.
    if (!rawDate && reviewScore === 0 && !text) return [];

    const isNegative = reviewScore > 0 && reviewScore <= NEGATIVE_SCORE_CUTOFF;

    return [{
      reviewDate: parseDateLoose(rawDate),
      reservationNumber: String(getCI(row, 'Booking ID', 'Reservation Number', 'External ID') || '').trim(),
      guestName: String(getCI(row, 'Guest Name', 'Reviewer Name', 'Reviewer') || '').trim(),
      reviewTitle: String(getCI(row, 'Review Title', 'Title') || '').trim(),
      roomName: String(getCI(row, 'Room Type', 'Room Name', 'Rental Name') || 'General').trim(),
      positiveReview: isNegative ? '' : text,
      negativeReview: isNegative ? text : '',
      reviewScore,
      staff: parseScore(getCI(row, 'Service', 'Staff')),
      cleanliness: parseScore(getCI(row, 'Cleanliness')),
      location: parseScore(getCI(row, 'Location')),
      facilities: parseScore(getCI(row, 'Facilities')),
      comfort: parseScore(getCI(row, 'Comfort')),
      valueForMoney: parseScore(getCI(row, 'Value for Money', 'Value')),
      propertyReply: String(getCI(row, 'Management Response', 'Property Reply', 'Owner Response', 'Response') || ''),
      platform: normalisePlatformLabel(getCI(row, 'Platform', 'Source', 'Channel')),
      property,
      /** Extra columns this format carries that the core reports don't use yet. */
      country: String(getCI(row, 'Country') || '').trim() || undefined,
      travelerType: String(getCI(row, 'Traveler Type', 'Traveller Type') || '').trim() || undefined,
      nights: parseScore(getCI(row, 'Nights')) || undefined,
    }];
  });
};

// ----------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------


import { PROPERTY_NAMES } from '../constants';

/**
 * Inspect a batch of parsed reviews and assign a `property` field to every
 * row based on the property name most-mentioned across the whole file.
 *
 * Why majority-vote at the file level rather than per-review text matching:
 * a typical Booking export has 800+ reviews of which only ~15% mention the
 * property by name. Per-review detection therefore tags 85% of rows as
 * "General" and breaks per-property analytics. Assuming "one CSV = one
 * property" recovers the right grouping for the common case (users export
 * Booking data per-property).
 *
 * If no property names appear in any review text, no tagging happens.
 */
export const tagWithMajorityProperty = (reviews: BookingReview[]): BookingReview[] => {
  if (reviews.length === 0) return reviews;
  const counts: Record<string, number> = {};
  for (const r of reviews) {
    const hay = (
      (r.roomName || '') + ' ' +
      (r.reviewTitle || '') + ' ' +
      (r.translatedTitle || '') + ' ' +
      (r.positiveReview || '') + ' ' +
      (r.translatedPositive || '') + ' ' +
      (r.negativeReview || '') + ' ' +
      (r.translatedNegative || '') + ' ' +
      (r.propertyReply || '') + ' ' +
      (r.translatedReply || '')
    ).toLowerCase();
    for (const name of PROPERTY_NAMES) {
      if (hay.includes(name.toLowerCase())) {
        counts[name] = (counts[name] || 0) + 1;
        break;  // one tally per review
      }
    }
  }
  // Pick the property that appears in the most reviews. Require at least 5%
  // of the file (or 1 review) to mention it -- otherwise leave property unset.
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return reviews;
  const [winner, hits] = entries[0];
  const minHits = Math.max(1, Math.floor(reviews.length * 0.05));
  if (hits < minHits) return reviews;
  return reviews.map(r => ({ ...r, property: winner }));
};

/**
 * Parse a CSV from any supported platform (Booking, Agoda, PMS).
 * Auto-detects the format from the header row.
 */
export const parseReviewCSV = (csvString: string): BookingReview[] => {
  const cleaned = stripBOM(csvString);
  const platform = detectPlatform(cleaned);
  const result = Papa.parse(cleaned, papaOptions);
  const rows = result.data as any[];

  // Several formats cannot be identified from detectPlatform's platform
  // guess alone -- they are recognised from the header row instead. The
  // XLSX path already dispatches on exactly these, so reuse its detector
  // rather than maintaining two divergent sets of rules: a consolidated
  // export saved as .csv must parse the same as the .xlsx version.
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  switch (detectSheetFormat(headers)) {
    case 'guest-reviews':
      return tagWithMajorityProperty(parseGuestReviewsRows(rows));
    case 'consolidated-agoda':
      return parseConsolidatedAgodaRows(rows);
    case 'consolidated-booking':
      return parseConsolidatedBookingRows(rows);
    case 'consolidated-airbnb':
      return parseConsolidatedAirbnbRows(rows);
    case 'tripcom':
      return tagWithMajorityProperty(parseTripComRows(rows, undefined));
    default:
      break;   // fall through to the platform-based parsers below
  }

  let parsed: BookingReview[];
  switch (platform) {
    case 'Agoda':   parsed = parseAgodaRows(rows); break;
    case 'PMS':     parsed = parsePMSRows(rows); break;
    case 'Booking':
    case 'Other':
    default:        parsed = parseBookingRows(rows);
  }
  return tagWithMajorityProperty(parsed);
};

/**
 * Backwards-compatible alias. Kept so existing callers (App.tsx, tests, sample
 * data flow) don't have to change. Newly-written code should prefer
 * `parseReviewCSV` for clarity.
 */
export const parseBookingCSV = parseReviewCSV;

export interface ScoreAveragesWithCounts {
  overall: number;
  staff: number;
  cleanliness: number;
  location: number;
  facilities: number;
  comfort: number;
  valueForMoney: number;
  counts: {
    overall: number;
    staff: number;
    cleanliness: number;
    location: number;
    facilities: number;
    comfort: number;
    valueForMoney: number;
    total: number;
  };
}

export const calculateAverages = (reviews: BookingReview[]): ScoreAveragesWithCounts | null => {
  if (reviews.length === 0) return null;

  const sums = { overall: 0, staff: 0, cleanliness: 0, location: 0, facilities: 0, comfort: 0, valueForMoney: 0 };
  const counts = { overall: 0, staff: 0, cleanliness: 0, location: 0, facilities: 0, comfort: 0, valueForMoney: 0, total: reviews.length };

  reviews.forEach(r => {
    if (r.reviewScore > 0) { sums.overall += r.reviewScore; counts.overall++; }
    if (r.staff > 0) { sums.staff += r.staff; counts.staff++; }
    if (r.cleanliness > 0) { sums.cleanliness += r.cleanliness; counts.cleanliness++; }
    if (r.location > 0) { sums.location += r.location; counts.location++; }
    if (r.facilities > 0) { sums.facilities += r.facilities; counts.facilities++; }
    if (r.comfort > 0) { sums.comfort += r.comfort; counts.comfort++; }
    if (r.valueForMoney > 0) { sums.valueForMoney += r.valueForMoney; counts.valueForMoney++; }
  });

  const round1 = (n: number) => Number(n.toFixed(1));

  return {
    overall: counts.overall > 0 ? round1(sums.overall / counts.overall) : 0,
    staff: counts.staff > 0 ? round1(sums.staff / counts.staff) : 0,
    cleanliness: counts.cleanliness > 0 ? round1(sums.cleanliness / counts.cleanliness) : 0,
    location: counts.location > 0 ? round1(sums.location / counts.location) : 0,
    facilities: counts.facilities > 0 ? round1(sums.facilities / counts.facilities) : 0,
    comfort: counts.comfort > 0 ? round1(sums.comfort / counts.comfort) : 0,
    valueForMoney: counts.valueForMoney > 0 ? round1(sums.valueForMoney / counts.valueForMoney) : 0,
    counts,
  };
};

// ----------------------------------------------------------------------
// XLS / XLSX multi-sheet parser
// Each worksheet is treated as a separate property (sheet name = property).
// ----------------------------------------------------------------------

/**
 * Parse an XLS/XLSX ArrayBuffer containing one or more sheets.
 * Each sheet is expected to have Booking-style columns.
 * The sheet name is used as the `property` field for every review in that sheet.
 */
// ----------------------------------------------------------------------
// XLS / XLSX multi-sheet parser
// Handles multiple file formats:
//   1. Standard Booking export (with or without Title Case headers)
//   2. RADZON/Trip.com format (Star Rating 1-5, Review Text, Posted Date)
//   3. Consolidated multi-platform (Booking.com/Agoda/Airbnb sheets with Hostel column)
// ----------------------------------------------------------------------

const KNOWN_PLATFORM_BANNERS = ['booking.com','agoda','airbnb','expedia','tripadvisor','google'];
const SKIP_SHEETS = ['summary'];
/**
 * Sheet names that carry no property information -- the property has to come
 * from the Summary sheet or the review text instead of the tab label.
 */
const GENERIC_SHEET_NAMES = /^(sheet\d*|reviews?|data|export|all)$/i;

const MONTH_NAMES = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

/**
 * True when a sheet name is a period label ("July 2026 Reviews", "Q3 2026")
 * or a generic tab name, rather than a property name.
 *
 * Without this, a monthly export lands every review under a property called
 * "July 2026 Reviews", polluting the property filter and Property Comparison
 * report with a bogus segment.
 */
const isGenericSheetName = (name: string): boolean => {
  const n = name.trim();
  if (GENERIC_SHEET_NAMES.test(n)) return true;
  if (/\b(19|20)\d{2}\b/.test(n)) return true;   // contains a year
  if (MONTH_NAMES.test(n) && /review|month|data/i.test(n)) return true;
  return false;
};

/**
 * True when a row is a decorative platform banner ("Booking.com" spanning the
 * sheet) rather than a data row.
 *
 * A banner row has its label in the first cell and nothing else. Requiring the
 * rest of the row to be empty matters: exports with a real `Platform` column
 * hold "Booking.com" in the first cell of EVERY row, and the old
 * first-cell-only check silently discarded the entire file.
 */
const isPlatformBannerRow = (row: any): boolean => {
  const values = Object.values(row);
  if (values.length === 0) return false;
  const first = String(values[0] ?? '').toLowerCase().trim();
  if (!KNOWN_PLATFORM_BANNERS.includes(first)) return false;
  const rest = values.slice(1).filter(v => String(v ?? '').trim() !== '');
  return rest.length === 0;
};

/** Extract property name from sign-off in reply text. */
const extractPropertyFromReply = (reply: string): string | undefined => {
  const m = reply.match(/(?:^|\.\s+|\n)(?:best\s+regards?|warm\s+regards?|kind\s+regards?|yours\s+truly)[,.]?\s*([A-Z][^\n]{3,60})/i);
  return m ? m[1].trim() : undefined;
};

/**
 * Format a Date as YYYY-MM-DD using its LOCAL calendar fields.
 *
 * Deliberately not toISOString(): strings like "Jan 27, 2026" and XLSX date
 * cells parse to local midnight, and toISOString() then converts to UTC,
 * shifting the date back a day for every timezone east of Greenwich. That
 * silently moved reviews into the previous month on the trend charts.
 */
const toLocalISODate = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Parse "Jan 27, 2026" or "Oct 2025" style dates to a YYYY-MM-DD string. */
const parseDateLoose = (raw: any): string => {
  if (!raw) return '';
  if (raw instanceof Date) return toLocalISODate(raw);
  const s = String(raw).trim();
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.split('T')[0];
  // "Jan 27, 2026"
  const full = Date.parse(s);
  if (!isNaN(full)) return toLocalISODate(new Date(full));
  // "Oct 2025" → use 1st of month
  const m = s.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const d = Date.parse(`${m[1]} 1, ${m[2]}`);
    if (!isNaN(d)) return toLocalISODate(new Date(d));
  }
  return s;
};

/** Parse "2.0/10" or "10/10" → number */
const parseSlashScore = (val: any): number => {
  if (!val) return 0;
  const s = String(val);
  const m = s.match(/^([\d.]+)\s*\/\s*10/);
  return m ? parseFloat(m[1]) : 0;
};

/** Detect which format a sheet uses based on its headers. */
type SheetFormat = 'standard' | 'tripcom' | 'pms' | 'guest-reviews' | 'consolidated-booking' | 'consolidated-agoda' | 'consolidated-airbnb' | 'skip';

const detectSheetFormat = (headers: string[]): SheetFormat => {
  const h = headers.map(k => k.toLowerCase().trim());
  const has = (...keys: string[]) => keys.every(k => h.some(hh => hh.includes(k)));

  // Checked first: this format also has a 'Review Date' column, which would
  // otherwise fall through to 'standard' and lose the Overall Rating mapping.
  if (isGuestReviewsHeader(headers)) return 'guest-reviews';
  if (has('star rating')) return 'tripcom';
  if (has('external id') && has('rental name') && has('first name')) return 'pms';
  if (has('hostel') && has('positive review')) return 'consolidated-booking';
  if (has('hostel') && has('comment') && has('overall score')) return 'consolidated-agoda';
  if (has('hostel') && has('public review') && !has('review score')) return 'consolidated-airbnb';
  if (h.some(hh => hh.includes('review date') || hh.includes('review score') || hh.includes('positive review'))) return 'standard';
  return 'skip';
};

const parsePmsXlsRows = (rows: any[], property: string | undefined): BookingReview[] => {
  const norm = (raw: any) => { const v = parseScore(raw); return v > 0 ? v * 2 : 0; };
  return rows.map(row => {
    const review = String(getCI(row, 'Review', 'Property Comment') || '');
    return {
      reviewDate: String(getCI(row, 'Check-Out Date') || '').trim().split('T')[0].split(' ')[0],
      reservationNumber: String(getCI(row, 'External ID') || '').trim(),
      guestName: [getCI(row, 'First Name'), getCI(row, 'Last Name')].filter(Boolean).map((s: any) => String(s).trim()).join(' '),
      reviewTitle: '',
      roomName: String(getCI(row, 'Rental Name') || 'General').trim(),
      positiveReview: review,
      negativeReview: '',
      reviewScore: norm(getCI(row, 'Overall Score')),
      staff: norm(getCI(row, 'Staff Score')),
      cleanliness: norm(getCI(row, 'Cleanliness Score')),
      location: 0,
      facilities: 0,
      comfort: 0,
      valueForMoney: 0,
      propertyReply: '',
      platform: 'PMS' as ReviewPlatform,
      property,
    };
  }).filter(r => r.reviewDate || r.reviewScore > 0);
};

const parseStandardRows = (rows: any[], property: string | undefined): BookingReview[] => {
  let detectedProperty = property;
  return rows
    .filter(row => !isPlatformBannerRow(row))
    .map(row => {
      const reply = String(getCI(row, 'Property Reply', 'Property reply'));
      if (!detectedProperty && reply) detectedProperty = extractPropertyFromReply(reply);
      const rawDate = getCI(row, 'Review Date', 'Review date', 'Check-Out Date', 'Date');
      return {
        reviewDate: parseDateLoose(rawDate),
        reservationNumber: String(getCI(row, 'Reservation Number', 'Reservation number', 'External ID')).trim(),
        guestName: String(getCI(row, 'Guest Name', 'Guest name')).trim(),
        reviewTitle: String(getCI(row, 'Review Title', 'Review title')).trim(),
        roomName: String(getCI(row, 'Room Name', 'Room name', 'Rental Name') || 'General').trim(),
        positiveReview: String(getCI(row, 'Positive Review', 'Positive review', 'Review')),
        negativeReview: String(getCI(row, 'Negative Review', 'Negative review')),
        reviewScore: parseScore(getCI(row, 'Review Score', 'Review score', 'Overall Score', 'Score')),
        staff: parseScore(getCI(row, 'Staff')),
        cleanliness: parseScore(getCI(row, 'Cleanliness')),
        location: parseScore(getCI(row, 'Location')),
        facilities: parseScore(getCI(row, 'Facilities')),
        comfort: parseScore(getCI(row, 'Comfort')),
        valueForMoney: parseScore(getCI(row, 'Value for Money', 'Value for money')),
        propertyReply: reply,
        platform: 'Booking' as ReviewPlatform,
        property: detectedProperty,
      };
    })
    .filter(r => r.reviewDate || r.reviewScore > 0);
};

const parseTripComRows = (rows: any[], property: string | undefined): BookingReview[] => {
  return rows
    .filter(row => row['#'] && String(row['#']).match(/^\d+$/))
    .map(row => {
      const starRating = parseScore(getCI(row, 'Star Rating (1-5)', 'Star Rating'));
      const slashScore = parseSlashScore(getCI(row, 'Original Score (10pt)', 'Original Score'));
      const reviewScore = slashScore > 0 ? slashScore : starRating * 2;
      return {
        reviewDate: parseDateLoose(getCI(row, 'Posted Date')),
        reservationNumber: '',
        guestName: String(getCI(row, 'Reviewer Name') || '').trim(),
        reviewTitle: String(getCI(row, 'Title') || '').trim(),
        roomName: String(getCI(row, 'Stayed In', 'Room') || 'General').trim(),
        positiveReview: String(getCI(row, 'Review Text', 'Review') || ''),
        negativeReview: '',
        reviewScore,
        staff: 0,
        cleanliness: 0,
        location: 0,
        facilities: 0,
        comfort: 0,
        valueForMoney: 0,
        propertyReply: String(getCI(row, 'Owner Response', 'Response') || ''),
        platform: 'Other' as ReviewPlatform,
        property,
      };
    })
    .filter(r => r.reviewDate || r.reviewScore > 0);
};

const parseConsolidatedBookingRows = (rows: any[]): BookingReview[] =>
  rows.map(row => ({
    reviewDate: parseDateLoose(getCI(row, 'Review date', 'Review Date')),
    reservationNumber: String(getCI(row, 'Reservation number', 'Reservation Number') || '').trim(),
    guestName: String(getCI(row, 'Guest name', 'Guest Name') || '').trim(),
    reviewTitle: String(getCI(row, 'Review title', 'Review Title') || '').trim(),
    roomName: 'General',
    positiveReview: String(getCI(row, 'Positive review', 'Positive Review') || ''),
    negativeReview: String(getCI(row, 'Negative review', 'Negative Review') || ''),
    reviewScore: parseScore(getCI(row, 'Review score', 'Review Score')),
    staff: parseScore(getCI(row, 'Staff')),
    cleanliness: parseScore(getCI(row, 'Cleanliness')),
    location: parseScore(getCI(row, 'Location')),
    facilities: parseScore(getCI(row, 'Facilities')),
    comfort: parseScore(getCI(row, 'Comfort')),
    valueForMoney: parseScore(getCI(row, 'Value for money', 'Value for Money')),
    propertyReply: String(getCI(row, 'Property reply', 'Property Reply') || ''),
    platform: 'Booking' as ReviewPlatform,
    property: String(getCI(row, 'Hostel') || '').trim() || undefined,
  })).filter(r => r.reviewDate || r.reviewScore > 0);

const parseConsolidatedAgodaRows = (rows: any[]): BookingReview[] =>
  rows.map(row => ({
    reviewDate: parseDateLoose(getCI(row, 'Review date', 'Review Date')),
    reservationNumber: String(getCI(row, 'Booking number (BID)', 'Booking Number', 'BID') || '').replace(/^BID:\s*/i, '').trim(),
    guestName: String(getCI(row, 'Guest name', 'Guest Name') || '').trim(),
    reviewTitle: String(getCI(row, 'Review title', 'Review Title') || '').trim(),
    roomName: String(getCI(row, 'Room') || 'General').trim(),
    positiveReview: String(getCI(row, 'Comment', 'Review') || ''),
    negativeReview: '',
    reviewScore: parseScore(getCI(row, 'Overall score', 'Overall Score', 'Review score')),
    staff: parseScore(getCI(row, 'Service')),
    cleanliness: parseScore(getCI(row, 'Cleanliness')),
    location: parseScore(getCI(row, 'Location')),
    facilities: parseScore(getCI(row, 'Facilities')),
    comfort: 0,
    valueForMoney: parseScore(getCI(row, 'Value for money', 'Value for Money')),
    propertyReply: '',
    platform: 'Agoda' as ReviewPlatform,
    property: String(getCI(row, 'Hostel') || '').trim() || undefined,
  })).filter(r => r.reviewDate || r.reviewScore > 0);

const parseConsolidatedAirbnbRows = (rows: any[]): BookingReview[] =>
  rows.map(row => ({
    reviewDate: parseDateLoose(getCI(row, 'Month', 'Date')),
    reservationNumber: '',
    guestName: String(getCI(row, 'Reviewer') || '').trim(),
    reviewTitle: '',
    roomName: 'General',
    positiveReview: String(getCI(row, 'Public review') || ''),
    negativeReview: String(getCI(row, 'Private feedback') || ''),
    reviewScore: 0,
    staff: 0, cleanliness: 0, location: 0, facilities: 0, comfort: 0, valueForMoney: 0,
    propertyReply: '',
    platform: 'Other' as ReviewPlatform,
    property: String(getCI(row, 'Hostel') || '').trim() || undefined,
  })).filter(r => r.positiveReview || r.negativeReview);

export const parseXLSBuffer = async (buffer: ArrayBuffer): Promise<BookingReview[]> => {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

  // Detect property name from Summary sheet if present
  let fileProperty: string | undefined;
  const summarySheet = workbook.SheetNames.find(s => s.toLowerCase() === 'summary');
  if (summarySheet) {
    const summaryRows = XLSX.utils.sheet_to_json(workbook.Sheets[summarySheet], { defval: '', header: 1 }) as any[][];
    const firstCell = String((summaryRows[0]?.[0]) || '');
    // e.g. "RadZone Hostel — Review Summary"
    const m = firstCell.match(/^(.+?)\s*[—–-]\s*/);
    if (m) fileProperty = m[1].trim();
  }

  const allReviews: BookingReview[] = [];

  for (const sheetName of workbook.SheetNames) {
    if (SKIP_SHEETS.includes(sheetName.toLowerCase())) continue;

    const ws = workbook.Sheets[sheetName];
    const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (rows.length === 0) continue;

    const headers = Object.keys(rows[0]);
    const format = detectSheetFormat(headers);
    if (format === 'skip') continue;

    const isGenericSheet = isGenericSheetName(sheetName);
    const sheetProperty = isGenericSheet ? fileProperty : sheetName;

    let parsed: BookingReview[] = [];
    switch (format) {
      case 'guest-reviews':
        parsed = parseGuestReviewsRows(rows, isGenericSheet ? fileProperty : sheetName);
        break;
      case 'tripcom':
        parsed = parseTripComRows(rows, fileProperty || sheetProperty);
        break;
      case 'consolidated-booking':
        parsed = parseConsolidatedBookingRows(rows);
        break;
      case 'consolidated-agoda':
        parsed = parseConsolidatedAgodaRows(rows);
        break;
      case 'consolidated-airbnb':
        parsed = parseConsolidatedAirbnbRows(rows);
        break;
      case 'pms':
        parsed = parsePmsXlsRows(rows, isGenericSheet ? fileProperty : sheetName);
        break;
      case 'standard':
      default:
        parsed = parseStandardRows(rows, isGenericSheet ? fileProperty : sheetName);
        break;
    }

    allReviews.push(...parsed);
  }

  // If no sheet name / Summary sheet supplied a property, fall back to the
  // same majority-vote-on-review-text detection the CSV path uses.
  if (allReviews.length > 0 && !allReviews.some(r => r.property)) {
    return tagWithMajorityProperty(allReviews);
  }

  return allReviews;
};
