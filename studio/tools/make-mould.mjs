#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Ring press mould (offline wrapper)
// ---------------------------------------------------------------------------

/**
 * Writes the same mould the site exports, without opening the browser.
 *
 * The geometry lives in site/lib/mould.js so the browser worker and this
 * wrapper cannot drift apart. Edit the constants below, run the file, slice
 * the STL.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildMould } from '../site/lib/mould.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// --- constants -------------------------------------------------------------

const INPUT = resolve(HERE, '../generated/landscape-data.json');
const OUTPUT = resolve(HERE, '../generated/mould-tpu.stl');

const SCALE = 0.4; // 0.4 for a test press, 1 for the full-size mould
const RELIEF_MM = 14; // peak height above the object's base
const MAX_SLOPE_DEG = 60; // relief slope cap

const MARGIN_OUT_MM = 15; // rim outside the outer wall
const MARGIN_IN_MM = 8; // rim inside the inner wall
const END_MARGIN_DEG = 6; // rim beyond each arc end
const BACK_MM = 5; // material under the deepest cavity

// ---------------------------------------------------------------------------

const data = JSON.parse(readFileSync(INPUT, 'utf8'));

const result = buildMould(data, {
  scale: SCALE,
  relief: RELIEF_MM,
  slope: MAX_SLOPE_DEG,
  back: BACK_MM,
  marginOut: MARGIN_OUT_MM,
  marginIn: MARGIN_IN_MM,
  endMargin: END_MARGIN_DEG,
});

writeFileSync(OUTPUT, Buffer.from(result.stlBytes));

const { width, depth, height } = result.bounds;
console.log(
  `${OUTPUT}: ${result.triangles} triangles, ` +
  `${width.toFixed(1)} x ${depth.toFixed(1)} x ${height.toFixed(1)} mm ` +
  `at scale ${SCALE}`
);
