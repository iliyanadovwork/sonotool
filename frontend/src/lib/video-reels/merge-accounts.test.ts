import { describe, it, expect } from 'vitest';
import { mergeIgBlobs } from './merge-accounts';

const acc = (id: string, exp = 100, token = `t_${id}`) => ({ igUserId: id, userAccessToken: token, expiresAt: exp });

describe('mergeIgBlobs', () => {
  it('unions accounts from both sides (never drops a teammate\'s)', () => {
    const shared = { accounts: [acc('A'), acc('B')], activeIndex: 0 };
    const local = { accounts: [acc('C')], activeIndex: 0 };
    const r = mergeIgBlobs(shared, local);
    expect(r.accounts.map((a) => a.igUserId).sort()).toEqual(['A', 'B', 'C']);
  });

  it('keeps the fresher token on a collision (later expiresAt wins)', () => {
    const shared = { accounts: [acc('A', 100, 'old')], activeIndex: 0 };
    const local = { accounts: [acc('A', 200, 'new')], activeIndex: 0 };
    const r = mergeIgBlobs(shared, local);
    expect(r.accounts).toHaveLength(1);
    expect(r.accounts[0].userAccessToken).toBe('new');
  });

  it('local wins on an expiresAt tie', () => {
    const r = mergeIgBlobs({ accounts: [acc('A', 100, 'shared')], activeIndex: 0 }, { accounts: [acc('A', 100, 'local')], activeIndex: 0 });
    expect(r.accounts[0].userAccessToken).toBe('local');
  });

  it('a stale local (missing B) can only ADD, never remove B', () => {
    const shared = { accounts: [acc('A'), acc('B')], activeIndex: 1 };
    const local = { accounts: [acc('A')], activeIndex: 0 }; // stale: no B
    const r = mergeIgBlobs(shared, local);
    expect(r.accounts.map((a) => a.igUserId).sort()).toEqual(['A', 'B']); // B survives
  });

  it('identifies a just-connected (no igUserId) account by its token', () => {
    const shared = { accounts: [acc('A')], activeIndex: 0 };
    const local = { accounts: [acc('A'), { userAccessToken: 'fresh', expiresAt: 50 }], activeIndex: 1 };
    const r = mergeIgBlobs(shared, local);
    expect(r.accounts).toHaveLength(2);
    expect(r.accounts.some((a) => a.userAccessToken === 'fresh')).toBe(true);
  });

  it('active index prefers local selection, then shared, then 0', () => {
    const shared = { accounts: [acc('A'), acc('B')], activeIndex: 0 };
    const local = { accounts: [acc('B'), acc('C')], activeIndex: 1 }; // local active = C
    const r = mergeIgBlobs(shared, local);
    expect(r.accounts[r.activeIndex].igUserId).toBe('C');
  });

  it('tolerates null/empty inputs', () => {
    expect(mergeIgBlobs(null, null)).toEqual({ accounts: [], activeIndex: 0 });
    expect(mergeIgBlobs(null, { accounts: [acc('A')], activeIndex: 0 }).accounts).toHaveLength(1);
    expect(mergeIgBlobs({ accounts: [acc('A')], activeIndex: 0 }, null).accounts).toHaveLength(1);
  });
});
