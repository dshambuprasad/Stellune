/**
 * Phase 2 — the astronomy must be right before any sound can be trusted.
 *
 * These tests check the reduction against facts that are true independently of
 * this code: published Julian Dates, the definition of sidereal time, and the
 * geometry of the celestial sphere. A test that merely re-states the
 * implementation would prove nothing.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseStarCatalog, type ObserverInput, type Star } from '../src/engine/model/index.ts';
import {
  greenwichMeanSiderealTime,
  julianDate,
  localSiderealTime,
  normalizeDegrees,
  normalizeHourAngle,
  starsAboveHorizon,
  toHorizon,
} from '../src/engine/mapping/index.ts';

const catalog: Star[] = parseStarCatalog(
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../public/data/stars.hyg.subset.json', import.meta.url)), 'utf8'),
  ),
);

const star = (name: string): Star => {
  const found = catalog.find((s) => s.name === name);
  if (!found) throw new Error(`${name} missing from catalogue`);
  return found;
};

/** A observer with everything spelled out, so tests read as sentences. */
const observer = (over: Partial<ObserverInput> = {}): ObserverInput => ({
  latitude: 51.5085,
  longitude: -0.1257,
  dateISO: '1993-08-01',
  timeMinutes: 0,
  tzOffsetMinutes: 0,
  ...over,
});

describe('julianDate', () => {
  it('matches the J2000.0 epoch exactly', () => {
    // 2000 January 1, 12:00 UT is JD 2451545.0 by definition.
    expect(
      julianDate({ latitude: 0, longitude: 0, dateISO: '2000-01-01', timeMinutes: 720, tzOffsetMinutes: 0 }),
    ).toBe(2451545.0);
  });

  it('matches published Julian Dates', () => {
    const jd = (dateISO: string, timeMinutes = 0): number =>
      julianDate({ latitude: 0, longitude: 0, dateISO, timeMinutes, tzOffsetMinutes: 0 });

    // Meeus ch. 7 worked examples.
    expect(jd('1957-10-04', 19 * 60 + 26.24)).toBeCloseTo(2436116.31, 2); // Sputnik 1
    expect(jd('1987-01-27')).toBe(2446822.5);
    expect(jd('1988-06-19', 12 * 60)).toBe(2447332.0);
    expect(jd('1900-01-01')).toBe(2415020.5);
  });

  it('advances by exactly one per day', () => {
    const a = julianDate(observer({ dateISO: '1993-08-01' }));
    const b = julianDate(observer({ dateISO: '1993-08-02' }));
    expect(b - a).toBe(1);
  });

  it('advances across a month and a year boundary', () => {
    const endOfMonth = julianDate(observer({ dateISO: '1993-08-31' }));
    const nextMonth = julianDate(observer({ dateISO: '1993-09-01' }));
    expect(nextMonth - endOfMonth).toBe(1);

    const newYearEve = julianDate(observer({ dateISO: '1993-12-31' }));
    const newYear = julianDate(observer({ dateISO: '1994-01-01' }));
    expect(newYear - newYearEve).toBe(1);
  });

  it('handles leap days', () => {
    // 2000 was a leap year (divisible by 400); 1900 was not (divisible by 100).
    expect(julianDate(observer({ dateISO: '2000-03-01' })) - julianDate(observer({ dateISO: '2000-02-28' }))).toBe(2);
    expect(julianDate(observer({ dateISO: '1900-03-01' })) - julianDate(observer({ dateISO: '1900-02-28' }))).toBe(1);
  });

  // A Julian Date near 2.45 million uses up the mantissa: a double resolves it
  // to about 5e-10 days (~40 microseconds). Tolerances below use 8 decimals,
  // which is still ~1 millisecond — far finer than anything the sky notices.
  it('subtracts the timezone offset to reach UTC', () => {
    // 00:00 in Bengaluru (UTC+5:30) is 18:30 UTC on the PREVIOUS day.
    const local = julianDate(observer({ dateISO: '1993-08-01', timeMinutes: 0, tzOffsetMinutes: 330 }));
    const utc = julianDate(observer({ dateISO: '1993-08-01', timeMinutes: 0, tzOffsetMinutes: 0 }));
    expect(utc - local).toBeCloseTo(330 / 1440, 8);
  });

  it('rolls backwards over midnight without special-casing the calendar', () => {
    // Local midnight at UTC+5:30 on the 1st === 18:30 UTC on July 31st.
    const viaOffset = julianDate(observer({ dateISO: '1993-08-01', timeMinutes: 0, tzOffsetMinutes: 330 }));
    const viaPreviousDay = julianDate(
      observer({ dateISO: '1993-07-31', timeMinutes: 18 * 60 + 30, tzOffsetMinutes: 0 }),
    );
    expect(viaOffset).toBeCloseTo(viaPreviousDay, 8);
  });

  it('defaults an absent time to local midnight', () => {
    const withoutTime = julianDate({
      latitude: 0,
      longitude: 0,
      dateISO: '1993-08-01',
      tzOffsetMinutes: 0,
    });
    expect(withoutTime).toBe(julianDate(observer({ dateISO: '1993-08-01', timeMinutes: 0 })));
  });

  it('rejects a malformed date rather than guessing at it', () => {
    expect(() => julianDate(observer({ dateISO: '01/08/1993' }))).toThrow(/must look like/);
    expect(() => julianDate(observer({ dateISO: '1993-8-1' }))).toThrow(/must look like/);
    expect(() => julianDate(observer({ dateISO: '1993-13-01' }))).toThrow(/not between 01 and 12/);
    expect(() => julianDate(observer({ dateISO: '1993-08-45' }))).toThrow(/not between 01 and 31/);
  });
});

