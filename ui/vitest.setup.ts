// Node 26 ships an experimental global `localStorage` that requires
// --localstorage-file and returns undefined otherwise. Vitest's environment
// population skips keys already present on the global, so jsdom's own storage
// never reaches the tests. Install a minimal in-memory shim so components that
// persist UI state (e.g. the workflow-section collapse toggle) behave.
if (typeof globalThis.localStorage?.getItem !== "function") {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => storage,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get: () => storage,
  });
}
