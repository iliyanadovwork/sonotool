import { NextRequest, NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { getIgUserId } from '@/lib/video-reels/meta-token-storage';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    // Require a connected session — without this, anyone could delete any blob
    // in the project by guessing/observing a public blob URL (data loss).
    const igUserId = await getIgUserId();
    if (!igUserId) {
      return NextResponse.json(
        { error: 'Not connected. Please connect your account first.' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      );
    }

    // Only allow deleting our own Vercel Blob objects, never arbitrary URLs.
    let urlObj: URL;
    try {
      urlObj = new URL(url);
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }
    if (!urlObj.hostname.endsWith('.blob.vercel-storage.com')) {
      return NextResponse.json({ error: 'URL is not a Vercel Blob object' }, { status: 400 });
    }

    console.log('[Blob Delete] Deleting blob:', url);

    // Extract the key from the URL
    // URL format: https://[bucket].public.blob.vercel-storage.com/[key]
    const key = urlObj.pathname.slice(1); // Remove leading slash

    // Delete the blob
    await del(key);

    console.log('[Blob Delete] ✅ Successfully deleted:', key);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '';
    console.error('[Blob Delete] Error:', message || error);

    return NextResponse.json(
      { error: message || 'Failed to delete blob' },
      { status: 500 }
    );
  }
}
