import type { Pack } from './types';

declare global {
  // eslint-disable-next-line no-var
  var __packsStore: Map<string, Pack> | undefined;
}

/** In-memory store shared across hot-reloads in dev. */
export function getStore(): Map<string, Pack> {
  if (!global.__packsStore) {
    global.__packsStore = new Map<string, Pack>();
  }
  return global.__packsStore;
}

export function getPack(id: string): Pack | undefined {
  return getStore().get(id);
}

export function setPack(pack: Pack): void {
  getStore().set(pack.id, pack);
}

export function listPacks(): Pack[] {
  return Array.from(getStore().values()).sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}
