import { parse, isValid } from 'date-fns';

export const parseRobustDate = (dateStr: string): Date | null => {
  if (!dateStr) return null;
  
  const cleanDateStr = dateStr.split(' ')[0];
  const formats = ['yyyy-MM-dd', 'M/d/yyyy', 'd/M/yyyy', 'MM/dd/yyyy', 'dd/MM/yyyy', 'yyyy/MM/dd'];
  
  for (const fmt of formats) {
    try {
      const parsed = parse(cleanDateStr, fmt, new Date());
      if (isValid(parsed)) return parsed;
    } catch (e) {}
  }

  const nativeDate = new Date(cleanDateStr);
  if (isValid(nativeDate)) return nativeDate;

  return null;
};
