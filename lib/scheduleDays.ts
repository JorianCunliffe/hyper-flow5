/** JavaScript weekday numbering in the schedule's timezone: Sunday=0. */
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const normalizeScheduleDays = (input: unknown): number[] | undefined => {
  if (input === undefined) return undefined; // Existing daily schedules keep all seven days.
  if (!Array.isArray(input) || input.length === 0 || input.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error('Select at least one valid schedule weekday');
  }
  return [...new Set(input as number[])].sort((a, b) => a - b);
};
export const scheduleDaysLabel = (days?: number[]): string => {
  if (!days || days.length === 7) return 'Every day';
  return days.map(day => WEEKDAYS[day]?.slice(0, 3)).join(', ');
};
