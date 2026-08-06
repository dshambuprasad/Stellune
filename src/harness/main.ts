/**
 * Cosmophony harness — DEV ONLY.
 *
 * Not part of the product. `harness.html` is not listed in the Vite build input,
 * so it is served by `npm run dev` and never shipped.
 *
 *   npm run dev  →  http://localhost:5173/harness.html
 *
 * Slice A2 (the audition): plays the LIVING stream — the windowed score from the
 * mapping layer, scheduled through the existing Phase 3.5 palette. Rough
 * clothing on real structure; the point is to judge the music's bones.
 *
 * "Play" must be clicked: browsers keep the audio context suspended until a real
 * user gesture, and that is exactly the constraint the engine documents.
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
  createStreamEngine,
  renderStreamOffline,
  type AudioStyle,
  type StreamEngine,
} from '../engine/audio/index.ts';
import { encodeWav } from './wav.ts';

/** The fixed sample sky: Bengaluru, 1993-08-01, local midnight. */
const BENGALURU: ObserverInput = {
  latitude: 12.9719,
  longitude: 77.5937,
  dateISO: '1993-08-01',
  timeMinutes: 0,
  tzOffsetMinutes: 330,
};

type AnchorRule = LivingSkyConfig['openingAnchorRule'];

const params = new URLSearchParams(location.search);
const readNumber = (key: string, fallback: number): number => {
  const value = Number(params.get(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const root = document.querySelector<HTMLDivElement>('#harness');
if (!root) throw new Error('harness: #harness container missing');

root.innerHTML = `
  <main class="shell harness">
    <h1>Cosmophony</h1>
    <p class="tagline">Slice A2 audition — the living sky, Bengaluru, 1 August 1993</p>
    <p class="status" id="status">Loading the catalogue…</p>

    <div class="controls">
      <label>mode
        <select id="mode">
          <option value="birth-sky">birth-sky</option>
          <option value="endless">endless</option>
        </select>
      </label>
      <label>anchor
        <select id="anchor">
          <option value="bookends">bookends</option>
          <option value="survives-gathering">survives-gathering</option>
          <option value="brightest">brightest</option>
        </select>
      </label>
      <label>style
        <select id="style">
          <option value="lush">lush</option>
          <option value="subtle">subtle</option>
        </select>
      </label>
      <label>from&nbsp;(s)<input id="from" type="number" value="0" min="0" step="10" /></label>
    </div>

    <div class="controls">
      <button id="play" type="button" disabled>Play</button>
      <button id="stop" type="button" disabled>Stop</button>
      <button id="render" type="button" disabled>Render WAV</button>
    </div>

    <pre class="score" id="plan"></pre>
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
const renderButton = el<HTMLButtonElement>('render');
const modeSelect = el<HTMLSelectElement>('mode');
const anchorSelect = el<HTMLSelectElement>('anchor');
const styleSelect = el<HTMLSelectElement>('style');
const fromInput = el<HTMLInputElement>('from');

let catalog: Star[] = [];
let engine: StreamEngine | undefined;
let levelsTimer: number | undefined;

const currentConfig = (): Partial<LivingSkyConfig> => ({
  mode: modeSelect.value as LivingSkyConfig['mode'],
  openingAnchorRule: anchorSelect.value as AnchorRule,
  ...(modeSelect.value === 'endless' ? { kappa: 30 } : {}),
});

const currentStyle = (): AudioStyle => (styleSelect.value === 'subtle' ? 'subtle' : 'lush');

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

function refresh(): void {
  const plan = prepareSession(catalog, BENGALURU, currentConfig());
  el('plan').textContent = describe(plan);
  status.textContent = 'Ready. Click Play (a user gesture is required to start audio).';
}

function teardown(): void {
  if (levelsTimer !== undefined) window.clearInterval(levelsTimer);
  levelsTimer = undefined;
  engine?.stop();
  engine?.dispose();
  engine = undefined;
  playButton.disabled = false;
  stopButton.disabled = true;
}

async function main(): Promise<void> {
  catalog = await loadStarCatalog();
  refresh();

  playButton.disabled = false;
  renderButton.disabled = false;

  for (const control of [modeSelect, anchorSelect, styleSelect]) {
    control.addEventListener('change', () => {
      teardown();
      refresh();
    });
  }

  playButton.addEventListener('click', () => {
    const plan = prepareSession(catalog, BENGALURU, currentConfig());
    engine = createStreamEngine(plan, { style: currentStyle() });
    const from = Number(fromInput.value) || 0;

    void engine.play(from).then(() => {
      status.textContent = `Playing from ${from}s. The sky is turning.`;
      playButton.disabled = true;
      stopButton.disabled = false;
      levelsTimer = window.setInterval(() => {
        const levels = engine?.getLevels() ?? new Float32Array(0);
        const sources = engine?.getLevelSources() ?? [];
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
      }, 120);
    });
  });

  stopButton.addEventListener('click', () => {
    teardown();
    status.textContent = 'Stopped.';
  });

  renderButton.addEventListener('click', () => {
    renderButton.disabled = true;
    const from = Number(fromInput.value) || 0;
    const seconds = readNumber('seconds', 150);
    const name =
      params.get('name') ??
      `a2-${modeSelect.value}-${anchorSelect.value}-${styleSelect.value}-${from}s.wav`;
    status.textContent = `Rendering ${seconds}s from ${from}s offline…`;

    const plan = prepareSession(catalog, BENGALURU, currentConfig());
    const sampleRate = readNumber('rate', 32000);
    void renderStreamOffline(plan, from, from + seconds, { style: currentStyle(), sampleRate })
      .then(async (buffer) => {
        const blob = encodeWav(buffer);
        const size = `${(blob.size / 1024).toFixed(0)} KB`;
        try {
          const response = await fetch('/__save-clip', {
            method: 'POST',
            headers: { 'x-clip-name': name },
            body: blob,
          });
          if (!response.ok) throw new Error(`server answered ${response.status}`);
          const saved = (await response.json()) as { path: string };
          status.textContent = `Rendered ${seconds}s → ${saved.path} (${size}).`;
        } catch {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = name;
          link.click();
          URL.revokeObjectURL(url);
          status.textContent = `Rendered ${seconds}s → downloaded ${name} (${size}).`;
        }
        renderButton.disabled = false;
      })
      .catch((error: unknown) => {
        status.textContent = `Render failed: ${error instanceof Error ? error.message : String(error)}`;
        renderButton.disabled = false;
      });
  });
}

void main().catch((error: unknown) => {
  status.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`;
});
