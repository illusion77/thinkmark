import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');
const test = process.argv.includes('--test');

const common = { bundle: true, sourcemap: !production, minify: production, logLevel: 'info' };

const builds = test
  ? [{
      ...common,
      entryPoints: readdirSync('test').filter(f => f.endsWith('.test.ts')).map(f => `test/${f}`),
      outdir: 'out/test',
      platform: 'node',
      format: 'cjs',
      target: 'node18',
    }]
  : [
      { ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', platform: 'node', format: 'cjs', target: 'node18', external: ['vscode'] },
      { ...common, entryPoints: ['src/webview/main.ts'], outfile: 'media/webview.js', platform: 'browser', format: 'iife', target: 'chrome110' },
    ];

// Spell checking: the dictionary (Hunspell en-US) is read by the extension at run time, nspell is
// bundled into extension.js. Their licenses go into the package with them.
if (!test) {
  mkdirSync('dist/dict', { recursive: true });
  copyFileSync('node_modules/dictionary-en/index.aff', 'dist/dict/en.aff');
  copyFileSync('node_modules/dictionary-en/index.dic', 'dist/dict/en.dic');
  const licenses = [['nspell', 'license'], ['is-buffer', 'LICENSE'], ['dictionary-en', 'license']].map(
    ([pkg, file]) => `${pkg}\n${'='.repeat(pkg.length)}\n\n${readFileSync(`node_modules/${pkg}/${file}`, 'utf8').trim()}\n`,
  );
  writeFileSync('dist/THIRD-PARTY-LICENSES.txt', licenses.join('\n\n'));
}

if (watch) {
  for (const b of builds) (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map(b => esbuild.build(b)));
}
