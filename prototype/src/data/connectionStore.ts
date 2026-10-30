import { create } from 'zustand';
import type { ConnectionInfo } from '../domain/types';

export const INITIAL_CONNECTION: ConnectionInfo = Object.freeze({
  state: 'disconnected',
  feedName: 'Simulated feed',
  simulated: true,
  lastMessageAt: null,
  reconnectAttempt: 0,
  nextRetryAt: null,
  error: null,
});

export interface ConnectionStoreState {
  connection: ConnectionInfo;
  setConnection(info: ConnectionInfo): void;
}

export const useConnectionStore = create<ConnectionStoreState>()((set) => ({
  connection: INITIAL_CONNECTION,
  setConnection(info) {
    set({ connection: info });
  },
}));

/** Current connection info. */
export function useConnection(): ConnectionInfo {
  return useConnectionStore((state) => state.connection);
}
