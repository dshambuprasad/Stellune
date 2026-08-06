/**
 * The dependency rule, enforced.
 *
 *   model    → depends on nothing
 *   mapping  → depends only on model      (NO Tone, NO DOM, NO Web Audio, NO clock)
 *   audio    → depends on model + mapping + Tone.js
 *
 * Nothing flows upward. `mapping` reaching for Tone or the DOM is a build
 * failure, not a code-review note — that layer is the deterministic heart of the
 * project and the only reason it can be unit-tested at all.
 *
 * This is a source-text scan, not a real module-graph analysis. It catches the
 * mistakes people actually make (an import statement, a `window.`/`Tone.` call);
 * it does not catch clever indirection. Good enough, and honest about its reach.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...tsFilesUnder(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Module specifiers in `import`/`export … from '…'` statements. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const pattern = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1]) specs.push(match[1]);
  }
  // Bare side-effect imports: import './style.css'
  for (const match of source.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)) {
    if (match[1]) specs.push(match[1]);
  }
  return specs;
}

/**
 * Reduce a source file to its CODE, dropping comments and string contents.
 *
 * Both are prose, and the forbidden-token scan below is about what the code
 * *does*. Without this, a doc-comment explaining "Tone.js belongs in the audio
 * layer" or an error message that legitimately says "window bounds must be
 * finite" would trip the guard — and the fix would be to contort the writing,
 * which is the wrong direction.
 *
 * Template-literal `${...}` expressions ARE kept: those are real code and could
 * genuinely reach for the DOM.
 */
function codeOnly(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i] as string;
    const next = source[i + 1];

    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end < 0 ? n : end;
      continue;
    }
    if (ch === "'" || ch === '"') {
      i++;
      while (i < n && source[i] !== ch) i += source[i] === '\\' ? 2 : 1;
      i++;
      out += '""';
      continue;
    }
    if (ch === '`') {
      i++;
      while (i < n && source[i] !== '`') {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        // Keep interpolated expressions — they are code.
        if (source[i] === '$' && source[i + 1] === '{') {
          let depth = 1;
          i += 2;
          const start = i;
          while (i < n && depth > 0) {
            if (source[i] === '{') depth++;
            else if (source[i] === '}') depth--;
            if (depth > 0) i++;
          }
          out += ` ${source.slice(start, i)} `;
          i++;
          continue;
        }
        i++;
      }
      i++;
      out += '``';
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function relative(file: string): string {
  return file.slice(SRC.length + 1);
}

describe('engine/model — depends on nothing', () => {
  const files = tsFilesUnder(join(SRC, 'engine', 'model'));

  it('has files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s imports only from within model/', (file) => {
    for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
      expect(
        spec.startsWith('./'),
        `${relative(file)} imports "${spec}" — the model layer must depend on nothing`,
      ).toBe(true);
    }
  });
});

describe('engine/mapping — depends only on model', () => {
  const files = tsFilesUnder(join(SRC, 'engine', 'mapping'));

  it('has files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s imports only model/ or its own siblings', (file) => {
    for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
      const allowed = spec.startsWith('./') || spec.startsWith('../model/');
      expect(
        allowed,
        `${relative(file)} imports "${spec}" — mapping may import ONLY from ../model`,
      ).toBe(true);
    }
  });

  it.each(files)('%s never reaches for Tone, the DOM, or the clock', (file) => {
    const code = codeOnly(readFileSync(file, 'utf8'));
    const forbidden: Array<[RegExp, string]> = [
      [/\bTone\b/, 'Tone.js belongs in engine/audio only'],
      [/\bdocument\b/, 'the DOM is forbidden in the mapping layer'],
      [/\bwindow\b/, 'the DOM is forbidden in the mapping layer'],
      [/\bAudioContext\b/, 'Web Audio belongs in engine/audio only'],
      [/\bMath\s*\.\s*random\b/, 'randomness must be seeded from config.seed'],
      [/\bDate\s*\.\s*now\b/, 'reading the clock breaks determinism'],
      [/\bnew\s+Date\s*\(\s*\)/, 'reading the clock breaks determinism'],
    ];
    for (const [pattern, why] of forbidden) {
      expect(pattern.test(code), `${relative(file)}: ${why}`).toBe(false);
    }
  });
});

describe('engine/audio — the only Tone.js consumer', () => {
  it('no layer above audio imports Tone directly', () => {
    const outside = tsFilesUnder(SRC).filter(
      (f) => !relative(f).startsWith('engine/audio'),
    );
    for (const file of outside) {
      for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
        expect(
          spec === 'tone' || spec.startsWith('tone/'),
          `${relative(file)} imports Tone directly — only engine/audio may`,
        ).toBe(false);
      }
    }
  });
});

describe('engine — nothing flows upward', () => {
  it('no engine file imports from instruments/ or app/', () => {
    for (const file of tsFilesUnder(join(SRC, 'engine'))) {
      for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
        expect(
          /(^|\/)(instruments|app)\//.test(spec),
          `${relative(file)} imports "${spec}" — the engine must not know about its consumers`,
        ).toBe(false);
      }
    }
  });
});
