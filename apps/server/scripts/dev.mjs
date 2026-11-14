/**
 * Development server: compiles with tsc in watch mode (tsc emits the decorator metadata the
 * validation and persistence libraries need) and restarts Node whenever the output changes.
 * Settings come from the repository .env file when it exists.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const cwd = new URL('..', import.meta.url);

// Build once first, so Node has output to start from.
const initial = spawnSync(process.execPath, [tsc, '-b', 'tsconfig.build.json'], { cwd, stdio: 'inherit' });
if (initial.status !== 0) process.exit(initial.status ?? 1);

const children = [
  spawn(process.execPath, [tsc, '-b', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'], { cwd, stdio: 'inherit' }),
  spawn(process.execPath, ['--watch-path=dist', '--env-file-if-exists=../../.env', 'dist/main.js'], { cwd, stdio: 'inherit' }),
];

// Stopping the dev server stops both processes.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    for (const child of children) child.kill();
    process.exit(0);
  });
}
