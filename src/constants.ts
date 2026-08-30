import type { BookingReview } from './types';

export const SAMPLE_CSV = `Review date,Guest name,Reservation number,Review title,Positive review,Negative review,Review score,Staff,Cleanliness,Location,Facilities,Comfort,Value for money,Property reply
2026-02-09,Jane Sample,DEMO-0001,Excellent stay at Hipstercity,Loved the location and the friendly staff at Hipstercity. Quiet at night.,The wifi was a bit slow in the evenings.,9,9,9,10,8,9,9,Thanks for the feedback - we are upgrading the wifi this month.
2026-02-10,John Demo,DEMO-0002,Great value at Radzone,Radzone has a clean lobby and great coffee. Beds were comfy.,Showers were cold for 10 minutes in the morning.,8,8,8,9,7,8,9,
2026-02-11,Alex Test,DEMO-0003,Comfortable Hipstercity stay,Hipstercity room was clean and the kitchen had everything we needed.,Could use more power outlets near the bed.,8,9,9,8,7,8,8,
2026-02-12,Sam Example,DEMO-0004,CoZzzee was OK,CoZzzee location is decent for the price.,Reception was unmanned during my late check-in. Got resolved by virtual assistant.,7,6,8,8,7,7,8,
2026-02-13,Pat Mock,DEMO-0005,Solid Radzone visit,Radzone staff were responsive and the bed was very comfortable.,The breakfast variety was limited.,8,9,8,9,8,9,8,
2026-02-14,Riley Placeholder,DEMO-0006,Hipstercity recommended,Hipstercity has a great vibe and the lounge is welcoming.,A few minor noise issues from the street.,8,8,8,9,8,8,8,
2026-02-15,Casey Fake,DEMO-0007,Average CoZzzee experience,CoZzzee location is good for budget travelers.,Cleaning could be more thorough in the bathroom.,6,7,5,8,7,6,8,Thank you for the feedback - we have re-trained the cleaning team.
2026-02-16,Jordan Synthetic,DEMO-0008,Loved Radzone,Radzone is modern and the security was reassuring.,Limited cutlery in the shared kitchen.,9,9,9,9,9,9,9,
2026-02-17,Taylor Stub,DEMO-0009,Hipstercity was perfect,Hipstercity is exactly what I needed for a short stay.,,10,10,10,10,10,10,10,
2026-02-18,Morgan Demo,DEMO-0010,Disappointed with CoZzzee,Decent location.,The room was smaller than the photos suggested and the AC was loud at night.,5,6,7,8,6,5,5,Apologies - we are reviewing the room photos and the AC unit has been serviced.`;
/**
 * Property names the dashboard searches for in review text and roomName fields.
 * Edit this list when adding/removing properties -- it's referenced from both
 * the property-segment filter buttons and the HostelComparisonReport.
 */
export const PROPERTY_NAMES = ['Hipstercity', 'Radzone', 'CoZzzee'] as const;
export type PropertyName = typeof PROPERTY_NAMES[number];

/**
 * Display locations for each known property.
 *
 * Used by ReviewCard and the data tables so reviews show "Hipstercity * Singapore"
 * instead of just "GENERAL". Edit these strings to match the actual addresses
 * or city labels you want to show.
 *
 * The Radzone address comes from the PMS export ("9A Circular Road,
 * Singapore"). Hipstercity and CoZzzee are placeholders until you confirm.
 */
export const PROPERTY_LOCATIONS: Record<PropertyName, string> = {
  Hipstercity: 'Singapore',
  Radzone: '9A Circular Road, Singapore',
  CoZzzee: '9 Circular Rd, Singapore',
};

/**
 * Maps a free-form property label onto the canonical name in PROPERTY_NAMES.
 *
 * Exports label the same building inconsistently -- a sheet tab reading
 * "RadZone Hostel", a column reading "Radzone", review text saying "radzone".
 * Without this they become separate property segments: scores get split across
 * two entries in Property Comparison, the filter buttons miss half the data,
 * and PROPERTY_LOCATIONS (keyed on the canonical name) finds no address, so
 * the location goes missing on the review card.
 *
 * Matching ignores case, punctuation, and a trailing "hostel"/"hotel"/"hostels".
 * An unrecognised label is returned trimmed but otherwise untouched, so a
 * genuinely new property still shows up rather than being silently dropped.
 */
export const canonicalPropertyName = (raw: string | undefined | null): string | null => {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  const normalise = (s: string) =>
    s.toLowerCase()
      .replace(/\b(hostels?|hotels?)\b/g, '')
      .replace(/[^a-z0-9]/g, '');
  const key = normalise(trimmed);
  if (!key) return trimmed;
  for (const name of PROPERTY_NAMES) {
    if (normalise(name) === key) return name;
  }
  return trimmed;
};

/**
 * Resolves a review to a property name by checking the explicit property field,
 * or matching roomName + review text fields against the PROPERTY_NAMES list.
 */
export const resolvePropertyForReview = (r: BookingReview): string | null => {
  // 1. Explicit property field wins (set at upload time via majority vote or tab/column).
  if (r.property && r.property.trim()) {
    return canonicalPropertyName(r.property);
  }
  // 2. Fall back to per-review text matching for legacy data without property set.
  const hay = (
    (r.roomName || '') + ' ' +
    (r.reviewTitle || '') + ' ' +
    (r.translatedTitle || '') + ' ' +
    (r.positiveReview || '') + ' ' +
    (r.translatedPositive || '') + ' ' +
    (r.negativeReview || '') + ' ' +
    (r.translatedNegative || '')
  ).toLowerCase();
  for (const name of PROPERTY_NAMES) {
    if (hay.includes(name.toLowerCase())) return name;
  }
  return null;
};
