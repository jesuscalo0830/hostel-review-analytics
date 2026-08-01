import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVerifiedStay } from '../utils/validation';

test('isVerifiedStay: a booking reference means a verified stay', () => {
  assert.equal(isVerifiedStay({ reservationNumber: '2034499735' }), true);
  assert.equal(isVerifiedStay({ reservationNumber: 'BID-4471A' }), true);
});

test('isVerifiedStay: no reference means unverified', () => {
  // Google and other open platforms supply no booking reference.
  assert.equal(isVerifiedStay({}), false);
  assert.equal(isVerifiedStay({ reservationNumber: '' }), false);
  assert.equal(isVerifiedStay({ reservationNumber: '   ' }), false);
});

test('isVerifiedStay: placeholder values are not references', () => {
  for (const v of ['-', '--', '---', 'n/a', 'N/A', 'na', 'none', 'null', 'undefined', '0']) {
    assert.equal(isVerifiedStay({ reservationNumber: v }), false, `expected "${v}" to be unverified`);
  }
});
