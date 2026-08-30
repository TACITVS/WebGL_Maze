/**
 * Check that everything the demos load actually exists on disk.
 *
 * GitHub Pages serves this repository verbatim from a subpath, so the whole
 * class of deploy failure available to it is the broken relative path: a page
 * that loads fine locally because the file used to be there, and 404s in
 * production because it was renamed. A module graph is especially prone to it -
 * one bad import in a leaf file takes the whole page down with a blank canvas
 * and a console error nobody sees until a visitor hits it.
 *
 * So this walks both graphs from every HTML entry point: the tags a page loads,
 * and then the full transitive `import` graph of every module among them. It is
 * the same argument as the dungeon validator - assert the thing you actually
 * depend on, rather than assuming it held.
 *
 * Run with `node tools/check-links.mjs` from the repository root.
 */

import { readFile, readdir, access } from 'node:fs/promises';
import { dirname, resolve, relative, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Anything not served from this repository is somebody else's problem. */
function isExternal(spec) {
  return /^(https?:)?\/\//.test(spec) || spec.startsWith('data:')
    || spec.startsWith('mailto:') || spec.startsWith('#');
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

/** `./foo.js?v=2#frag` -> `./foo.js` */
function stripQuery(spec) {
  return spec.split('#')[0].split('?')[0];
}

const problems = [];
const checked = new Set();
const inlineModules = new Map();

/** Resolve one reference found in `fromFile`, and report it if it is missing. */
async function checkRef(fromFile, spec, kind) {
  const clean = stripQuery(spec);
  if (!clean || isExternal(clean)) return null;
  if (clean.startsWith('/')) {
    // Pages serves the site from /WebGL_Maze/, so a root-absolute path resolves
    // to the user site root and misses everything in this repository.
    problems.push(`${relative(ROOT, fromFile)}: root-absolute ${kind} "${spec}" breaks under the Pages subpath`);
    return null;
  }
  const target = resolve(dirname(fromFile), clean);
  if (!await exists(target)) {
    problems.push(`${relative(ROOT, fromFile)}: ${kind} "${spec}" -> missing ${relative(ROOT, target)}`);
    return null;
  }
  return target;
}

/**
 * Every module specifier in a chunk of JavaScript.
 *
 * These match the specifier itself rather than the statement around it. An
 * earlier version matched `import ...lazily... from '<spec>'`, which let one
 * match swallow several statements and silently skip their imports.
 */
function collectSpecs(source) {
  const specs = [];
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,                  // import/export ... from 'x'
    /\bimport\s*['"]([^'"]+)['"]/g,                // import 'x'
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,     // import('x')
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(source)) !== null) specs.push(m[1]);
  }
  return specs;
}

/** Resolve a module's imports and follow each one. */
async function walkSpecs(fromFile, specs) {
  for (const spec of specs) {
    if (isExternal(spec)) continue;
    if (!spec.startsWith('.') && !spec.startsWith('/')) {
      // A bare specifier needs an import map or a bundler; there is neither here.
      problems.push(`${relative(ROOT, fromFile)}: bare import "${spec}" will not resolve in a browser`);
      continue;
    }
    const target = await checkRef(fromFile, spec, 'import');
    if (target) await walkModule(target);
  }
}

/** Follow every static import out of a module, transitively. */
async function walkModule(file) {
  if (checked.has(file)) return;
  checked.add(file);
  await walkSpecs(file, collectSpecs(await readFile(file, 'utf8')));
}

/** Check the tags an HTML page loads, then walk any modules among them. */
async function walkHtml(file) {
  const source = await readFile(file, 'utf8');
  const refs = [];
  const attr = /(?:src|href)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = attr.exec(source)) !== null) refs.push(m[1]);

  for (const spec of refs) {
    const clean = stripQuery(spec);
    if (!clean || isExternal(clean)) continue;
    const target = await checkRef(file, spec, 'reference');
    if (target && ['.js', '.mjs'].includes(extname(target))) await walkModule(target);
  }

  // Every page here bootstraps from an inline <script type="module"> rather
  // than a src= attribute, so scanning tags alone walked none of the game.
  const inline = /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*>([\s\S]*?)<\/script>/gi;
  let block;
  let found = 0;
  while ((block = inline.exec(source)) !== null) {
    found += 1;
    await walkSpecs(file, collectSpecs(block[1]));
  }
  inlineModules.set(relative(ROOT, file), found);
}

const entries = (await readdir(ROOT)).filter((name) => name.endsWith('.html'));
if (!entries.length) {
  console.error('no HTML entry points found - is this the repository root?');
  process.exit(1);
}

for (const name of entries) await walkHtml(join(ROOT, name));

// An index is what a visitor lands on; without one Pages serves a 404.
if (!entries.includes('index.html')) problems.push('no index.html at the repository root');

for (const name of entries.sort()) {
  console.log(`  ${name}: ${inlineModules.get(name) || 0} inline module block(s)`);
}
console.log(`checked ${entries.length} pages and ${checked.size} modules`);

if (problems.length) {
  console.error(`\n${problems.length} broken reference${problems.length === 1 ? '' : 's'}:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('all references resolve');
