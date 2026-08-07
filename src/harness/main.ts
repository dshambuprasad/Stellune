/**
 * Cosmophony harness — DEV ONLY.
 *
 * Not part of the product. `harness.html` is not listed in the Vite build input,
 * so it is served by `npm run dev` and never shipped.
 *
 *   npm run dev  →  http://localhost:5173/harness.html
 *
 * SLICE B1 — the sampled audition. Until now this played the Phase 3.5 synth
 * palette over the real score: right notes, placeholder clothing. It now plays
 * the SAMPLED instruments through the mood lenses, under the mix law and the
 * mastering law, from the same schedule the offline renderer prints. What you
 * hear here and what `npm run render` writes are the same piece, voiced the
 * same way.
 *
 * What the harness is for, and why it shows its working: the mix law was
 * ratified after a render shipped with its hierarchy inverted and nobody could
 * see it. So the stem meters are on screen while it plays, and the panel says
 * out loud whether the mix is running on a real measurement or on the
 * documented fallback.
 *
 * "Play" must be clicked: browsers keep the audio context suspended until a
 * real user gesture, and that is exactly the constraint the engine documents.
 */

import '../style.css';
import { loadStarCatalog, type ObserverInput, type Star } from '../engine/model/index.ts';
import {
  prepareSession,
  renderWindow,
  type LivingSkyConfig,
  type SessionPlan,
} from '../engine/mapping/index.ts';
import {
  STEM_TARGETS_DBFS,
  createSampledStreamFromUrl,
  loadSampleCatalogue,
  type LensConfig,
  type SampledStream,
} from '../engine/audio/index.ts';

/** The birth sky: Bengaluru, 1 August 1993, local midnight. */
const BIRTH_SKY: ObserverInput = {
  latitude: 12.9719,
  longitude: 77.5937,
  dateISO: '1993-08-01',
  timeMinutes: 0,
  tzOffsetMinutes: 330,
};

/**
 * Tonight, from the same place.
 *
 * Read from the machine's clock at load. The harness is a dev tool and this is
 * the one place a clock is allowed near this project — the mapping layer stays
 * pure, and the session it is handed is a plain observer record like any other.
 */
function tonight(): ObserverInput {
  const now = new Date();
  return {
    latitude: 12.9719,
    longitude: 77.5937,
    dateISO: now.toISOString().slice(0, 10),
    timeMinutes: now.getHours() * 60 + now.getMinutes(),
    tzOffsetMinutes: -now.getTimezoneOffset(),
  };
}

type AnchorRule = LivingSkyConfig['openingAnchorRule'];

const root = document.querySelector<HTMLDivElement>('#harness');
if (!root) throw new Error('harness: #harness container missing');

root.innerHTML = `
  <main class="shell harness">
    <h1>Cosmophony</h1>
    <p class="tagline">Slice B1 audition — sampled instruments, live, through the mood lenses</p>
    <p class="status" id="status">Loading the catalogue…</p>

    <div class="controls">
      <span class="tabs" id="sky" role="tablist">
        <button type="button" id="sky-birth" role="tab" aria-selected="true">Birth Sky · 1 Aug 1993</button>
        <button type="button" id="sky-tonight" role="tab" aria-selected="false">Tonight</button>
      </span>
      <label>lens<select id="lens"></select></label>
      <label>anchor
        <select id="anchor">
          <option value="bookends">bookends</option>
          <option value="survives-gathering">survives-gathering</option>
          <option value="brightest">brightest</option>
        </select>
      </label>
      <label>from&nbsp;(s)<input id="from" type="number" value="0" min="0" step="30" /></label>
    </div>

    <div class="controls">
      <button id="play" type="button" disabled>Play</button>
      <button id="stop" type="button" disabled>Stop</button>
    </div>

    <pre class="score" id="plan"></pre>
    <pre class="levels" id="mix"></pre>
    <pre class="levels" id="levels"></pre>

    <p class="honesty">
      Structure is true — these are the real stars above Bengaluru on that date,
      rising, culminating and setting in their real order. Timbre, musical scale,
      instrument and the compression of time are artistic choices. This is never a
      claim about what space literally sounds like.
    </p>
  </main>
`;

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.querySelector<T>(`#${id}`);
  if (!found) throw new Error(`harness: #${id} missing`);
  return found;
};

