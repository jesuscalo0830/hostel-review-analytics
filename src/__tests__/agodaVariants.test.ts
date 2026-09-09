import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReviewCSV } from '../utils/csvParser';

// Agoda's per-property export. Regression: this parsed to ZERO rows because
// parseAgodaRows required an exact `Review score` key, and this report calls
// it `Overall score`.
const PER_PROPERTY =
  'Review date,Guest name,Guest location,Traveler type,Room type,Stay period,BID,' +
  'Overall score,Cleanliness,Value for money,Location,Service,Facilities,Review title,Review comment\n' +
  '2026-09-04,Tian,Malaysia,Couples,Double Bed in Dorm,September 2026 (2 nights),1769117713,' +
  '7.2,4,6,10,10,6,Very Good,The air con not cool\n';

test('Agoda per-property export parses instead of yielding zero rows', () => {
  assert.equal(parseReviewCSV(PER_PROPERTY).length, 1);
});

test('Agoda per-property: Overall score maps to reviewScore', () => {
  assert.equal(parseReviewCSV(PER_PROPERTY)[0].reviewScore, 7.2);
});

test('Agoda per-property: Review comment becomes the review text', () => {
  assert.equal(parseReviewCSV(PER_PROPERTY)[0].positiveReview, 'The air con not cool');
});

test('Agoda per-property: Guest location is the country', () => {
  assert.equal(parseReviewCSV(PER_PROPERTY)[0].country, 'Malaysia');
  assert.equal(parseReviewCSV(PER_PROPERTY)[0].travelerType, 'Couples');
});

test('Agoda per-property: BID is the reservation number, Service is staff', () => {
  const [r] = parseReviewCSV(PER_PROPERTY);
  assert.equal(r.reservationNumber, '1769117713');
  assert.equal(r.staff, 10);
  assert.equal(r.cleanliness, 4);
  assert.equal(r.valueForMoney, 6);
  assert.equal(r.platform, 'Agoda');
});

test('the original Agoda layout still parses', () => {
  // Guard against the alias rewrite breaking the format it already handled.
  const original =
    'Review date,Review score,Service,Value for money,Cleanliness,Location,Facilities,Review\n' +
    '2026-05-02,8,8,8,8,8,8,"Nice place"\n';
  const [r] = parseReviewCSV(original);
  assert.equal(r.reviewScore, 8);
  assert.equal(r.positiveReview, 'Nice place');
});

test('rows with no date, score, text or title are dropped as banners', () => {
  const withBanner = PER_PROPERTY + ',,,,,,,,,,,,,,\n';
  assert.equal(parseReviewCSV(withBanner).length, 1);
});
