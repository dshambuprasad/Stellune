/**
 * Phase 4 — THE ONE SCREEN.
 *
 * "One screen. Two modes (Tonight / Birth Sky). Five mood lenses. Play-pause.
 * Pan/zoom starfield (visual only). Glow-sync. The honesty label. Nothing else."
 * — PRODUCT_WALKTHROUGH, "v1 surface (ALL of it)".
 *
 * That list is a ceiling, not a starting point. There is no onboarding, no
 * tour, no settings page and no account, because the walkthrough's core
 * scenario is "open app → no login, no setup → ONE button → within a second the
 * sky sings". Everything here is arranged so the shortest path through the
 * screen is the intended one, and every other control is out of the way until
 * it is wanted.
 *
 * THE RULE THIS FILE ENFORCES: music changes only when WHEN or WHERE changes,
 * or the lens does. The camera never talks to the session — see `gestures.ts`.
 */

import type { City, Star } from '../engine/index.ts';
import { DataError, loadCities, loadStarCatalog } from '../engine/index.ts';

import { attachCameraGestures } from './gestures.ts';
import {
  DEFAULT_LENS_BIRTH,
  DEFAULT_LENS_TONIGHT,
  LENSES,
  type LensId,
  lensById,
  verifyLensCatalogue,
} from './lenses.ts';
import {
  placeFromCity,
  placeFromPosition,
  requestGeolocation,
  searchCities,
  type ResolvedPlace,
} from './location.ts';
import {
  HONESTY_TEXT,
  TIMEZONE_CAVEAT,
  clock,
  humanDate,
  humanTime,
  sessionLabel,
  timeCompressionLine,
  todayISO,
} from './format.ts';
import {
  EmptySkyError,
  Session,
  buildSession,
  observerForCity,
  observerForNow,
  type SessionMode,
} from './session.ts';
import { EMPTY_GLOW, STAR_TUNING, Starfield } from './starfield.ts';
import { loadConstellationFigures } from './constellations.ts';
import { toRenderStars } from './starStyle.ts';

/**
 * `tuning` is Slice B1.1's veil.
 *
 * The sampled player does not resolve until every instrument the lens needs is
 * loaded, because the alternative — starting on time and voicing whatever has
 * arrived — is how the B1 capture got notes that were not the instrument they
 * claimed to be. A short honest wait beats a wrong note, and the screen says
 * which one it is doing.
 */
type Screen = 'loading' | 'ready' | 'tuning' | 'playing' | 'complete' | 'error';

interface AppState {
  screen: Screen;
  mode: SessionMode;
  lens: LensId;
  place: ResolvedPlace | null;
  /** Set when geolocation was asked for and did not answer. */
  geolocationDeclined: boolean;
  /** Birth Sky inputs. */
  birthDateISO: string;
  birthTimeMinutes: number | undefined;
  birthCity: City | null;
  /** A message the person needs to read. */
  problem: string | null;
  lowPower: boolean;
  /**
   * Whether the lens on screen is the person's own choice or just the mode's
   * default. Switching modes should adopt the new mode's default lens — but
   * only until someone has actually expressed a preference, after which their
   * choice follows them.
   */
  lensChosen: boolean;
}

const LOW_POWER_FRAME_MS = 1000 / 30;

