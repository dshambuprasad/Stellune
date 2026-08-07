/**
 * Phase 4 — the words on the screen, including the ones that must be exact.
 *
 * THE HONESTY LABEL is not decoration and not marketing. It is the product's
 * standing promise (PRODUCT_WALKTHROUGH; MUSICAL_VISION §7): the structure is
 * true, the clothing is chosen, and the difference is stated where anyone can
 * read it. Every claim it makes is generated from the session's own numbers, so
 * it cannot drift away from what is actually playing.
 */

/**
 * The time-compression line, with this session's real number.
 *
 * κ is sky-seconds per listening-second, solved per session so the night's true
 * climax lands where the composed arc wants it — which means it genuinely
 * differs between two people on the same evening, and quoting a fixed figure
 * would be a lie. Phrased in whole hours where that reads better than minutes.
 */
export function timeCompressionLine(kappa: number): string {
  if (!Number.isFinite(kappa) || kappa <= 0) return '';
  const skyMinutesPerMinute = kappa;
  if (skyMinutesPerMinute >= 90) {
    const hours = skyMinutesPerMinute / 60;
    const rounded = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10;
    return `One minute of listening is about ${rounded} hours of real sky.`;
  }
  return `One minute of listening is about ${Math.round(skyMinutesPerMinute)} minutes of real sky.`;
}

/** "Bengaluru · tonight · 1,204 stars up" — the label under the sky. */
export function sessionLabel(
  placeLabel: string,
  when: string,
  visibleCount: number,
): string {
  return `${placeLabel} · ${when} · ${visibleCount.toLocaleString()} stars up`;
}

/** A date the way a person writes it, from an ISO day. */
export function humanDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  if (!y || !m || !d) return dateISO;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Minutes since local midnight → "21:40". */
export function humanTime(timeMinutes: number | undefined): string | null {
  if (timeMinutes == null || !Number.isFinite(timeMinutes)) return null;
  const total = ((Math.round(timeMinutes) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Seconds → "4:07". Used for the session's own progress. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const mm = Math.floor(total / 60);
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** Today, in the observer's own zone rather than the machine's. */
export function todayISO(tzOffsetMinutes: number, now = new Date()): string {
  const local = new Date(now.getTime() + tzOffsetMinutes * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * The fixed honesty text — the part that does not depend on the session.
 *
 * Kept as one string in one place so it can be reviewed as a whole, and so
 * there is never a version of this app where it has quietly been trimmed to fit
 * a layout.
 */
export const HONESTY_TEXT =
  'The structure is true: these are the real stars above this place at this ' +
  'moment, and a star sounds when it really rises, culminates or sets. The ' +
  'instruments, the musical scale and the tempo are artistic choices. This is ' +
  'never a claim about what space literally sounds like.';

/** The time-zone caveat, shown wherever a city supplies the clock. */
export const TIMEZONE_CAVEAT =
  'Each city uses one fixed UTC offset — this version has no daylight-saving history.';
