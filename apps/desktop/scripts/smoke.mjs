/**
 * Launches the built desktop app (run `npm run build` first) in smoke-test mode and exits with its
 * result: 0 when the UI rendered without console errors. A stuck app is killed after 30 seconds.
 */
import { spawn } from 'node:child_process';
import electronPath from 'electron';

const TIMEOUT_MS = 30_000;

const env = { ...process.env, APERTURE_SMOKE_TEST: '1' };
// Electron started as plain Node would skip the app entirely.
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], { cwd: new URL('..', import.meta.url), env, stdio: 'inherit' });

const timer = setTimeout(() => {
  console.error(`Smoke test timed out after ${TIMEOUT_MS / 1000}s.`);
  child.kill();
  process.exit(1);
}, TIMEOUT_MS);

child.on('exit', (code) => {
  clearTimeout(timer);
  process.exit(code ?? 1);
});
