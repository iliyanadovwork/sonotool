// Additive merge of two Instagram account blobs ({accounts, activeIndex}). Used
// so a NON-authoritative (mount) backup can only ADD or refresh accounts in the
// team-shared store, never silently drop a teammate's account because this
// browser's cookie was stale. Destructive removal is reserved for an explicit
// (authoritative) disconnect, which replaces/deletes instead of merging.

export interface IgAccount {
  igUserId?: string;
  userAccessToken?: string;
  expiresAt?: number;
  [k: string]: unknown;
}
export interface IgBlob {
  accounts: IgAccount[];
  activeIndex: number;
}

// Identity of an account: its IG user id once known, else the access token (a
// just-connected account has no igUserId until /me runs).
function keyOf(acc: IgAccount | undefined): string {
  if (!acc) return '';
  return (typeof acc.igUserId === 'string' && acc.igUserId) ||
    (typeof acc.userAccessToken === 'string' && acc.userAccessToken) || '';
}

/**
 * Union of `shared` and `local` by account identity. On a collision the entry
 * with the later expiresAt wins (fresher token); ties go to `local`. The active
 * account prefers local's selection, then shared's, then the first entry.
 */
export function mergeIgBlobs(shared: IgBlob | null | undefined, local: IgBlob | null | undefined): IgBlob {
  const byKey = new Map<string, IgAccount>();
  const addAll = (blob: IgBlob | null | undefined) => {
    for (const acc of blob?.accounts ?? []) {
      const k = keyOf(acc);
      if (!k) continue;
      const existing = byKey.get(k);
      if (!existing || (Number(acc.expiresAt) || 0) >= (Number(existing.expiresAt) || 0)) {
        byKey.set(k, acc);
      }
    }
  };
  addAll(shared);
  addAll(local); // local wins ties → picks up a just-refreshed token

  const accounts = [...byKey.values()];
  const localActiveKey = keyOf(local?.accounts?.[local?.activeIndex ?? -1]);
  const sharedActiveKey = keyOf(shared?.accounts?.[shared?.activeIndex ?? -1]);
  const activeKey = localActiveKey || sharedActiveKey;
  let activeIndex = activeKey ? accounts.findIndex((a) => keyOf(a) === activeKey) : 0;
  if (activeIndex < 0) activeIndex = 0;
  return { accounts, activeIndex };
}
