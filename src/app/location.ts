/**
 * Phase 4 — where you are, resolved gently.
 *
 * "no login, no setup → it knows tonight + here (geolocation optional, city
 * fallback)" (PRODUCT_WALKTHROUGH). Optional is the operative word: the browser
 * prompt is asked for once, and a refusal is not an error state. It just means
 * the city picker is how we find out instead — same screen, no apology, no
 * second attempt to wear the person down.
 */

import type { City } from '../engine/index.ts';

/** How long to wait for a fix before falling back. */
const GEOLOCATION_TIMEOUT_MS = 8000;

export type LocationSource = 'geolocation' | 'city';

export interface ResolvedPlace {
  source: LocationSource;
  latitude: number;
  longitude: number;
  tzOffsetMinutes: number;
  /** What the honesty label calls this place. */
  label: string;
  /** The city we matched, when there is one. */
  city: City | null;
}

/**
 * Ask the browser where we are.
 *
 * Resolves to null on refusal, timeout, or an insecure origin — every one of
 * which is a normal thing that happens, not a fault. The caller shows the city
 * picker either way.
 */
export function requestGeolocation(): Promise<GeolocationPosition | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: GeolocationPosition | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    // Belt and braces: some browsers never call either callback when the prompt
    // is dismissed rather than answered.
    const timer = setTimeout(() => finish(null), GEOLOCATION_TIMEOUT_MS + 500);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer);
        finish(position);
      },
      () => {
        clearTimeout(timer);
        finish(null);
      },
      { enableHighAccuracy: false, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 600_000 },
    );
  });
}

const EARTH_RADIUS_KM = 6371;
const DEG = Math.PI / 180;

/** Great-circle distance in kilometres. */
export function haversineKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const dLat = (bLat - aLat) * DEG;
  const dLon = (bLon - aLon) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The bundled city nearest a fix — used only to name the place and get its zone. */
export function nearestCity(cities: City[], latitude: number, longitude: number): City | null {
  let best: City | null = null;
  let bestKm = Infinity;
  for (const city of cities) {
    const km = haversineKm(latitude, longitude, city.lat, city.lon);
    if (km < bestKm) {
      bestKm = km;
      best = city;
    }
  }
  return best;
}

/**
 * Turn a geolocation fix into a place.
 *
 * The coordinates used for the sky are the REAL ones from the device — the
 * nearest city only supplies a name and a time zone. Snapping the observer to
 * a city centre would put a false position into a piece whose whole claim is
 * that the structure is true.
 */
export function placeFromPosition(
  position: GeolocationPosition,
  cities: City[],
): ResolvedPlace {
  const { latitude, longitude } = position.coords;
  const city = nearestCity(cities, latitude, longitude);
  return {
    source: 'geolocation',
    latitude,
    longitude,
    // Fall back to the browser's own offset if no city was close.
    tzOffsetMinutes: city?.tzOffsetMinutes ?? -new Date().getTimezoneOffset(),
    label: city ? `near ${city.name}` : 'your location',
    city,
  };
}

export function placeFromCity(city: City): ResolvedPlace {
  return {
    source: 'city',
    latitude: city.lat,
    longitude: city.lon,
    tzOffsetMinutes: city.tzOffsetMinutes,
    label: city.name,
    city,
  };
}

/**
 * Search the bundled cities.
 *
 * Prefix matches first (typing "lon" should surface London before Colombo),
 * then substring, then country. Population order is already baked into the
 * bundle's ordering, so ties break toward the bigger place — which is what
 * someone typing three letters almost always meant.
 */
export function searchCities(cities: City[], query: string, limit = 8): City[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];

  const prefix: City[] = [];
  const contains: City[] = [];
  const country: City[] = [];

  for (const city of cities) {
    const name = city.name.toLowerCase();
    if (name.startsWith(q)) prefix.push(city);
    else if (name.includes(q)) contains.push(city);
    else if (city.country.toLowerCase().startsWith(q)) country.push(city);
    if (prefix.length >= limit) break;
  }

  return [...prefix, ...contains, ...country].slice(0, limit);
}
