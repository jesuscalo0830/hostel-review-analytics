import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReviewCSV } from '../utils/csvParser';

// Consolidated exports (one file, a Hostel column, several properties) were
// only handled on the XLSX path. Saved as .csv they parsed to zero rows:
// detectPlatform guessed plain Agoda, whose parser requires a "Review score"
// column that this format calls "Overall score".
const AGODA_HEADER =
  'Hostel,Review date,Guest name,Country,Traveler type,Room,Stay,' +
  'Booking number (BID),Review title,Comment,Overall score,Cleanliness,' +
  'Location,Facilities,Value for money,Service';

const AGODA_ROWS = [
  'Hipstercity,2026-05-01,MIYOUNG,South Korea,Solo travelers,Small Double Bed in Dorm,' +
    'April 2026 (3 nights),1721212108,Different from the photos,"Moldy smell by the door.",' +
    '6.4,6,8,4,4,10',
  'RadZone,2026-04-29,Umemura,Japan,Solo travelers,Single Non-Smoking,' +
    'April 2026 (1 night),1702634489,Not good except location,"Shared spaces lack cleanliness.",' +
    '3.2,2,8,2,4,4',
].join('\n');

const parsed = () => parseReviewCSV(`${AGODA_HEADER}\n${AGODA_ROWS}\n`);

test('consolidated Agoda CSV parses instead of yielding zero rows', () => {
  assert.equal(parsed().length, 2);
});

test('consolidated Agoda CSV: Overall score maps to reviewScore', () => {
  const [first, second] = parsed();
  assert.equal(first.reviewScore, 6.4);
  assert.equal(second.reviewScore, 3.2);
});

test('consolidated Agoda CSV: the Hostel column sets the property per row', () => {
  const [first, second] = parsed();
  assert.equal(first.property, 'Hipstercity');
  assert.equal(second.property, 'RadZone');
});

test('consolidated Agoda CSV: Service maps to staff, BID to reservation number', () => {
  const [first] = parsed();
  assert.equal(first.staff, 10);
  assert.equal(first.cleanliness, 6);
  assert.equal(first.valueForMoney, 4);
  assert.equal(first.reservationNumber, '1721212108');
  assert.equal(first.platform, 'Agoda');
});

test('consolidated Agoda CSV: Comment becomes the review text', () => {
  const [first] = parsed();
  assert.match(first.positiveReview, /moldy smell/i);
});

test('a genuine single-property Agoda CSV still parses', () => {
  // Guard against the new dispatch swallowing the original Agoda format.
  const plain =
    'Review date,Review score,Service,Value for money,Cleanliness,Location,Facilities,Review\n' +
    '2026-05-02,8,8,8,8,8,8,"Nice place"\n';
  const out = parseReviewCSV(plain);
  assert.equal(out.length, 1);
  assert.equal(out[0].reviewScore, 8);
});