export function mountApp(container: HTMLElement): void {
  container.innerHTML = SHELL_HTML;

  const el = <T extends HTMLElement>(selector: string): T => {
    const found = container.querySelector<T>(selector);
    if (!found) throw new Error(`Stellune: the shell is missing ${selector}`);
    return found;
  };

  const canvas = el<HTMLCanvasElement>('#sky');
  const statusLine = el('#status-line');
  const compressionLine = el('#compression-line');
  const problemBox = el('#problem');
  const playButton = el<HTMLButtonElement>('#play');
  const progressBar = el('#progress-fill');
  const progressWrap = el('#progress');
  const elapsedLabel = el('#elapsed');
  const panel = el('#panel');
  const modeTabs = el('#mode-tabs');
  const lensRow = el('#lens-row');
  const lensNote = el('#lens-note');
  const birthFields = el('#birth-fields');
  const cityInput = el<HTMLInputElement>('#city-input');
  const cityResults = el('#city-results');
  const dateInput = el<HTMLInputElement>('#date-input');
  const timeInput = el<HTMLInputElement>('#time-input');
  const completeBox = el('#complete');
  const honestyBox = el('#honesty');
  const lowPowerToggle = el<HTMLButtonElement>('#low-power');
  const timezoneNote = el('#timezone-note');

  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state: AppState = {
    screen: 'loading',
    mode: 'tonight',
    lens: DEFAULT_LENS_TONIGHT,
    place: null,
    geolocationDeclined: false,
    birthDateISO: todayISO(-new Date().getTimezoneOffset()),
    birthTimeMinutes: undefined,
    birthCity: null,
    problem: null,
    lowPower: prefersReducedMotion,
    lensChosen: false,
  };

  let catalog: Star[] = [];
  let cities: City[] = [];
  let session: Session | null = null;
  const starfield = new Starfield(canvas, { lowPower: state.lowPower });
  let frame = 0;
  let lastDraw = 0;
  let revealStart = 0;

  honestyBox.textContent = HONESTY_TEXT;

  // ---- the render loop ---------------------------------------------------
  // One loop for the whole app. It runs even when nothing is playing, so the
  // sky keeps its slow turn and the screen never looks frozen.
  const loop = (now: number): void => {
    frame = requestAnimationFrame(loop);

    // Low-power mode halves the frame rate rather than degrading the image:
    // a calm sky at 30fps still reads as calm; a stuttering one does not.
    if (starfield.lowPower && now - lastDraw < LOW_POWER_FRAME_MS - 1) return;
    lastDraw = now;

    if (session) {
      session.tick();
      starfield.setSiderealTime(session.siderealTimeDegrees());
      starfield.setGlow(session.playing ? session.glow() : EMPTY_GLOW);
      if (session.complete && state.screen === 'playing') {
        state.screen = 'complete';
        render();
      }
      if (state.screen === 'playing') paintProgress();
    } else {
      starfield.setGlow(EMPTY_GLOW);
    }

    if (revealStart > 0) {
      starfield.setReveal(Math.min(1, (now - revealStart) / 2200));
    }
    starfield.render();
  };

  /** Re-fit the dome to whatever the panel is not covering. Set below. */
  let fitDome: () => void = () => undefined;

  const paintProgress = (): void => {
    if (!session) return;
    const bounded = Number.isFinite(session.totalSeconds);
    // Endless mode has no end, so it gets no bar to fill. Showing a full track
    // would say "finished"; showing a creeping one would say "wait for this".
    // Neither is true of a piece you are meant to leave running.
    progressWrap.dataset.shape = bounded ? 'bounded' : 'endless';
    if (bounded) {
      progressBar.style.width = `${(session.progress * 100).toFixed(2)}%`;
      elapsedLabel.textContent = `${clock(session.elapsedSeconds)} / ${clock(session.totalSeconds)}`;
    } else {
      progressBar.style.width = '0%';
      elapsedLabel.textContent = `${clock(session.elapsedSeconds)} · endless`;
    }
  };

  // ---- state → DOM -------------------------------------------------------
  const render = (): void => {
    container.dataset.screen = state.screen;
    container.dataset.mode = state.mode;

    problemBox.textContent = state.problem ?? '';
    problemBox.hidden = state.problem == null;

    birthFields.hidden = state.mode !== 'birth-sky';
    progressWrap.hidden = state.screen !== 'playing' && state.screen !== 'complete';
    completeBox.hidden = state.screen !== 'complete';
    panel.hidden = state.screen === 'loading';

    for (const tab of modeTabs.querySelectorAll<HTMLButtonElement>('button')) {
      const selected = tab.dataset.mode === state.mode;
      tab.setAttribute('aria-selected', String(selected));
    }
    for (const chip of lensRow.querySelectorAll<HTMLButtonElement>('button')) {
      const selected = chip.dataset.lens === state.lens;
      chip.setAttribute('aria-pressed', String(selected));
    }
    const lens = lensById(state.lens);
    lensNote.textContent = lens ? `${lens.title} — ${lens.palette}` : '';

    timezoneNote.hidden = !(state.mode === 'birth-sky' || state.place?.source === 'city');

    playButton.disabled = state.screen === 'loading' || (state.mode === 'birth-sky' && !state.birthCity);
    playButton.textContent =
      session?.playing === true ? 'Pause' : state.screen === 'playing' ? 'Resume' : 'Play';
    playButton.setAttribute(
      'aria-label',
      session?.playing === true ? 'Pause the sky' : 'Play the sky',
    );

    lowPowerToggle.setAttribute('aria-pressed', String(state.lowPower));
    lowPowerToggle.textContent = state.lowPower ? 'Low power: on' : 'Low power: off';

    if (session) {
      const when =
        state.mode === 'tonight'
          ? 'tonight'
          : `${humanDate(state.birthDateISO)}${
              humanTime(state.birthTimeMinutes) ? ` · ${humanTime(state.birthTimeMinutes)}` : ''
            }`;
      statusLine.textContent = sessionLabel(
        session.request.placeLabel,
        when,
        session.plan.weather.visibleCount,
      );
      compressionLine.textContent = timeCompressionLine(session.kappa);
    } else if (state.screen === 'tuning') {
      // Named for what it is. "Loading" invites the question "loading what?";
      // this says the sky is being tuned, which is both true and calm.
      statusLine.textContent = 'Tuning the sky';
      compressionLine.textContent = '';
    } else if (state.screen === 'loading') {
      statusLine.textContent = 'Finding tonight’s sky…';
      compressionLine.textContent = '';
    } else if (state.place) {
      statusLine.textContent = `${state.place.label} · ready`;
      compressionLine.textContent = '';
    } else {
      statusLine.textContent = 'Choose a place to begin.';
      compressionLine.textContent = '';
    }

    // Keep the clock honest in states the animation loop is not painting —
    // pausing or finishing must not leave a stale time on screen.
    paintProgress();
    fitDome();
  };

  const fail = (message: string): void => {
    state.problem = message;
    state.screen = state.screen === 'loading' ? 'error' : state.screen;
    render();
  };

  // ---- starting and stopping --------------------------------------------
  const startSession = async (): Promise<void> => {
    const place = state.mode === 'birth-sky' ? cityPlace() : state.place;
    if (!place) {
      fail('Pick a city first — the sky depends on where you are standing.');
      return;
    }

    session?.dispose();
    session = null;

    const observer =
      state.mode === 'tonight'
        ? observerForNow(place.latitude, place.longitude, place.tzOffsetMinutes)
        : observerForCity(
            { ...(state.birthCity as City), lat: place.latitude, lon: place.longitude },
            state.birthDateISO,
            state.birthTimeMinutes,
          );

    try {
      const built = buildSession(catalog, {
        mode: state.mode,
        observer,
        placeLabel: place.label,
        lens: state.lens,
      });
      session = built.session;
      state.problem = null;
    } catch (error) {
      if (error instanceof EmptySkyError) {
        // A real outcome, not a fault: say what happened and offer the fix.
        fail(
          `${error.message} Try another time of night, or a place further from the pole.`,
        );
        return;
      }
      fail(error instanceof Error ? error.message : String(error));
      return;
    }

    starfield.setObserver(observer.latitude);
    starfield.setSiderealTime(session.siderealTimeDegrees());
    revealStart = performance.now();
    starfield.setReveal(0);

    state.screen = 'tuning';
    render();
    try {
      await session.play(0);
      state.screen = 'playing';
    } catch (error) {
      // Autoplay policy, or an audio device that refused. The sky still draws.
      fail(
        `The sky is drawn, but the sound could not start: ${
          error instanceof Error ? error.message : String(error)
        }. Press Play again.`,
      );
      state.screen = 'ready';
    }
    render();
  };

  const cityPlace = (): ResolvedPlace | null =>
    state.birthCity ? placeFromCity(state.birthCity) : null;

  const togglePlay = async (): Promise<void> => {
    if (!session || state.screen === 'complete') {
      await startSession();
      return;
    }
    if (session.playing) {
      session.pause();
    } else {
      state.screen = 'tuning';
      render();
      await session.play();
      state.screen = 'playing';
    }
    render();
  };

  // ---- wiring ------------------------------------------------------------
  playButton.addEventListener('click', () => {
    void togglePlay();
  });

  modeTabs.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]');
    if (!button) return;
    const mode = button.dataset.mode as SessionMode;
    if (mode === state.mode) return;
    state.mode = mode;
    // Each mode has its own default lens (MUSICAL_VISION §5): Ground for
    // endless, Aurora for a birth sky. Switching modes adopts the new default
    // unless the person has picked a lens themselves, in which case it follows
    // them across.
    if (!state.lensChosen) {
      state.lens = mode === 'tonight' ? DEFAULT_LENS_TONIGHT : DEFAULT_LENS_BIRTH;
    }
    session?.dispose();
    session = null;
    state.screen = 'ready';
    state.problem = null;
    render();
  });

  lensRow.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-lens]');
    if (!button) return;
    const lens = button.dataset.lens as LensId;
    if (lens === state.lens) return;
    state.lens = lens;
    state.lensChosen = true;
    render();
    // A lens change is a change of instrument, not of piece: the session keeps
    // its place in the score.
    if (session) void session.setLens(lens).then(render);
  });

  lowPowerToggle.addEventListener('click', () => {
    state.lowPower = !state.lowPower;
    starfield.setLowPower(state.lowPower);
    render();
  });

  el('#replay').addEventListener('click', () => {
    state.screen = 'ready';
    void startSession();
  });

  el('#go-endless').addEventListener('click', () => {
    state.mode = 'tonight';
    state.lens = DEFAULT_LENS_TONIGHT;
    session?.dispose();
    session = null;
    state.screen = 'ready';
    void startSession();
  });

  // Birth Sky inputs.
  dateInput.addEventListener('change', () => {
    state.birthDateISO = dateInput.value || state.birthDateISO;
  });
  timeInput.addEventListener('change', () => {
    if (!timeInput.value) {
      state.birthTimeMinutes = undefined;
      return;
    }
    const [h, m] = timeInput.value.split(':').map(Number);
    state.birthTimeMinutes = (h ?? 0) * 60 + (m ?? 0);
  });

  let activeSuggestion = -1;
  const renderSuggestions = (matches: City[]): void => {
    cityResults.innerHTML = '';
    activeSuggestion = -1;
    cityResults.hidden = matches.length === 0;
    for (const [index, city] of matches.entries()) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'city-option';
      item.dataset.index = String(index);
      item.innerHTML = `<span>${escapeHtml(city.name)}</span><small>${escapeHtml(city.country)}</small>`;
      item.addEventListener('click', () => chooseCity(city));
      cityResults.append(item);
    }
  };

  const chooseCity = (city: City): void => {
    state.birthCity = city;
    cityInput.value = city.name;
    cityResults.hidden = true;
    cityResults.innerHTML = '';
    state.problem = null;
    render();
  };

  cityInput.addEventListener('input', () => {
    state.birthCity = null;
    renderSuggestions(searchCities(cities, cityInput.value));
    render();
  });

  cityInput.addEventListener('keydown', (event) => {
    const options = [...cityResults.querySelectorAll<HTMLButtonElement>('.city-option')];
    if (options.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      activeSuggestion =
        (activeSuggestion + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
      for (const [i, option] of options.entries()) {
        option.classList.toggle('is-active', i === activeSuggestion);
      }
    } else if (event.key === 'Enter' && activeSuggestion >= 0) {
      event.preventDefault();
      options[activeSuggestion]?.click();
    } else if (event.key === 'Escape') {
      cityResults.hidden = true;
    }
  });

  document.addEventListener('click', (event) => {
    if (!cityResults.contains(event.target as Node) && event.target !== cityInput) {
      cityResults.hidden = true;
    }
  });

  attachCameraGestures(canvas, starfield);

  /**
   * Keep the dome in the part of the screen the panel is not covering.
   *
   * The panel's height changes with the mode (Birth Sky adds three fields), the
   * viewport and the font size, so it is measured rather than guessed. On a
   * phone this is the difference between seeing a whole sky and seeing the top
   * half of one.
   */
  fitDome = (): void => {
    const panelHeight = panel.hidden ? 0 : panel.getBoundingClientRect().height;
    const topBar = container.querySelector('.topbar');
    const topHeight = topBar ? topBar.getBoundingClientRect().height : 0;
    // Both backdrops fade out toward the sky, so neither fully occludes what is
    // behind it — roughly three-quarters of the panel and half the title area.
    starfield.setOcclusion(panelHeight * 0.72, topHeight * 0.5);
  };

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(fitDome).observe(panel);
  }
  window.addEventListener('resize', () => {
    starfield.resize();
    fitDome();
  });

  // Never leave audio running in a tab nobody is looking at.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && session?.playing) {
      session.pause();
      render();
    }
  });

  // ---- boot --------------------------------------------------------------
  const boot = async (): Promise<void> => {
    frame = requestAnimationFrame(loop);
    try {
      const [loadedStars, loadedCities] = await Promise.all([loadStarCatalog(), loadCities()]);
      catalog = loadedStars;
      cities = loadedCities;
    } catch (error) {
      fail(
        error instanceof DataError
          ? error.message
          : `The star catalogue could not be loaded: ${String(error)}`,
      );
      return;
    }

    starfield.setStars(toRenderStars(catalog, STAR_TUNING));
    // The figures are a drawing over the sky, not the sky: loaded after it, and
    // never allowed to fail the boot. See `constellations.ts`.
    void loadConstellationFigures().then((figures) => starfield.setFigures(figures));
    dateInput.value = state.birthDateISO;

    // Show a sky immediately, before anyone has pressed anything: a plausible
    // one for the machine's own clock and zone, so the screen is never empty.
    const localOffset = -new Date().getTimezoneOffset();
    starfield.setObserver(0);
    revealStart = performance.now();

    const position = await requestGeolocation();
    if (position) {
      state.place = placeFromPosition(position, cities);
    } else {
      state.geolocationDeclined = true;
      // Fall back to the city whose zone matches this machine's — a decent
      // guess that costs nothing and is always overridable.
      const guess =
        cities.find((city) => city.tzOffsetMinutes === localOffset) ?? cities[0] ?? null;
      state.place = guess ? placeFromCity(guess) : null;
      state.problem =
        'Location is off, so this is ' +
        (guess ? `${guess.name}` : 'a default city') +
        '. Switch to Birth Sky to choose any city.';
    }

    if (state.place) {
      starfield.setObserver(state.place.latitude);
      state.birthCity = state.place.city;
      if (state.place.city) cityInput.value = state.place.city.name;
      state.birthDateISO = todayISO(state.place.tzOffsetMinutes);
      dateInput.value = state.birthDateISO;
      // Draw the real sky for this place straight away, still and quiet, so
      // the first thing anyone sees is their own sky rather than a splash.
      starfield.setSiderealTime(previewSiderealTime(state.place.latitude, state.place.longitude));
    }

    state.screen = 'ready';
    render();

    const problems = await verifyLensCatalogue();
    if (problems.length > 0) console.warn('Stellune lens catalogue:', problems);
  };

  void boot();

  // Expose a minimal handle for the smoke test — no product surface depends on
  // it, and it carries no controls, only observations.
  Object.defineProperty(window, '__cosmophony', {
    value: {
      get screen(): Screen {
        return state.screen;
      },
      get drawnStars(): number {
        return starfield.drawnLastFrame;
      },
      get averageFrameMs(): number {
        return starfield.averageFrameMs;
      },
      get playing(): boolean {
        return session?.playing ?? false;
      },
      get elapsed(): number {
        return session?.elapsedSeconds ?? 0;
      },
      /** Which star the LEAD is speaking through, if any. Observation only. */
      get lead(): string | null {
        return session?.playing === true ? session.glow().leadStarId : null;
      },
      get leadLabel(): string | null {
        return session?.playing === true ? session.glow().leadLabel : null;
      },
      /** Where that star is on screen, so evidence can be framed on it. */
      get leadScreen(): { x: number; y: number } | null {
        return starfield.leadScreen;
      },
      resetStats: () => starfield.resetStats(),
      stop: () => {
        cancelAnimationFrame(frame);
        session?.dispose();
      },
    },
    configurable: true,
  });
}

