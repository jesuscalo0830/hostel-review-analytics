import { BookingReview } from '../types';

export const extractKeywords = (reviews: BookingReview[], type: 'positive' | 'negative') => {
  const text = reviews
    .map(r => {
      const original = type === 'positive' ? r.positiveReview : r.negativeReview;
      const translated = type === 'positive' ? r.translatedPositive : r.translatedNegative;
      return translated || original || '';
    })
    .join(' ')
    .toLowerCase();

  // Simple stop words
  const stopWords = new Set([
    'the', 'and', 'was', 'very', 'good', 'great', 'nice', 'really', 'liked', 'fact', 'that', 'there', 'had', 'time', 'only', 'thing', 'thought', 'booked', 'actually', 'didn\'t', 'specified', 'anywhere', 'however', 'felt', 'everyone', 'civilized', 'simple', 'juste', 'pour', 'dormir', 'petit', 'budget', 'étudiant', 'trop', 'règle', 'lage', 'hostels', 'ist', 'super', 'man', 'kann', 'alles', 'mit', 'der', 'mrt', 'erreichen', 'und', 'zentral', 'personal', 'war', 'freundlich', 'hilfsbereit', 'gab', 'frühstück', 'was', 'völlig', 'ausreichend', 'man', 'gut', 'den', 'tag', 'starten', 'konnte', 'wir', 'konnten', 'ohne', 'probleme', 'unser', 'gepäck', 'vor', 'dem', 'check-in', 'nach', 'check-out', 'aufbewahren', 'lassen', 'waren', 'übers', 'wochenende', 'singapur', 'wie', 'zu', 'erwarten', 'es', 'ziemlich', 'laut', 'auch', 'im', 'hostel', 'gehört', 'hat', 'aber', 'auch', 'vorhinein', 'schon', 'denken', 'perfekte', 'lage', 'чистый', 'хостел', 'за', 'адекватную', 'стоимость', 'в', 'чайнатауне', 'самый', 'центр', 'сингапура', 'номерах', 'всё', 'изолировано', 'сами', 'комнатки', 'сделаны', 'под', 'гарри', 'поттера', 'будто', 'бы', 'вы', 'живёте', 'чулане', 'лестницей', 'рукой', 'подать', 'до', 'must', 'see', 'мест', 'городе', 'пешей', 'доступности', 'несколько', 'веток', 'метро', 'том', 'числе', 'ветка', 'идущая', 'из/в', 'аэропорт', 'по', 'утрам', 'есть', 'бесплатный', 'завтрак', 'виде', 'хлопьев', 'тостов', 'с', 'джемом', 'и', 'кофе', 'не', 'повезло', 'правда', 'жить', 'темновато', 'ottima', 'posizione', 'sui', 'boat', 'quay', 'di', 'singapore', 'per', 'raggiungere', 'piedi', 'sia', 'marina', 'bay', 'che', 'chinatown', 'staff', 'gentile', 'colazione', 'servizi', 'leuke', 'opzet', 'hoekje', 'dorm', 'ontzettend', 'veel', 'lawaai', 'van', 'het', 'uitgaansleven', 'muziek', 'bonkt', 'door', 'kamer', 'très', 'bon', 'accueil', 'espace', 'nuit', 'propre', 'bien', 'agencé', 'situé', 'd\'un', 'rapport', 'qualité', 'prix', 'petit', 'déjeuner', 'unpeu', 'léger', 'l\'accoglienza', 'disponibilità', 'niente', 'noisy', 'sleep', 'bathroom', 'open', 'will', 'never', 'back', 'central', 'noise', 'during', 'time', 'completely', 'opened', 'with', 'curtains', 'privacy', 'shower', 'hard', 'get', 'out', 'specially', 'mixed', 'room', 'αργά', 'τσεκ', 'ιν', 'μας', 'δώσανε', 'όλες', 'τις', 'πληροφορίες', 'από', 'πριν', 'και', 'όλα', 'πήγαν', 'τέλεια', 'καθαρά', 'κρεβάτια', 'σεντόνια', 'άνετος', 'χώρος', 'μια', 'τουαλέτα', 'για', 'άντρες', 'γυναίκες', 'μύριζε', 'όλο', 'κτήριο', 'μικρή', 'μυρωδιά', 'μούχλας', 'υγρασίας', 'a', 'an', 'is', 'it', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'as', 'this', 'that', 'it\'s', 'its', 'they', 'them', 'their', 'we', 'us', 'our', 'you', 'your', 'i', 'me', 'my', 'he', 'him', 'his', 'she', 'her', 'hers'
  ]);

  // Use a more inclusive regex for words to support non-Latin characters
  const words = text.match(/\p{L}+/gu) || [];
  const freq: Record<string, number> = {};

  words.forEach(w => {
    if (w.length > 2 && !stopWords.has(w)) {
      freq[w] = (freq[w] || 0) + 1;
    }
  });

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word, count]) => ({ word, count }));
};