describe('greenwichMeanSiderealTime', () => {
  it('matches the defined value at J2000.0', () => {
    // GMST at 2000-01-01 12:00 UT is 18h 41m 50.5s = 280.46 degrees.
    expect(greenwichMeanSiderealTime(2451545.0)).toBeCloseTo(280.46061837, 6);
  });

  it('advances by roughly 360.9856 degrees per solar day', () => {
    // A sidereal day is ~4 minutes shorter than a solar day, so the sky gains
    // just under one extra degree of rotation each day.
    const step = normalizeDegrees(
      greenwichMeanSiderealTime(2451546.0) - greenwichMeanSiderealTime(2451545.0),
    );
    expect(step).toBeCloseTo(0.98564736629, 6);
  });

  it('always returns a value in 0..360', () => {
    for (let jd = 2400000; jd < 2460000; jd += 733.7) {
      const gmst = greenwichMeanSiderealTime(jd);
      expect(gmst).toBeGreaterThanOrEqual(0);
      expect(gmst).toBeLessThan(360);
    }
  });

  it('rejects a non-finite julian date', () => {
    expect(() => greenwichMeanSiderealTime(Number.NaN)).toThrow(/finite/);
  });
});

describe('localSiderealTime', () => {
  it('adds eastern longitude and subtracts western', () => {
    const base = localSiderealTime(observer({ longitude: 0 }));
    expect(localSiderealTime(observer({ longitude: 30 }))).toBeCloseTo(normalizeDegrees(base + 30), 9);
    expect(localSiderealTime(observer({ longitude: -30 }))).toBeCloseTo(normalizeDegrees(base - 30), 9);
  });
});

