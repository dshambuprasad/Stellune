/**
 * WHERE THE BUNDLED ASSETS LIVE.
 *
 * The star catalogue and the sample set are static files served next to the
 * app. On a dev server and on a user-domain site that is the root; on a GitHub
 * *project* page it is `/<repo>/`, because that is the path Pages serves a
 * repository site from.
 *
 * Vite writes the right value into `import.meta.env.BASE_URL` at build time
 * from `--base`, so this reads it rather than hard-coding either answer. The
 * model layer already used relative paths and was fine; the sampler used
 * absolute `/samples` and would have 404'd on the deployed site — which is the
 * kind of defect that only appears after the deploy, on the URL you just sent
 * to a friend.
 */

/** The app's base path, always with a trailing slash. */
export function assetBase(): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  return base.endsWith('/') ? base : `${base}/`;
}

/** Where `manifest.json`, `lenses.json` and `calibration.json` are served from. */
export function samplesBase(): string {
  return `${assetBase()}samples`;
}
