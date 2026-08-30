import test from 'node:test';
import assert from 'node:assert/strict';
import { isNonEnglishText, needsEnglishTranslation } from '../utils/validation';
import { offlineTranslate } from '../services/gemini';
import type { BookingReview } from '../types';

test('isNonEnglishText: correctly identifies English text as false', () => {
  assert.equal(isNonEnglishText('Great hostel near the city center'), false);
  assert.equal(isNonEnglishText('The room was clean and quiet.'), false);
  assert.equal(isNonEnglishText('The wifi was a bit slow in the evenings.'), false);
  assert.equal(isNonEnglishText('-'), false);
  assert.equal(isNonEnglishText(undefined), false);
});

test('isNonEnglishText: detects non-Latin scripts', () => {
  assert.equal(isNonEnglishText('立地がとても良く、スタッフも親切でした。'), true); // Japanese
  assert.equal(isNonEnglishText('位置非常好，员工非常热情。'), true); // Chinese
  assert.equal(isNonEnglishText('위치가 좋고 방이 깨끗했습니다.'), true); // Korean
  assert.equal(isNonEnglishText('Отличное расположение и чистые номера.'), true); // Russian
  assert.equal(isNonEnglishText('موقع ممتاز وطاقم عمل ودود.'), true); // Arabic
});

test('isNonEnglishText: detects Latin-script non-English languages', () => {
  // German
  assert.equal(isNonEnglishText('Sehr gut und sauber. Das Zimmer war sehr laut.'), true);
  assert.equal(isNonEnglishText('Prima Lage, sehr sauber, netter Aufenthaltsraum, nette andere Reisende, komfortable Betten'), true); // Kathryn

  // Spanish & Catalan
  assert.equal(isNonEnglishText('Muy bueno y limpio. La ubicación es excelente.'), true);
  assert.equal(isNonEnglishText('Habitación cómoda y personal muy amable.'), true);
  assert.equal(isNonEnglishText('Tot'), true); // Carbó Picas

  // French
  assert.equal(isNonEnglishText('Très bon emplacement, chambre propre.'), true);
  assert.equal(isNonEnglishText('Les toilettes, horriblement sale personne nettoie apres etre aller, le bruit jusqu\'a 3h du matin voir plus horrible egalement, les lumieres sans cesse allumer dans les couloirs par les autres, les odeurs d\'egouts.'), true); // Lou
  assert.equal(isNonEnglishText('Pas grand chose.'), true);

  // Italian
  assert.equal(isNonEnglishText('Ottima posizione e stanza molto pulita.'), true);

  // Portuguese
  assert.equal(isNonEnglishText('Muito bom hostel, perto de tudo. Quarto limpo.'), true);

  // Dutch
  assert.equal(isNonEnglishText('Zeer goed en schoon. Vriendelijk personeel.'), true);
});

test('needsEnglishTranslation: identifies reviews requiring conversion', () => {
  const untranslatedGerman: BookingReview = {
    reviewDate: '2026-02-20',
    reservationNumber: 'REF-001',
    reviewTitle: 'Sehr gut',
    roomName: 'Dorm',
    positiveReview: 'Sehr gut und sauber.',
    negativeReview: 'Das Zimmer war sehr laut.',
    reviewScore: 8,
    staff: 8,
    cleanliness: 9,
    location: 9,
    facilities: 7,
    comfort: 7,
    valueForMoney: 8,
    propertyReply: '',
  };

  assert.equal(needsEnglishTranslation(untranslatedGerman), true);

  const translatedGerman: BookingReview = {
    ...untranslatedGerman,
    translatedTitle: 'Very good',
    translatedPositive: 'Very good and clean.',
    translatedNegative: 'The room was very loud.',
  };

  assert.equal(needsEnglishTranslation(translatedGerman), false);

  const englishReview: BookingReview = {
    reviewDate: '2026-02-20',
    reservationNumber: 'REF-002',
    reviewTitle: 'Great stay',
    roomName: 'Dorm',
    positiveReview: 'The staff were amazing and the room was very clean.',
    negativeReview: 'A bit noisy from the main road.',
    reviewScore: 9,
    staff: 10,
    cleanliness: 9,
    location: 9,
    facilities: 8,
    comfort: 8,
    valueForMoney: 9,
    propertyReply: '',
  };

  assert.equal(needsEnglishTranslation(englishReview), false);
});

test('offlineTranslate: translates common phrases when API is offline', () => {
  assert.equal(
    offlineTranslate('Prima Lage, sehr sauber, netter Aufenthaltsraum, nette andere Reisende, komfortable Betten'),
    'Great location, very clean, nice common room, nice other travelers, comfortable beds'
  );
  assert.equal(offlineTranslate('Tot'), 'All / Everything');
  assert.equal(offlineTranslate('Pas grand chose'), 'Not much');
});