const status = el('status');
const playButton = el<HTMLButtonElement>('play');
const stopButton = el<HTMLButtonElement>('stop');
// Two buttons rather than a <select>: the choice is binary, and it reads as a
// choice rather than as a list to open.
const skyBirth = el<HTMLButtonElement>('sky-birth');
const skyTonight = el<HTMLButtonElement>('sky-tonight');
const lensSelect = el<HTMLSelectElement>('lens');
const anchorSelect = el<HTMLSelectElement>('anchor');
const fromInput = el<HTMLInputElement>('from');

let catalog: Star[] = [];
let lenses: LensConfig | null = null;
let stream: SampledStream | undefined;
let metersTimer: number | undefined;
let dropped = 0;

const isBirthSky = (): boolean => skyBirth.getAttribute('aria-selected') === 'true';
const observer = (): ObserverInput => (isBirthSky() ? BIRTH_SKY : tonight());

/**
 * Tonight is the endless mode — there is no birth moment to build an arc
 * toward, so the shape follows the sky itself (MUSICAL_VISION §4).
 */
const currentConfig = (): Partial<LivingSkyConfig> =>
  isBirthSky()
    ? { mode: 'birth-sky', openingAnchorRule: anchorSelect.value as AnchorRule }
    : { mode: 'endless', openingAnchorRule: anchorSelect.value as AnchorRule, kappa: 30 };

function describe(plan: SessionPlan): string {
  const name = (id: string | null): string =>
    catalog.find((s) => s.id === id)?.name ?? id ?? '—';
  const preview = renderWindow(plan, 0, 240);
  const roles = new Map<string, number>();
  for (const event of preview.events) roles.set(event.role, (roles.get(event.role) ?? 0) + 1);

  return [
    `mode      ${plan.config.mode}   kappa ${plan.kappa.toFixed(2)}x   key ${plan.scale}`,
    `weather   density ${plan.weather.density}  solitude ${plan.weather.solitude}` +
      `  -> silence ${plan.silenceBudget}`,
    `anchor    ${name(plan.openingStarId)}   (rule: ${plan.config.openingAnchorRule})`,
    plan.bloomSeconds === null
      ? 'bloom     — (endless mode: the arc follows the sky itself)'
      : `bloom     ${name(plan.bloomStarId)} at ${plan.bloomSeconds.toFixed(0)}s`,
    `motifs    ${plan.motifs.length} available to this observer`,
    `first 4m  ${[...roles].map(([r, n]) => `${r}:${n}`).join('  ')}`,
  ].join('\n');
}

/**
 * The mix law, on screen while it plays.
 *
 * Each role's measured level next to its ratified target. This is the thing
 * that was missing when the v1 render shipped inverted — the numbers existed,
 * nobody was looking at them, and it took stem forensics after the fact.
 */
function mixPanel(): string {
  if (!stream) return '';
  const stems = stream.getStemLevels();
  const rows = (['ground', 'chord', 'figuration', 'lead', 'weather'] as const).map((role) => {
    const measured = stems[role] ?? -Infinity;
    const target = STEM_TARGETS_DBFS[role];
    const bar = '█'.repeat(Math.max(0, Math.round((measured + 60) / 3)));
    return `  ${role.padEnd(11)}${measured > -60 ? measured.toFixed(1).padStart(6) : '   —  '} ` +
      `(target ${String(target).padStart(4)})  ${bar}`;
  });
  const master = stems.master ?? -Infinity;
  return [
    `mix law — ${stream.calibrated ? 'measured trims' : 'FALLBACK trims (run `npm run calibrate`)'}` +
      '   [a display, not the instrument: check:mix-law measures the rendered audio]',
    ...rows,
    `  ${'master'.padEnd(11)}${master > -60 ? master.toFixed(1).padStart(6) : '   —  '}` +
      `   limiter ${(stems.limiterDb ?? 0).toFixed(2)} dB` +
      `   t=${stream.playheadSeconds().toFixed(0)}s` +
      (dropped > 0 ? `   ${dropped} note(s) dropped while loading` : ''),
  ].join('\n');
}

function refresh(): void {
  const plan = prepareSession(catalog, observer(), currentConfig());
  el('plan').textContent = describe(plan);
  if (!stream) {
    status.textContent = 'Ready. Click Play (a user gesture is required to start audio).';
  }
}

