import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vitest/config';

const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * DEV-ONLY: let the Phase 3 audio harness write a rendered clip straight into
 * `docs/`.
 *
 * `apply: 'serve'` means this never exists in a production build. It is here
 * because a browser download cannot be driven reliably from an automated click,
 * and the review gate needs a committed clip it can actually listen to.
 */
function saveClipPlugin(): Plugin {
  return {
    name: 'cosmophony-save-clip',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save-clip', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        const name = String(req.headers['x-clip-name'] ?? 'clip.wav').replace(/[^\w.-]/g, '');
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const bytes = Buffer.concat(chunks);
          const target = join(ROOT, 'docs', name);
          writeFileSync(target, bytes);
          server.config.logger.info(`[harness] wrote ${target} (${bytes.length} bytes)`);
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true, path: `docs/${name}`, bytes: bytes.length }));
        });
      });
    },
  };
}

export default defineConfig({
  // Relative asset paths, so the built site works from any GitHub Pages
  // sub-path (…/cosmophony/) without hard-coding the repo name.
  base: './',
  plugins: [saveClipPlugin()],
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
