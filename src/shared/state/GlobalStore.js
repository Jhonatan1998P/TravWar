import { createStore } from 'zustand/vanilla';

const initialState = {
  currentRoute: '/config',
  appReady: false,
  gameInitialized: false,
  sessionId: null,
  lastError: null
};

const appStore = createStore((set) => ({
  ...initialState,
  setCurrentRoute: (currentRoute) => set({ currentRoute }),
  setAppReady: (appReady) => set({ appReady }),
  setGameInitialized: (gameInitialized) => set({ gameInitialized }),
  setSessionId: (sessionId) => set({ sessionId }),
  setLastError: (lastError) => set({ lastError }),
  reset: () => set(initialState)
}));

export default appStore;
