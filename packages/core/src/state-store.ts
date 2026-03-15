/**
 * In-memory OAuth state store with TTL.
 * Shared across services — no database needed.
 */

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface PendingState {
  customerId: string;
  redirectUri: string;
  createdAt: number;
}

const store = new Map<string, PendingState>();

function cleanup(): void {
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [key, value] of store) {
    if (value.createdAt < cutoff) {
      store.delete(key);
    }
  }
}

export function saveState(
  state: string,
  customerId: string,
  redirectUri = "",
): void {
  cleanup();
  store.set(state, { customerId, redirectUri, createdAt: Date.now() });
}

export function popState(state: string): PendingState | undefined {
  cleanup();
  const pending = store.get(state);
  if (pending) {
    store.delete(state);
  }
  return pending;
}
