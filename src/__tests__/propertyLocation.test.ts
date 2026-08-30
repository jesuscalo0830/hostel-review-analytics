import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPropertyName, resolvePropertyForReview, PROPERTY_LOCATIONS } from '../constants';
import type { BookingReview } from '../types';

const review = (o: Partial<BookingReview>): BookingReview => ({
  reviewDate: '2026-07-01', reservationNumber: '1', reviewTitle: '', roomName: 'General',
  positiveReview: '', negativeReview: '', reviewScore: 8,
  staff: 0, cleanliness: 0, location: 0, facilities: 0, comfort: 0, valueForMoney: 0,
  propertyReply: '', ...o,
});

test('canonicalPropertyName: a "Hostel" suffix does not create a second property', () => {
  // Regression: a "RadZone Hostel" sheet tab split Radzone into two segments
  // and lost the mapped address on 17 reviews.
  assert.equal(canonicalPropertyName('RadZone Hostel'), 'Radzone');
  assert.equal(canonicalPropertyName('Radzone Hotel'), 'Radzone');
  assert.equal(canonicalPropertyName('cozzzee hostel'), 'CoZzzee');
});

test('canonicalPropertyName: ignores case, spacing and punctuation', () => {
  assert.equal(canonicalPropertyName('  RADZONE  '), 'Radzone');
  assert.equal(canonicalPropertyName('radzone'), 'Radzone');
  assert.equal(canonicalPropertyName('Hipster City'), 'Hipstercity');
  assert.equal(canonicalPropertyName('Co-Zzzee'), 'CoZzzee');
});

test('canonicalPropertyName: unknown properties pass through trimmed', () => {
  // A genuinely new property must still appear rather than be dropped.
  assert.equal(canonicalPropertyName('  Some New Place '), 'Some New Place');
});

test('canonicalPropertyName: empty input is null', () => {
  assert.equal(canonicalPropertyName(''), null);
  assert.equal(canonicalPropertyName('   '), null);
  assert.equal(canonicalPropertyName(undefined), null);
});

test('resolvePropertyForReview: canonicalises the explicit property field', () => {
  assert.equal(resolvePropertyForReview(review({ property: 'RadZone Hostel' })), 'Radzone');
});

test('every canonical property resolves to a mapped location', () => {
  for (const raw of ['RadZone Hostel', 'radzone', 'CoZzzee', 'Hipstercity']) {
    const name = resolvePropertyForReview(review({ property: raw }))!;
    assert.ok(
      (PROPERTY_LOCATIONS as Record<string, string>)[name],
      `no location mapped for "${raw}" -> "${name}"`
    );
  }
});
