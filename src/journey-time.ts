/** Time inputs use the supported Swiss market's zone, independent of browser settings. */
export const SEARCH_TIMEZONE = 'Europe/Zurich';

export function journeyDateInput(value: string | number | Date, timezone = SEARCH_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

export function parseJourneyDateInput(value: string, timezone = SEARCH_TIMEZONE): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const wallTime = Date.parse(value + ':00Z');
  if (!Number.isFinite(wallTime) || new Date(wallTime).toISOString().slice(0, 16) !== value) return null;
  // Probe both sides of a clock change; reject skipped or repeated local times.
  const offsets = new Set([-86_400_000, 0, 86_400_000].map(delta => {
    const instant = wallTime + delta;
    return Date.parse(journeyDateInput(instant, timezone) + ':00Z') - instant;
  }));
  const matches = [...offsets].map(offset => new Date(wallTime - offset))
    .filter(candidate => journeyDateInput(candidate, timezone) === value);
  return matches.length === 1 ? matches[0]! : null;
}
