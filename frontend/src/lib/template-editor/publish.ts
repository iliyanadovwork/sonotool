// ─────────────────────────────────────────────────────────────────────────────
// Publish PREP (scaffold) — turns a saved template/post into the exact payload the
// app's `POST /api/posts/instagram/publish` route expects: render every slide → PNG,
// upload each to post-images → public URL, assemble { caption, items:[{kind,url}] }.
//
// It deliberately STOPS there. It never POSTs. Live publishing goes through the app
// route, which requires the team-password unlock + a connected Instagram token (both
// bound to the browser session) — neither of which a headless CLI holds. Wiring the
// actual POST is intentionally left out so an autonomous run cannot post to Instagram.
// ─────────────────────────────────────────────────────────────────────────────

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdminClient } from './admin-client';
import { TEMPLATE_TABLES, POST_TABLES } from './slide-serde';
import { renderSlideToPng } from './render';
import { uploadImageFile } from './assets';

export interface PublishItem { kind: 'image'; url: string }
export interface PublishPayload { caption: string; items: PublishItem[] }

const MAX_ITEMS = 10;   // IG carousels cap at 10 (mirrors the route)

/** Render + upload every slide and assemble the publish payload. Does NOT post. */
export async function preparePublish(opts: {
  id: string;
  kind: 'template' | 'post';
  userId: string;
  caption?: string;
  appUrl: string;
}): Promise<PublishPayload> {
  const tables = opts.kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
  const client = createAdminClient();

  const { data, error } = await client
    .from(tables.slides).select('id, position').eq(tables.slideFk, opts.id).order('position');
  if (error) throw new Error(`fetch slides failed: ${error.message}`);
  const slideIds = ((data ?? []) as { id: string }[]).map(r => r.id);
  if (slideIds.length === 0) throw new Error(`no slides found for ${opts.kind} ${opts.id}`);
  if (slideIds.length > MAX_ITEMS) {
    throw new Error(`Instagram carousels support at most ${MAX_ITEMS} slides (this ${opts.kind} has ${slideIds.length}).`);
  }

  const items: PublishItem[] = [];
  for (let i = 0; i < slideIds.length; i++) {
    const out = join(tmpdir(), `publish-${opts.id}-${i}.png`);
    await renderSlideToPng({ slideId: slideIds[i], kind: opts.kind, appUrl: opts.appUrl, outPath: out });
    const up = await uploadImageFile(client, opts.userId, out);
    items.push({ kind: 'image', url: up.url });
  }
  return { caption: opts.caption ?? '', items };
}
