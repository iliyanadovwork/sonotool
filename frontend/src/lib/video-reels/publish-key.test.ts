import { describe, it, expect } from 'vitest';
import { buildPublishIdempotencyKey } from './publish-key';

describe('buildPublishIdempotencyKey', () => {
  it('is deterministic for the same entry + url', () => {
    expect(buildPublishIdempotencyKey('e1', 'https://x/v.mp4'))
      .toBe(buildPublishIdempotencyKey('e1', 'https://x/v.mp4'));
  });

  it('is caption-independent — the caption is not part of the key', () => {
    // The whole point of the fix: there is no caption input, so a caption edit
    // before a retry cannot change the key. Same entry+url → same key, always.
    const a = buildPublishIdempotencyKey('e1', 'https://x/v.mp4');
    const b = buildPublishIdempotencyKey('e1', 'https://x/v.mp4');
    expect(a).toBe(b);
  });

  it('changes when the source url changes', () => {
    expect(buildPublishIdempotencyKey('e1', 'https://x/a.mp4'))
      .not.toBe(buildPublishIdempotencyKey('e1', 'https://x/b.mp4'));
  });

  it('changes when the entry id changes', () => {
    expect(buildPublishIdempotencyKey('e1', 'https://x/v.mp4'))
      .not.toBe(buildPublishIdempotencyKey('e2', 'https://x/v.mp4'));
  });

  it('treats null/undefined/empty url identically', () => {
    const empty = buildPublishIdempotencyKey('e1', '');
    expect(buildPublishIdempotencyKey('e1', null)).toBe(empty);
    expect(buildPublishIdempotencyKey('e1', undefined)).toBe(empty);
  });

  it('produces a url-safe key namespaced by entry id', () => {
    expect(buildPublishIdempotencyKey('e1', 'https://x/v.mp4')).toMatch(/^pub_e1_[0-9a-z]+$/);
  });
});
