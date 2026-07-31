import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';

// 1. bake the colour-name table into a module (only names we can actually reach in sRGB)
const raw = JSON.parse(readFileSync('node_modules/color-name-list/dist/colornames.bestof.min.json', 'utf8'));
writeFileSync('src/names.gen.js', `export const NAMES = ${JSON.stringify(raw)};\n`);
console.log(`names: ${Object.keys(raw).length}`);

mkdirSync('docs', { recursive: true });

const res = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2022'],
  outfile: 'docs/app.js',
  metafile: true,
  legalComments: 'none',
});

for (const f of ['index.html', 'style.css']) cpSync(`src/${f}`, `docs/${f}`);
if (existsSync('src/og.png')) cpSync('src/og.png', 'docs/og.png');
writeFileSync('docs/.nojekyll', '');

const out = res.metafile.outputs['docs/app.js'];
console.log(`bundle: ${(out.bytes / 1024).toFixed(1)} KB`);
