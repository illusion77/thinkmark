import * as esbuild from 'esbuild';
import { readdirSync } from 'node:fs';

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

if (watch) {
  for (const b of builds) (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map(b => esbuild.build(b)));
}
