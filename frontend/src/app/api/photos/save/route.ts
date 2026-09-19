import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { z } from 'zod';
import { safeImageUrl, fetchImageGuarded, IMAGE_EXT_BY_TYPE } from '@/lib/remoteImage';

export const runtime = 'nodejs';

const BUCKET = 'chart-photos';

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
}

// POST { url } -> downloads the (remote) image and stores our own copy in the public
// 'chart-photos' bucket, returning { url: <permanent public URL> }. This gives reliable,
// CORS-clean access (for the chart canvas + MP4 export + the framing editor) and survives
// the source URL dying. Deduped by a hash of the source URL.
export async function POST(req: NextRequest) {
  try {
    const parsed = z.object({ url: z.string().min(1) }).safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'url required' }, { status: 400 });

    const u = safeImageUrl(parsed.data.url);
    if (!u) return NextResponse.json({ error: 'bad or disallowed url' }, { status: 400 });

    const fetched = await fetchImageGuarded(u);
    if (!fetched.ok) return NextResponse.json({ error: fetched.error }, { status: fetched.status });
    const ct = fetched.contentType;

    const ext = IMAGE_EXT_BY_TYPE[ct] ?? 'jpg';
    const buf = Buffer.from(fetched.body);

    const db = admin();
    const path = `${createHash('sha256').update(u.toString()).digest('hex').slice(0, 40)}.${ext}`;
    const { error } = await db.storage.from(BUCKET).upload(path, buf, { contentType: ct, upsert: true });
    if (error) throw new Error(error.message);

    const { data } = db.storage.from(BUCKET).getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
