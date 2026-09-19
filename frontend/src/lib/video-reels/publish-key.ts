// Deterministic idempotency key for an Instagram publish.
//
// Derived from the entry id + source URL ONLY — deliberately NOT the caption.
// Including the caption meant that editing it before a retry produced a NEW key,
// so the server's exactly-once guard couldn't recognise the retry and could post
// a duplicate Reel. Entry id + url is stable across caption edits, which is
// exactly what dedup needs. djb2 keeps the key short and bounded.
export function buildPublishIdempotencyKey(entryId: string, url: string | null | undefined): string {
  const basis = `${entryId}|${url || ''}`;
  let hash = 5381;
  for (let i = 0; i < basis.length; i++) {
    hash = ((hash << 5) + hash + basis.charCodeAt(i)) | 0;
  }
  return `pub_${entryId}_${(hash >>> 0).toString(36)}`;
}