/** LST for the preview sky, straight from the wall clock. */
function previewSiderealTime(_latitude: number, longitude: number): number {
  const now = new Date();
  const jd = now.getTime() / 86_400_000 + 2440587.5;
  const t = (jd - 2451545.0) / 36525;
  const gmst =
    280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t * t - (t * t * t) / 38710000;
  return ((gmst + longitude) % 360 + 360) % 360;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

const SHELL_HTML = `
  <canvas id="sky" aria-label="The real sky above you, drawn as points of light"></canvas>

  <header class="topbar">
    <h1>Stellune</h1>
    <p class="status" id="status-line"></p>
  </header>

  <p class="problem" id="problem" role="status" hidden></p>

  <section class="complete" id="complete" hidden>
    <p>The sky has come back to where it began.</p>
    <div class="complete-actions">
      <button type="button" id="replay" class="ghost">Play it again</button>
      <button type="button" id="go-endless" class="ghost">Stay with tonight</button>
    </div>
    <p class="made-with">Made with Stellune — your sky, as sound.</p>
  </section>

  <div class="panel" id="panel">
    <div class="progress" id="progress" hidden>
      <div class="progress-track"><div class="progress-fill" id="progress-fill"></div></div>
      <span class="elapsed" id="elapsed"></span>
    </div>

    <div class="controls">
      <div class="tabs" id="mode-tabs" role="tablist" aria-label="Session type">
        <button type="button" role="tab" data-mode="tonight" aria-selected="true">Tonight</button>
        <button type="button" role="tab" data-mode="birth-sky" aria-selected="false">Birth Sky</button>
      </div>
      <button type="button" id="play" class="play">Play</button>
    </div>

    <div class="birth-fields" id="birth-fields" hidden>
      <label class="field city-field">
        <span>City</span>
        <input id="city-input" type="text" autocomplete="off" placeholder="Bengaluru" />
        <div class="city-results" id="city-results" hidden></div>
      </label>
      <label class="field">
        <span>Date</span>
        <input id="date-input" type="date" />
      </label>
      <label class="field">
        <span>Time <em>optional</em></span>
        <input id="time-input" type="time" />
      </label>
    </div>

    <div class="lenses" id="lens-row" role="group" aria-label="Mood lens">
      ${LENSES.map(
        (lens) =>
          `<button type="button" data-lens="${lens.id}" aria-pressed="false" title="${lens.homage}">${lens.title}</button>`,
      ).join('')}
    </div>
    <p class="lens-note" id="lens-note"></p>

    <p class="compression" id="compression-line"></p>
    <p class="honesty" id="honesty"></p>
    <p class="honesty subtle" id="timezone-note" hidden>${TIMEZONE_CAVEAT}</p>
    <div class="footer-row">
      <button type="button" id="low-power" class="ghost tiny" aria-pressed="false">Low power: off</button>
    </div>
  </div>
`;
