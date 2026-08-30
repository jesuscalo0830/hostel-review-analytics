import { parse, isValid, format } from 'date-fns';

/**
 * Robustly parse any date string or Date object into a valid Date instance.
 * Handles ISO strings, slash formats, hyphen formats, and written dates (e.g. "Apr 10, 2026").
 */
export const parseRobustDate = (dateStr: any): Date | null => {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return isValid(dateStr) ? dateStr : null;

  const s = String(dateStr).trim();
  if (!s || s === '-' || s === '—' || s.toLowerCase() === 'undefined' || s.toLowerCase() === 'null') return null;

  // 1. ISO strings (e.g. "2026-04-10T00:00:00.000Z" or "2026-04-10 00:00:00")
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const cleanISO = s.split('T')[0].split(' ')[0];
    const parts = cleanISO.split('-').map(Number);
    if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      if (isValid(d)) return d;
    }
  }

  // 2. Native Date.parse for written dates (e.g. "Jan 27, 2026", "27 Jan 2026", "2026/04/10")
  const nativeTimestamp = Date.parse(s);
  if (!isNaN(nativeTimestamp)) {
    const d = new Date(nativeTimestamp);
    if (isValid(d)) return d;
  }

  // 3. Fallback date-fns template formats
  const cleanFirst = s.split('T')[0].split(' ')[0];
  const formats = [
    'yyyy-MM-dd', 'M/d/yyyy', 'd/M/yyyy', 'MM/dd/yyyy', 'dd/MM/yyyy',
    'yyyy/MM/dd', 'MMM d, yyyy', 'd MMM yyyy', 'MMM d yyyy', 'yyyy-MM', 'MMM yyyy'
  ];

  for (const fmt of formats) {
    try {
      const parsed = parse(cleanFirst, fmt, new Date());
      if (isValid(parsed)) return parsed;
    } catch (e) {}
  }

  return null;
};

/**
 * Convert any date input into a clean, short written format (e.g. "Apr 10, 2026").
 * Falls back gracefully to original string if unparseable.
 */
export const formatDisplayDate = (dateInput: string | Date | null | undefined): string => {
  if (!dateInput) return '';
  if (dateInput instanceof Date) {
    return isValid(dateInput) ? format(dateInput, 'MMM dd, yyyy') : '';
  }

  const str = String(dateInput).trim();
  if (!str || str === '-' || str === '—') return str;

  const parsed = parseRobustDate(str);
  if (parsed && isValid(parsed)) {
    return format(parsed, 'MMM dd, yyyy');
  }

  return str;
};
