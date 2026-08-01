import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReviewCSV, detectPlatform, parseGuestReviewsRows } from '../utils/csvParser';

// The "Guest Reviews" consolidated export: single Review Text column, scores
// already on 1-10, per-row Platform column. Regression coverage for the
// upload that previously parsed to zero rows.
const GR_HEADER =
  'Platform,Booking ID,Guest Name,Country,Overall Rating (/10),Cleanliness,' +
  'Value for Money,Location,Service,Facilities,Traveler Type,Room Type,' +
  'Stay Period,Nights,Review Title,Review Date,Review Text,Management Response,Response Date';

const GR_ROW_LOW =
  'Booking.com,2034499735,NITIN,India,2,2,2,2,2,2,Solo travelers,Single Bed in Dorm,' +
  'July 2026,1,Deposit not returned,2026-07-26,"Never got my deposit back.",,';

const GR_ROW_HIGH =
  'Agoda,2033000271,Prasad,Sri Lanka,10,10,10,10,10,10,Business travelers,Double Bed in Dorm,' +
  'July 2026,1,Great Ambience,2026-07-23,"Wonderful stay, very central.","Thanks!",2026-07-24';

test('Guest Reviews: parses rows that previously yielded zero', () => {
  const out = parseReviewCSV(`${GR_HEADER}\n${GR_ROW_LOW}\n${GR_ROW_HIGH}\n`);
  assert.equal(out.length, 2);
});

test('Guest Reviews: maps Overall Rating (/10) to reviewScore without rescaling', () => {
  const [low, high] = parseReviewCSV(`${GR_HEADER}\n${GR_ROW_LOW}\n${GR_ROW_HIGH}\n`);
  assert.equal(low.reviewScore, 2);
  assert.equal(high.reviewScore, 10);
});

test('Guest Reviews: sub-scores and Service->staff mapping', () => {
  const [low] = parseReviewCSV(`${GR_HEADER}\n${GR_ROW_LOW}\n`);
  assert.equal(low.staff, 2);          // from "Service"
  assert.equal(low.cleanliness, 2);
  assert.equal(low.valueForMoney, 2);
  assert.equal(low.facilities, 2);
});

test('Guest Reviews: per-row Platform column sets platform', () => {
  const [low, high] = parseReviewCSV(`${GR_HEADER}\n${GR_ROW_LOW}\n${GR_ROW_HIGH}\n`);
  assert.equal(low.platform, 'Booking');   // "Booking.com"
  assert.equal(high.platform, 'Agoda');
});

test('Guest Reviews: single Review Text routes by score so critical reports see it', () => {
  const [low, high] = parseReviewCSV(`${GR_HEADER}\n${GR_ROW_LOW}\n${GR_ROW_HIGH}\n`);
  assert.equal(low.negativeReview, 'Never got my deposit back.');
  assert.equal(low.positiveReview, '');
  assert.equal(high.positiveReview, 'Wonderful stay, very central.');
  assert.equal(high.negativeReview, '');
});

test('Guest Reviews: Booking ID, guest, room type, reply and date', () => {
  const [, high] = parseReviewCSV(`${GR_HEADER}\n${GR_ROW_LOW}\n${GR_ROW_HIGH}\n`);
  assert.equal(high.reservationNumber, '2033000271');
  assert.equal(high.guestName, 'Prasad');
  assert.equal(high.roomName, 'Double Bed in Dorm');
  assert.equal(high.propertyReply, 'Thanks!');
  assert.equal(high.reviewDate, '2026-07-23');
});

test('Guest Reviews: carries country / travelerType / nights', () => {
  const [low] = parseReviewCSV(`${GR_HEADER}\n${GR_ROW_LOW}\n`);
  assert.equal(low.country, 'India');
  assert.equal(low.travelerType, 'Solo travelers');
  assert.equal(low.nights, 1);
});

test('Guest Reviews: header matching is case-insensitive', () => {
  const lower = GR_HEADER.toLowerCase();
  const out = parseReviewCSV(`${lower}\n${GR_ROW_LOW}\n`);
  assert.equal(out.length, 1);
  assert.equal(out[0].reviewScore, 2);
  assert.equal(out[0].guestName, 'NITIN');
});

test('Guest Reviews: decimal ratings survive', () => {
  const row = GR_ROW_LOW.replace(',India,2,', ',India,6.8,');
  const [r] = parseReviewCSV(`${GR_HEADER}\n${row}\n`);
  assert.equal(r.reviewScore, 6.8);
});

test('Guest Reviews: "Month YYYY" dates normalise to the 1st', () => {
  const row = GR_ROW_LOW.replace(',2026-07-26,', ',July 2026,');
  const [r] = parseReviewCSV(`${GR_HEADER}\n${row}\n`);
  assert.equal(r.reviewDate, '2026-07-01');
});

test('Guest Reviews: rows with no date, score or text are dropped', () => {
  const out = parseGuestReviewsRows([
    { Platform: 'Booking.com', 'Review Date': '', 'Overall Rating (/10)': '', 'Review Text': '' },
    { Platform: 'Booking.com', 'Review Date': '2026-07-01', 'Overall Rating (/10)': 8, 'Review Text': 'ok' },
  ]);
  assert.equal(out.length, 1);
});

test('Guest Reviews: a real Platform column is not mistaken for a banner row', () => {
  // Regression: every row starting with "Booking.com" used to be discarded as
  // a decorative platform banner, emptying the whole file.
  const out = parseReviewCSV(`${GR_HEADER}\n${GR_ROW_LOW}\n${GR_ROW_LOW}\n${GR_ROW_LOW}\n`);
  assert.equal(out.length, 3);
});

test('Guest Reviews: detectPlatform reports Other (platform is per-row)', () => {
  assert.equal(detectPlatform(GR_HEADER + '\n'), 'Other');
});

test('Guest Reviews: does not regress Agoda detection for real Agoda files', () => {
  const agoda = 'Review date,Review score,Service,Value for money,Cleanliness,Location,Facilities,Review';
  assert.equal(detectPlatform(agoda + '\n'), 'Agoda');
});

test('parseDateLoose: no UTC off-by-one for "Mon D, YYYY" dates', () => {
  // Regression: toISOString() on a locally-parsed date shifted every date back
  // a day in positive-offset timezones.
  const row = GR_ROW_LOW.replace(',2026-07-26,', ',"Jan 27, 2026",');
  const [r] = parseReviewCSV(`${GR_HEADER}\n${row}\n`);
  assert.equal(r.reviewDate, '2026-01-27');
});

test('sheet names that are period labels are not treated as properties', async () => {
  // Regression: a "July 2026 Reviews" tab created a bogus property segment.
  const XLSX = await import('xlsx');
  const make = (sheetName: string) => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Review date', 'Review score', 'Positive review', 'Negative review'],
      ['2026-07-02', 8, 'Nice place', ''],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  };
  const { parseXLSBuffer } = await import('../utils/csvParser');

  const period = await parseXLSBuffer(make('July 2026 Reviews'));
  assert.equal(period.length, 1);
  assert.equal(period[0].property, undefined);

  // A real property name still comes through from the tab label.
  const named = await parseXLSBuffer(make('CoZzzee'));
  assert.equal(named[0].property, 'CoZzzee');
});
