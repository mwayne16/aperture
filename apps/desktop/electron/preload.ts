import { contextBridge } from 'electron';
import type { DesktopBridge } from './bridge';

// Runs sandboxed with context isolation: the renderer sees only this plain object, never Node or Electron.
const bridge: DesktopBridge = {
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
};

contextBridge.exposeInMainWorld('aperture', bridge);
