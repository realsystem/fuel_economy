// Build (or serve) the app with esbuild.
//   node build.mjs          → production build in dist/
//   node build.mjs --serve  → dev server with live rebuild on http://localhost:5173
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const serve = process.argv.includes('--serve');
const outdir = 'dist';

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
cpSync('public', outdir, { recursive: true });

const options = {
  entryPoints: {
    app: 'src/main.tsx',
    worker: 'src/workers/imageProcessor.worker.ts',
  },
  outdir,
  bundle: true,
  format: 'esm',
  target: ['es2022', 'safari16'],
  minify: !serve,
  sourcemap: serve ? 'inline' : false,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': JSON.stringify(serve ? 'development' : 'production') },
  logLevel: 'info',
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: outdir, port: 5173 });
  console.log(`Fuel Photo Log running at http://localhost:${port}`);
} else {
  await esbuild.build(options);
}