describe('angle normalisation', () => {
  it('wraps degrees into 0..360', () => {
    expect(normalizeDegrees(370)).toBeCloseTo(10, 10);
    expect(normalizeDegrees(-10)).toBeCloseTo(350, 10);
    expect(normalizeDegrees(0)).toBe(0);
    expect(normalizeDegrees(720)).toBeCloseTo(0, 10);
  });

  it('wraps hour angles into -180..180', () => {
    expect(normalizeHourAngle(190)).toBeCloseTo(-170, 10);
    expect(normalizeHourAngle(-190)).toBeCloseTo(170, 10);
    expect(normalizeHourAngle(0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The four correctness tests the build plan names as the gate.
// ---------------------------------------------------------------------------

describe('THE GATE — Polaris altitude equals observer latitude', () => {
  const polaris = star('Polaris');

  // Polaris sits 0.74 degrees from the celestial pole, so its altitude circles
  // the true latitude by up to that much over a day. Well inside +/-1 degree.
  const latitudes = [0.5, 12.97, 28.61, 40.71, 51.51, 64.13, 78.2];
  const longitudes = [-157.86, -74.01, -0.13, 13.4, 77.59, 139.69, 174.76];
  const times = [0, 137, 360, 611, 900, 1237, 1439];
  const dates = ['1957-10-04', '1970-01-01', '1993-08-01', '2001-02-28', '2024-12-25'];

  it.each(latitudes)('at latitude %s, for every longitude, time and date', (latitude) => {
    for (const longitude of longitudes) {
      for (const dateISO of dates) {
        for (const timeMinutes of times) {
          const { altitude } = toHorizon(
            polaris,
            latitude,
            localSiderealTime(observer({ latitude, longitude, dateISO, timeMinutes })),
          );
          expect(
            Math.abs(altitude - latitude),
            `Polaris at ${altitude.toFixed(3)} deg from latitude ${latitude} ` +
              `(lon ${longitude}, ${dateISO} +${timeMinutes}min)`,
          ).toBeLessThan(1);
        }
      }
    }
  });

  it('is below the horizon from the southern hemisphere', () => {
    const { altitude } = toHorizon(polaris, -33.87, localSiderealTime(observer({ latitude: -33.87 })));
    expect(altitude).toBeLessThan(0);
  });
});

describe('THE GATE — a star with dec = latitude transits the zenith', () => {
  const latitudes = [-64.13, -33.87, -12.97, 0, 12.97, 33.87, 51.51, 64.13];

  it.each(latitudes)('at latitude %s, altitude reaches 90 at H = 0', (latitude) => {
    const obs = observer({ latitude, longitude: 77.59, dateISO: '1993-08-01', timeMinutes: 483 });
    const lst = localSiderealTime(obs);

    // Place a synthetic star exactly on the meridian (hour angle zero) at the
    // observer's own declination: H = LST - RA = 0 when RA = LST.
    const overhead: Star = { id: 'synthetic', ra: lst, dec: latitude, mag: 2 };
    const { altitude } = toHorizon(overhead, latitude, lst);

    expect(altitude).toBeCloseTo(90, 6);
  });

  it('puts a star at dec = latitude - 30 due south of a northern observer', () => {
    const latitude = 51.5085;
    const obs = observer({ latitude });
    const lst = localSiderealTime(obs);

    const onMeridian: Star = { id: 'synthetic', ra: lst, dec: latitude - 30, mag: 2 };
    const { altitude, azimuth } = toHorizon(onMeridian, latitude, lst);

    expect(altitude).toBeCloseTo(60, 6); // 90 - 30
    expect(azimuth).toBeCloseTo(180, 6); // due south
  });

  it('puts a star at dec = latitude + 20 due north of a northern observer', () => {
    const latitude = 40;
    const obs = observer({ latitude });
    const lst = localSiderealTime(obs);

    const onMeridian: Star = { id: 'synthetic', ra: lst, dec: latitude + 20, mag: 2 };
    const { altitude, azimuth } = toHorizon(onMeridian, latitude, lst);

    expect(altitude).toBeCloseTo(70, 6); // 90 - 20
    expect(azimuth).toBeCloseTo(0, 6); // due north, over the pole
  });
});

describe('THE GATE — circumpolar geometry holds in both directions', () => {
  const latitude = 51.5085; // London

  it('never shows stars below dec = -(90 - latitude)', () => {
    const limit = -(90 - latitude); // -38.49 deg
    const tooFarSouth = catalog.filter((s) => s.dec < limit - 1);
    expect(tooFarSouth.length).toBeGreaterThan(500); // a real sample, not a token one

    // Step through a whole day in 20-minute increments — 72 different skies.
    for (let timeMinutes = 0; timeMinutes < 1440; timeMinutes += 20) {
      const lst = localSiderealTime(observer({ latitude, timeMinutes }));
      for (const s of tooFarSouth) {
        const { altitude } = toHorizon(s, latitude, lst);
        expect(
          altitude,
          `${s.name ?? s.id} (dec ${s.dec}) rose to ${altitude.toFixed(2)} deg at minute ${timeMinutes}`,
        ).toBeLessThanOrEqual(0);
      }
    }
  });

  it('never sets stars above dec = 90 - latitude (circumpolar)', () => {
    const limit = 90 - latitude; // 38.49 deg
    const circumpolar = catalog.filter((s) => s.dec > limit + 1);
    expect(circumpolar.length).toBeGreaterThan(500);

    for (let timeMinutes = 0; timeMinutes < 1440; timeMinutes += 20) {
      const lst = localSiderealTime(observer({ latitude, timeMinutes }));
      for (const s of circumpolar) {
        const { altitude } = toHorizon(s, latitude, lst);
        expect(
          altitude,
          `${s.name ?? s.id} (dec ${s.dec}) set to ${altitude.toFixed(2)} deg at minute ${timeMinutes}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('shows the whole sky over a day from the equator', () => {
    // At latitude 0 every star rises at some point in the sidereal day.
    const sample = catalog.filter((_, i) => i % 400 === 0);
    for (const s of sample) {
      let everSeen = false;
      for (let timeMinutes = 0; timeMinutes < 1440 && !everSeen; timeMinutes += 15) {
        const lst = localSiderealTime(observer({ latitude: 0, timeMinutes }));
        if (toHorizon(s, 0, lst).altitude > 0) everSeen = true;
      }
      expect(everSeen, `${s.name ?? s.id} (dec ${s.dec}) never rose at the equator`).toBe(true);
    }
  });
});

describe('azimuth quadrants', () => {
  const latitude = 51.5085;

  it('places a rising star in the east and a setting star in the west', () => {
    const obs = observer({ latitude });
    const lst = localSiderealTime(obs);

    // A star on the celestial equator six hours (90 deg) east of the meridian is
    // rising; six hours west, setting.
    const rising: Star = { id: 'rising', ra: normalizeDegrees(lst + 90), dec: 0, mag: 2 };
    const setting: Star = { id: 'setting', ra: normalizeDegrees(lst - 90), dec: 0, mag: 2 };

    expect(toHorizon(rising, latitude, lst).azimuth).toBeCloseTo(90, 4); // due east
    expect(toHorizon(setting, latitude, lst).azimuth).toBeCloseTo(270, 4); // due west
    expect(toHorizon(rising, latitude, lst).altitude).toBeCloseTo(0, 6);
  });

  it('always reports azimuth in 0..360', () => {
    const lst = localSiderealTime(observer({ latitude }));
    for (const s of catalog.filter((_, i) => i % 250 === 0)) {
      const { azimuth } = toHorizon(s, latitude, lst);
      expect(azimuth).toBeGreaterThanOrEqual(0);
      expect(azimuth).toBeLessThan(360);
    }
  });
});

describe('starsAboveHorizon', () => {
  it('returns a plausible fraction of the sky', () => {
    const visible = starsAboveHorizon(catalog, observer());
    // Roughly half the celestial sphere is up at any moment; latitude skews it.
    expect(visible.length).toBeGreaterThan(catalog.length * 0.2);
    expect(visible.length).toBeLessThan(catalog.length * 0.8);
  });

  it('returns only stars that are genuinely up', () => {
    for (const entry of starsAboveHorizon(catalog, observer())) {
      expect(entry.altitude).toBeGreaterThan(0);
    }
  });

  it('preserves catalogue order, so the result is stable', () => {
    const visible = starsAboveHorizon(catalog, observer());
    const positions = visible.map((entry) => catalog.findIndex((s) => s.id === entry.star.id));
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });

  it('is deterministic — identical input, identical output', () => {
    const obs = observer({ latitude: 12.9719, longitude: 77.5937, tzOffsetMinutes: 330 });
    expect(starsAboveHorizon(catalog, obs)).toEqual(starsAboveHorizon(catalog, obs));
  });

  it('changes the sky when the moment changes', () => {
    const morning = starsAboveHorizon(catalog, observer({ timeMinutes: 0 }));
    const evening = starsAboveHorizon(catalog, observer({ timeMinutes: 720 }));
    expect(morning.map((e) => e.star.id)).not.toEqual(evening.map((e) => e.star.id));
  });

  it('shows the same sky at the same sidereal moment a day later', () => {
    // A sidereal day is 3m 56s shorter than a solar day, so the sky at midnight
    // tonight returns 3m 56s earlier tomorrow.
    const tonight = starsAboveHorizon(catalog, observer({ dateISO: '1993-08-01', timeMinutes: 720 }));
    const tomorrow = starsAboveHorizon(
      catalog,
      observer({ dateISO: '1993-08-02', timeMinutes: 720 - (3 + 56 / 60) }),
    );
    expect(tomorrow.length).toBeCloseTo(tonight.length, -1);
  });

  it('handles the poles without crashing', () => {
    for (const latitude of [90, -90]) {
      const visible = starsAboveHorizon(catalog, observer({ latitude }));
      expect(visible.length).toBeGreaterThan(0);
      // From a pole, only your own hemisphere is ever visible.
      for (const entry of visible) {
        expect(Math.sign(entry.star.dec)).toBe(Math.sign(latitude));
      }
    }
  });

  it('handles an empty catalogue', () => {
    expect(starsAboveHorizon([], observer())).toEqual([]);
  });

  it('rejects an impossible latitude', () => {
    expect(() => starsAboveHorizon(catalog, observer({ latitude: 91 }))).toThrow(/latitude/);
    expect(() => starsAboveHorizon(catalog, observer({ latitude: Number.NaN }))).toThrow(/latitude/);
  });
});
