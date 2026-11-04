import { defineConfig } from 'vite';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

/** Every file under public/, as paths relative to it (they end up next to index.html). */
function publicFiles(dir = 'public') {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split('\\').join('/'));
    }
  };
  try {
    walk(dir);
  } catch {
    /* no public folder */
  }
  return out;
}

/**
 * Offline support without extra packages: at build time, write dist/sw.js with the list of every
 * built file (hashed names change on each build, so the cache name changes too). See src/sw-template.js.
 */
function offline() {
  return {
    name: 'vfw-offline',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = ['./', ...Object.keys(bundle), ...publicFiles()].filter((f) => f !== 'sw.js');
      const template = readFileSync('src/sw-template.js', 'utf8');
      const version = createHash('sha1').update(files.join('|') + template).digest('hex').slice(0, 10);
      const source = template.replace('__VERSION__', version).replace('__FILES__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: './', // relative URLs, so dist/ works from any folder (e.g. GitHub Pages)
  plugins: [offline()],
});