function teardown(): void {
  if (metersTimer !== undefined) window.clearInterval(metersTimer);
  metersTimer = undefined;
  stream?.stop();
  stream?.dispose();
  stream = undefined;
  dropped = 0;
  playButton.disabled = false;
  stopButton.disabled = true;
  el('mix').textContent = '';
  el('levels').textContent = '';
}

async function main(): Promise<void> {
  catalog = await loadStarCatalog();
  const catalogue = await loadSampleCatalogue();
  lenses = catalogue.lenses;

  for (const [id, lens] of Object.entries(lenses.lenses)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = `${lens.title} — ${lens.palette}`;
    lensSelect.append(option);
  }
  lensSelect.value = lenses.defaults.birthSky;

  refresh();
  playButton.disabled = false;

  // Changing the sky or the anchor is a different piece, so it tears down.
  for (const [button, other] of [
    [skyBirth, skyTonight],
    [skyTonight, skyBirth],
  ] as const) {
    button.addEventListener('click', () => {
      button.setAttribute('aria-selected', 'true');
      other.setAttribute('aria-selected', 'false');
      if (lenses) {
        lensSelect.value = isBirthSky() ? lenses.defaults.birthSky : lenses.defaults.tonight;
      }
      teardown();
      refresh();
    });
  }
  anchorSelect.addEventListener('change', () => {
    teardown();
    refresh();
  });

  // Changing the LENS does not. That is the whole claim: same notes, same
  // times, different clothing — applied from the next window, with a dip
  // across the seam, without stopping the music.
  lensSelect.addEventListener('change', () => {
    if (!stream) return;
    const lensId = lensSelect.value;
    status.textContent = `Loading ${lensId}…`;
    void stream
      .setLens(lensId)
      .then(() => {
        status.textContent = `Lens → ${lensId}. It changes from the next window; the notes do not move.`;
      })
      .catch((error: unknown) => {
        status.textContent = `Lens change failed: ${error instanceof Error ? error.message : String(error)}`;
      });
  });

  playButton.addEventListener('click', () => {
    playButton.disabled = true;
    const plan = prepareSession(catalog, observer(), currentConfig());
    const from = Number(fromInput.value) || 0;
    status.textContent = 'Loading instruments…';

    void createSampledStreamFromUrl(plan, {
      lensId: lensSelect.value,
      // Slice B1.1: always on in the harness. This is the tool the ear report
      // gets correlated against, and a diagnostic you have to remember to turn
      // on is one you will not have when the artefact happens.
      diagnostics: true,
      onProgress: (loaded, total) => {
        // Only while the FIRST lens is loading. A lens swap loads its
        // fall-through tier in the background long after the swap has
        // happened, and letting that overwrite the status made the harness
        // claim it was still loading while it was plainly playing.
        if (!stream) status.textContent = `Loading instruments… ${loaded}/${total}`;
      },
      onDropped: () => {
        dropped += 1;
      },
    })
      .then(async (created) => {
        stream = created;
        // DEV ONLY: the live player, reachable from the console.
        //
        // `scheduleFor()` is how the lens-invariance claim is checked against
        // the LIVE path rather than only against the pure module — swap the
        // lens, ask for the same span, and the notes and their times must be
        // identical. Handy enough to keep; the harness is not shipped.
        (window as unknown as { cosmophony?: unknown }).cosmophony = created;
        await created.play(from);
        status.textContent =
          `Playing ${lensSelect.value} from ${from}s. The sky is turning.` +
          (created.calibrated ? '' : '  ⚠ uncalibrated mix — run `npm run calibrate`.');
        stopButton.disabled = false;

        metersTimer = window.setInterval(() => {
          el('mix').textContent = mixPanel();
          const levels = stream?.getLevels() ?? new Float32Array(0);
          const sources = stream?.levelSources() ?? [];
          const shown = [...levels]
            .map((v, i) => ({ v, id: sources[i] ?? '?' }))
            .filter((x) => x.v > 0.002)
            .sort((a, b) => b.v - a.v)
            .slice(0, 10);
          el('levels').textContent =
            'sounding  ' +
            shown
              .map((x) => `${catalog.find((s) => s.id === x.id)?.name ?? x.id}:${x.v.toFixed(3)}`)
              .join('  ');
        }, 150);
      })
      .catch((error: unknown) => {
        status.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`;
        playButton.disabled = false;
      });
  });

  stopButton.addEventListener('click', () => {
    teardown();
    status.textContent = 'Stopped.';
  });
}

void main().catch((error: unknown) => {
  status.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`;
});
