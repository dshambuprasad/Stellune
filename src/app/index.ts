/**
 * The app shell — cheap-to-change by design.
 *
 * This is the only part of the codebase that is allowed to know about
 * everything: the engine, the instruments, the DOM, capture/export. Keep the
 * expensive thinking in `engine/`; keep this layer replaceable.
 *
 * Phase 0 mounts a placeholder so `npm run dev` shows something honest.
 * Phase 4 replaces it with the real Birth Sky experience.
 */

import { DataError, loadCities, loadStarCatalog } from '../engine/index.ts';

/**
 * Phase 1 evidence: prove the bundled data really loads over the network in a
 * browser, not just through the pure parsers under vitest. Replaced by the real
 * Birth Sky UI in Phase 4.
 */
async function reportDataStatus(el: HTMLElement): Promise<void> {
  try {
    const [stars, cities] = await Promise.all([loadStarCatalog(), loadCities()]);
    const brightest = stars[0];
    el.textContent =
      `Data loaded: ${stars.length.toLocaleString()} naked-eye stars ` +
      `(brightest ${brightest?.name ?? '—'}, mag ${brightest?.mag ?? '—'}) ` +
      `and ${cities.length.toLocaleString()} cities.`;
  } catch (error) {
    // Friendly failures are the point of the loaders — show the real message.
    el.textContent =
      error instanceof DataError ? error.message : `Unexpected error: ${String(error)}`;
    el.classList.add('error');
  }
}

export function mountApp(container: HTMLElement): void {
  container.innerHTML = `
    <main class="shell">
      <h1>Cosmophony</h1>
      <p class="tagline">The real sky above you, turned into calm ambient sound.</p>
      <p class="status">Phase&nbsp;1 — data layer. No mapping and no audio yet.</p>
      <p class="status" id="data-status">Loading the bundled catalogues…</p>
      <p class="honesty">
        Structure will be true — the real stars above a real place on a real date.
        Timbre, musical scale, and timing are artistic choices. This is never a
        claim about what space literally sounds like.
      </p>
    </main>
  `;

  const status = container.querySelector<HTMLElement>('#data-status');
  if (status) void reportDataStatus(status);
}
