/**
 * Multi-platform parser tests.
 *
 * Run with:  npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReviewCSV, detectPlatform } from '../utils/csvParser';

const BOOKING_HEADER = 'Review date,Guest name,Reservation number,Review title,Positive review,Negative review,Review score,Staff,Cleanliness,Location,Facilities,Comfort,Value for money,Property reply';
const AGODA_HEADER = 'Review date,Guest name,Reservation Number,Review title,Review,Review score,Cleanliness,Location,Facilities,Value for money,Service,Property reply';
const PMS_HEADER = 'External ID,Rental Name,Address,City,Check-Out Date,First Name,Last Name,Staff Score,Cleanliness Score,Overall Score,Property Comment,Review,Email,Verified Email';

// ----------------------------------------------------------------------
// detectPlatform
// ----------------------------------------------------------------------

test('detectPlatform: Booking CSV with positive+negative split', () => {
  assert.equal(detectPlatform(BOOKING_HEADER + '\n'), 'Booking');
});

test('detectPlatform: Agoda CSV (Service column, single Review)', () => {
  assert.equal(detectPlatform(AGODA_HEADER + '\n'), 'Agoda');
});

test('detectPlatform: PMS CSV (External ID + Verified Email)', () => {
  assert.equal(detectPlatform(PMS_HEADER + '\n'), 'PMS');
});

test('detectPlatform: returns Other for unknown headers', () => {
  assert.equal(detectPlatform('foo,bar,baz\n'), 'Other');
});

test('detectPlatform: handles BOM-prefixed input', () => {
  assert.equal(detectPlatform('﻿' + BOOKING_HEADER + '\n'), 'Booking');
});

// ----------------------------------------------------------------------
// Booking parsing
// ----------------------------------------------------------------------

test('parseReviewCSV: Booking shape produces platform=Booking and standard sub-scores', () => {
  const csv = BOOKING_HEADER + '\n' +
    '"2026-01-01","Alice","R1","Great","loved it","none","9","9.5","9","10","9","9","9",""';
  const reviews = parseReviewCSV(csv);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].platform, 'Booking');
  assert.equal(reviews[0].reviewScore, 9);
  assert.equal(reviews[0].staff, 9.5);
  assert.equal(reviews[0].comfort, 9);
});

// ----------------------------------------------------------------------
// Agoda parsing
// ----------------------------------------------------------------------

test('parseReviewCSV: Agoda maps Service to staff and comfort to 0', () => {
  const csv = AGODA_HEADER + '\n' +
    '"January 10, 2026","Priskila","BID: 1968414207","Radzone Review","Clean hostel","10","10","10","10","10","10",""';
  const reviews = parseReviewCSV(csv);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].platform, 'Agoda');
  assert.equal(reviews[0].reviewScore, 10);
  assert.equal(reviews[0].staff, 10);  // From "Service" column
  assert.equal(reviews[0].comfort, 0); // Agoda doesn't report comfort
  assert.equal(reviews[0].cleanliness, 10);
  // Reservation number should have BID: stripped
  assert.equal(reviews[0].reservationNumber, '1968414207');
});

test('parseReviewCSV: Agoda skips header rows that have no review date', () => {
  const csv = AGODA_HEADER + '\n' +
    'RadZone,,,,,,,,,,,\n' +
    ',,,,,,,,,,,\n' +
    '"January 10, 2026","Priskila","BID: 1","title","review text","8","8","9","8","8","8",""';
  const reviews = parseReviewCSV(csv);
  assert.equal(reviews.length, 1, 'should skip the property-name header rows');
  assert.equal(reviews[0].platform, 'Agoda');
});

test('parseReviewCSV: Agoda single Review field maps to positiveReview', () => {
  const csv = AGODA_HEADER + '\n' +
    '"January 10, 2026","Alice","BID: 1","","Loved the location and clean rooms","9","9","9","9","9","9",""';
  const reviews = parseReviewCSV(csv);
  assert.equal(reviews[0].positiveReview, 'Loved the location and clean rooms');
  assert.equal(reviews[0].negativeReview, '');
});

// ----------------------------------------------------------------------
// PMS parsing
// ----------------------------------------------------------------------

test('parseReviewCSV: PMS scores normalised from 1-5 to 1-10', () => {
  const csv = PMS_HEADER + '\n' +
    '"abc123","403","9A Circular Road","Singapore","2026-02-09 00:00","Sunny","J","4","5","4","","Great place","s@x.com","s@x.com"';
  const reviews = parseReviewCSV(csv);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].platform, 'PMS');
  // 4/5 → 8/10, 5/5 → 10/10
  assert.equal(reviews[0].reviewScore, 8);
  assert.equal(reviews[0].staff, 8);
  assert.equal(reviews[0].cleanliness, 10);
  assert.equal(reviews[0].roomName, '403');
});

test('parseReviewCSV: PMS missing scores stay as 0 after normalisation', () => {
  const csv = PMS_HEADER + '\n' +
    '"abc123","403","9A Circular Road","Singapore","2026-02-09 00:00","Sunny","J","-","-","-","","","s@x.com","s@x.com"';
  const reviews = parseReviewCSV(csv);
  assert.equal(reviews[0].reviewScore, 0);
  assert.equal(reviews[0].staff, 0);
});

// ----------------------------------------------------------------------
// Cross-platform behaviour
// ----------------------------------------------------------------------

test('parseReviewCSV: empty CSV body returns empty array (no crash)', () => {
  assert.deepEqual(parseReviewCSV(BOOKING_HEADER + '\n'), []);
  assert.deepEqual(parseReviewCSV(AGODA_HEADER + '\n'), []);
  assert.deepEqual(parseReviewCSV(PMS_HEADER + '\n'), []);
});

test('parseReviewCSV: unknown CSV format falls back to Booking parser', () => {
  // Should not throw — produces zero or near-zero useful rows
  const csv = 'foo,bar,baz\n1,2,3';
  const reviews = parseReviewCSV(csv);
  assert.ok(Array.isArray(reviews));
  // platform should default to Booking for legacy compatibility
  if (reviews.length > 0) assert.equal(reviews[0].platform, 'Booking');
});

// ----------------------------------------------------------------------
// guestName extraction across platforms
// ----------------------------------------------------------------------

test('parseReviewCSV: Booking guestName from "Guest name" column', () => {
  const csv = BOOKING_HEADER + '\n' +
    '"2026-01-01","Alice Johnson","R1","Great","loved it","none","9","9","9","10","9","9","9",""';
  const reviews = parseReviewCSV(csv);
  assert.equal(reviews[0].guestName, 'Alice Johnson');
});

test('parseReviewCSV: Agoda guestName extracted', () => {
  const csv = AGODA_HEADER + '\n' +
    '"January 10, 2026","Priskila","BID: 1968414207","Radzone Review","Clean hostel","10","10","10","10","10","10",""';
  const reviews = parseReviewCSV(csv);
  assert.equal(reviews[0].guestName, 'Priskila');
});

test('parseReviewCSV: PMS combines First Name + Last Name', () => {
  const csv = PMS_HEADER + '\n' +
    '"abc","403","9A Circular Road","Singapore","2026-02-09 00:00","Sunny","Jaiswal","4","5","4","","Great","s@x.com","s@x.com"';
  const reviews = parseReviewCSV(csv);
  assert.equal(reviews[0].guestName, 'Sunny Jaiswal');
});

// ----------------------------------------------------------------------
// Property auto-tagging: majority vote across the file
// ----------------------------------------------------------------------

test('parseReviewCSV: tags every row with majority property', () => {
  const csv = BOOKING_HEADER + '\n' +
    '"2026-01-01","A","R1","",  "Loved Hipstercity","",  "9","9","9","9","9","9","9",""' + '\n' +
    '"2026-01-02","B","R2","",  "Great location",     "",  "8","8","8","8","8","8","8",""' + '\n' +
    '"2026-01-03","C","R3","",  "Hipstercity rocks",  "",  "9","9","9","9","9","9","9",""';
  const reviews = parseReviewCSV(csv);
  // 2 of 3 reviews mention Hipstercity -- should win and tag all 3
  assert.equal(reviews.length, 3);
  assert.equal(reviews[0].property, 'Hipstercity');
  assert.equal(reviews[1].property, 'Hipstercity');
  assert.equal(reviews[2].property, 'Hipstercity');
});

test('parseReviewCSV: leaves property unset when no property names appear', () => {
  const csv = BOOKING_HEADER + '\n' +
    '"2026-01-01","A","R1","",  "good","",  "9","9","9","9","9","9","9",""';
  const reviews = parseReviewCSV(csv);
  assert.equal(reviews[0].property, undefined);
});
