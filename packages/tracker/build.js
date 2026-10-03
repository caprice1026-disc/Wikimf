import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const source = await readFile(new URL('./tracker.js', import.meta.url), 'utf8');
const output = `(function(){'use strict';\n${source.replace(/^export /gm, '')}\n globalThis.WikiMfTracker={POLICY,WIKIS,articleLocation,codepointCount,chunkSizes,extractDocument,fingerprint,visibleRatio,inferState,ReadingSession,DOMTracker};\n})();\n`;
await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
await writeFile(new URL('./dist/wiki-tracker.js', import.meta.url), output);
const adapter = await readFile(new URL('./android-adapter.js', import.meta.url), 'utf8');
await writeFile(new URL('./dist/android-tracker.js', import.meta.url), output + adapter);
console.log(fileURLToPath(new URL('./dist/wiki-tracker.js', import.meta.url)));
