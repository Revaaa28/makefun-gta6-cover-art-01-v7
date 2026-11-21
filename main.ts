// VICEPRINT — Palm Heat Cover Studio: the make.fun entry point.
//
// Copies the static app and its screenshots into the output directory and
// writes the dossier the scorer grades, built by the bounty's own library
// (vendor/makefun-app.ts) from exactly what was copied.
import { cpSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from './vendor/makefun-app.ts';

const root = new URL('.', import.meta.url).pathname;
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const DOSSIER_MAX_BYTES = 1_572_864;
// The grader caps the whole output tree at 1000 entries, dossier included.
const OUTPUT_MAX_ENTRIES = 1000;

function countEntries(dir: string): number {
  let n = 0;
  for (const entry of readdirSync(dir)) {
    n += 1;
    if (statSync(join(dir, entry)).isDirectory()) n += countEntries(join(dir, entry));
  }
  return n;
}

// The output directory itself is mounted by the grader, so it must survive:
// create it when missing and clear only what is inside it, never the dir.
mkdirSync(outDir, { recursive: true });
for (const entry of readdirSync(outDir)) {
  rmSync(join(outDir, entry), { recursive: true, force: true });
}

cpSync(join(root, 'app'), join(outDir, 'app'), { recursive: true });
cpSync(join(root, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });

const entries = countEntries(outDir) + 1; // +1 for the dossier written below
if (entries > OUTPUT_MAX_ENTRIES) {
  throw new Error(`output would hold ${entries} entries, over the ${OUTPUT_MAX_ENTRIES} allowed`);
}

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 50331648,
});
if (dossier.byteLength > DOSSIER_MAX_BYTES) {
  throw new Error(
    `dossier.json would be ${dossier.byteLength} bytes, over the ${DOSSIER_MAX_BYTES} allowed`,
  );
}
writeFileSync(join(outDir, 'dossier.json'), dossier);
console.log(`VICEPRINT: dossier.json (${dossier.byteLength} bytes) written to ${outDir}`);
