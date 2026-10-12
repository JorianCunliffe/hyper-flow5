import { validateHours, type BusinessHours } from './cockpit/businessHours.js';

export interface ProjectOperatingHours {
  timezone: string;
  windows: BusinessHours[];
  closures?: string[];
}

export function normalizeProjectHours(raw: unknown): ProjectOperatingHours {
  const value = raw as ProjectOperatingHours;
  if (!value || typeof value.timezone !== 'string' || !value.timezone.trim()) throw Error('Project hours require an IANA timezone.');
  new Intl.DateTimeFormat('en', { timeZone: value.timezone }).format();
  if (!Array.isArray(value.windows) || value.windows.length > 28) throw Error('Project hours require up to 28 weekly windows. An empty list means closed.');
  const closures = validateHours({ days: [0], start: '00:00', end: '24:00', closures: value.closures || [] }).closures;
  return { timezone: value.timezone, windows: value.windows.map(validateHours), closures };
}

/** Pure, provider-free business decision. It grants no authority and dispatches nothing. */
export function checkProjectHours(raw: unknown, now = Date.now()) {
  if (!Number.isSafeInteger(now)) throw Error('A valid check time is required.');
  const checkedAt = new Date(now).toISOString();
  if (raw == null) return { hours_status: 'open', hours_open: true, hours_checked_at: checkedAt, hours_next_open_at: null };
  const hours = normalizeProjectHours(raw);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: hours.timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const openAt = (at: number) => {
    const parts = formatter.formatToParts(at);
    const part = (key: string) => parts.find(p => p.type === key)?.value || '';
    const date = `${part('year')}-${part('month')}-${part('day')}`, time = `${part('hour')}:${part('minute')}`;
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday'));
    if (hours.closures?.includes(date)) return false;
    const priorDate = new Date(Date.parse(date + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
    return hours.windows.some(w => !w.closures?.includes(date) && (w.start < w.end
      ? w.days.includes(day) && time >= w.start && time < w.end
      : (w.days.includes(day) && time >= w.start) || (w.days.includes((day + 6) % 7) && time < w.end && !w.closures?.includes(priorDate) && !hours.closures?.includes(priorDate))));
  };
  const open = openAt(now);
  let next: number | undefined;
  // Real instants handle DST gaps and repeats. Bound the lookup; no opening is a
  // visible result for the workflow's review branch, never an indefinite wait.
  if (!open && hours.windows.length) for (let at = Math.floor(now / 60000) * 60000 + 60000; at <= now + 8 * 86400000; at += 60000) {
    if (openAt(at)) { next = at; break; }
  }
  return { hours_status: open ? 'open' : 'closed', hours_open: open, hours_checked_at: checkedAt,
    hours_timezone: hours.timezone, hours_local_time: new Date(now).toLocaleString('en-AU', { timeZone: hours.timezone }),
    hours_next_open_at: next ? new Date(next).toISOString() : null };
}
