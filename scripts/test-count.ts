/**
 * Single source of truth for test/eval counts (README + CI read from here).
 * Counts `it(` blocks in backend jest suites, vitest suites, and eval cases.
 * CI fails if README.md doesn't contain the computed numbers — count drift
 * (the old 80 vs 74 embarrassment) becomes impossible.
 *
 *   npx tsx scripts/test-count.ts            # print counts
 *   npx tsx scripts/test-count.ts --check    # assert README matches
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function files(dir: string, ext: string[], out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === 'node_modules' || e === 'dist') continue;
      files(p, ext, out);
    } else if (ext.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

function countIts(paths: string[]): number {
  let n = 0;
  for (const p of paths) {
    const src = readFileSync(p, 'utf8');
    // Strip line comments so commented-out tests never inflate the count.
    const code = src.replace(/^\s*\/\/.*$/gm, '');
    const m = code.match(/(?<![\w$.])it\s*\(/g);
    if (m) n += m.length;
  }
  return n;
}

const root = join(__dirname, '..');
const backendFiles = [
  ...files(join(root, 'test'), ['.ts']),
  ...files(join(root, 'src'), ['.spec.ts']),
];
const frontendFiles = files(join(root, 'frontend', 'src'), ['.test.ts', '.test.tsx']);
const backend = countIts(backendFiles.filter((f) => !f.endsWith('.d.ts')));
const frontend = countIts(frontendFiles);

const evalSrc = readFileSync(join(root, 'scripts', 'eval-ai.ts'), 'utf8');
const evals = (evalSrc.match(/run:\s*async/g) || []).length;

console.log(JSON.stringify({ backend, frontend, evals, total: backend + frontend }));

if (process.argv.includes('--check')) {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const problems: string[] = [];
  if (!new RegExp(`${backend}[^\\n]*tests?`).test(readme)) {
    problems.push(`README lacks the backend count (${backend})`);
  }
  if (!readme.includes(`${frontend} frontend`)) {
    problems.push(`README lacks the frontend count (${frontend})`);
  }
  if (!new RegExp(`${evals}[^\\n]*eval`, 'i').test(readme)) {
    problems.push(`README lacks the eval count (${evals})`);
  }
  if (problems.length > 0) {
    console.error('test-count --check FAILED:\n- ' + problems.join('\n- '));
    console.error('Run: npx tsx scripts/test-count.ts, then sync README.md.');
    process.exit(1);
  }
  console.log('test-count --check passed.');
}
