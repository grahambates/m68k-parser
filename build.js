#!/usr/bin/env node
import * as esbuild from 'esbuild';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

const sharedConfig = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  sourcemap: true,
  external: [], // No external dependencies to bundle
  platform: 'neutral', // Works in both Node and browser
};

// ESM build
await esbuild.build({
  ...sharedConfig,
  format: 'esm',
  outfile: 'dist/index.mjs',
});

// CJS build
await esbuild.build({
  ...sharedConfig,
  format: 'cjs',
  outfile: 'dist/index.cjs',
});

console.log('✓ Build complete');
