import { NextRequest, NextResponse } from 'next/server';
import { getGoogleToken, googleFetch, GoogleAuthError } from '@/lib/video-reels/google-token-storage';
import { isAbortError } from '@/lib/video-reels/fetch-timeout';
import { extractCaptionFromFrames } from '@/lib/video-reels/caption-extraction';
import { isLockedCaptionCell, prependCaption } from '@/lib/video-reels/caption-cell';
import { writeFile, readFile, unlink } from 'fs/promises';
import path from 'path';
import os from 'os';

export const runtime = 'nodejs';
// Per row: video download + ffmpeg frame grabs + a Gemini vision call — give
// the whole chain generous headroom.
export const maxDuration = 90;

// What /api/video-reels/download returns (fields it may omit are optional; on a
// failure it carries `error`/`detail` instead of the media URLs).
interface DownloadResult {
  title?: string;
  hdplay?: string;
  play?: string;
  wmplay?: string;
  error?: string;
  detail?: string;
}

// Grab a single frame (720px wide, JPEG) at `seconds` into the video.
// Resolves false instead of rejecting so a too-short video just yields fewer frames.
async function extractFrameAt(inputPath: string, outPath: string, seconds: number): Promise<boolean> {
  const ffmpegPath = (await import('@ffmpeg-installer/ffmpeg')).default.path;
  const ffmpeg = (await import('fluent-ffmpeg')).default;
  ffmpeg.setFfmpegPath(ffmpegPath);
  return new Promise((resolve) => {
    ffmpeg(inputPath)
      .seekInput(seconds)
      .frames(1)
      .size('720x?')
      .outputOptions(['-q:v 4'])
      .output(outPath)
      .on('end', () => resolve(true))
      .on('error', () => resolve(false))
      .run();
  });
}

// Sheet-driven variant of caption extraction, mirroring generate-caption's
// contract. For one row:
//   1. Reads the video URL (column A), existing title (B) and topic (F)
//   2. Resolves the source video via /api/video-reels/download — its `title`
//      is the source post's description → written to F (the AI-caption topic)
//   3. Downloads the video, grabs two frames (ffmpeg), asks Gemini vision for
//      the creator's overlay caption verbatim → written to B
// Never overwrites non-empty cells; returns skipped when there's nothing to do.
export async function POST(request: NextRequest) {
  const tokenData = await getGoogleToken();
  if (!tokenData) {
    return NextResponse.json(
      { error: 'Not connected to Google. Please connect your account first.' },
      { status: 401 }
    );
  }

  const tmpFiles: string[] = [];
  try {
    const body = await request.json();
    const { spreadsheetId, sheetName, rowNumber } = body;
    // Which cells to fill: 'title' = column B only, 'prompt' = column F only,
    // 'both' (default) = the original combined behaviour. Prompt-only skips the
    // video download + ffmpeg + vision entirely, so it's far cheaper/faster.
    const mode: 'both' | 'title' | 'prompt' =
      body.mode === 'title' || body.mode === 'prompt' ? body.mode : 'both';
    if (!spreadsheetId || !sheetName || rowNumber === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: spreadsheetId, sheetName, rowNumber' },
        { status: 400 }
      );
    }

    // 1. Read A (url), B (title/overlay caption), F (topic) in one call.
    const readRange = `${encodeURIComponent(sheetName)}!A${rowNumber}:F${rowNumber}`;
    const readRes = await googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${readRange}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!readRes.ok) {
      const errorText = await readRes.text();
      console.error('[Extract Title/Prompt] Failed to read row:', errorText);
      return NextResponse.json({ error: `Failed to read sheet: ${readRes.statusText}` }, { status: readRes.status });
    }
    const readData = await readRes.json();
    const cols: string[] = readData.values?.[0] ?? [];
    const url = (cols[0] ?? '').trim();       // column A
    const existingTitle = (cols[1] ?? '').trim(); // column B
    const existingTopic = (cols[5] ?? '').trim(); // column F

    if (!url) {
      return NextResponse.json({ skipped: true, reason: 'no-url', rowNumber });
    }
    // Column B is prepended to rather than replaced, so an existing title no
    // longer blocks extraction — only a {…} lock does. Column F keeps its
    // fill-if-empty behaviour.
    const titleLocked = isLockedCaptionCell(existingTitle);
    const needTitle = !titleLocked && mode !== 'prompt';
    const needTopic = !existingTopic && mode !== 'title';
    if (!needTitle && !needTopic) {
      return NextResponse.json({
        skipped: true,
        reason: titleLocked && mode !== 'prompt' ? 'locked' : 'exists',
        mode,
        rowNumber,
      });
    }

    // 2. Resolve the source video (same backend the grid fetch uses). Its
    // `title` carries the post description for both TikTok and Instagram.
    const dlRes = await fetch(new URL('/api/video-reels/download', request.nextUrl.origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const dlData: DownloadResult = await dlRes.json().catch(() => ({}));
    if (!dlRes.ok) {
      // Include the download route's per-backend detail (which scraper failed and
      // how) + its HTTP status, so the bulk run's log can tell rate-limit/outage
      // apart from a genuinely private post.
      const detail = typeof dlData?.detail === 'string' && dlData.detail ? ` [${dlData.detail}]` : '';
      return NextResponse.json(
        { error: `Video fetch failed (${dlRes.status}): ${dlData?.error || dlRes.statusText}${detail}` },
        { status: 502 }
      );
    }

    const writeCell = async (col: 'B' | 'F', value: string) => {
      const range = `${encodeURIComponent(sheetName)}!${col}${rowNumber}`;
      const res = await googleFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [[value]] }),
        }
      );
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to write column ${col}: ${res.statusText} — ${errorText.slice(0, 200)}`);
      }
    };

    // 3. Description → column F (prompt/topic).
    const description = (dlData?.title ?? '').trim();
    let wroteTopic = false;
    if (needTopic && description) {
      await writeCell('F', description);
      wroteTopic = true;
    }

    // 4. Overlay caption → column B (title), via frames + Gemini vision.
    let caption: string | null = null;
    let wroteTitle = false;
    let keyUsed: number | undefined;
    if (needTitle) {
      const playUrl = dlData?.hdplay || dlData?.play || dlData?.wmplay;
      if (typeof playUrl !== 'string' || !/^https?:\/\//i.test(playUrl)) {
        return NextResponse.json({ error: 'Downloader returned no playable video URL' }, { status: 502 });
      }

      const videoRes = await fetch(playUrl);
      if (!videoRes.ok) {
        return NextResponse.json({ error: `Video download failed (${videoRes.status})` }, { status: 502 });
      }
      const videoBuf = Buffer.from(await videoRes.arrayBuffer());
      if (videoBuf.length === 0 || videoBuf.length > 200 * 1024 * 1024) {
        return NextResponse.json({ error: `Video body invalid (${videoBuf.length} bytes)` }, { status: 502 });
      }

      const stamp = `${rowNumber}-${Date.now()}`;
      const videoPath = path.join(os.tmpdir(), `reel-${stamp}.mp4`);
      tmpFiles.push(videoPath);
      await writeFile(videoPath, videoBuf);

      // Two frames (early + a few seconds in): the static creator overlay is in
      // both, burned-in speech subtitles differ — that contrast drives the
      // model's exclusion logic. Short videos just yield one frame.
      const b64Frames: string[] = [];
      for (const [idx, seconds] of [[0, 1], [1, 4]] as Array<[number, number]>) {
        const framePath = path.join(os.tmpdir(), `reel-${stamp}-f${idx}.jpg`);
        tmpFiles.push(framePath);
        const okFrame = await extractFrameAt(videoPath, framePath, seconds);
        if (okFrame) {
          b64Frames.push((await readFile(framePath)).toString('base64'));
        }
      }
      // Last resort for very short clips: the first decodable frame.
      if (!b64Frames.length) {
        const framePath = path.join(os.tmpdir(), `reel-${stamp}-f0s.jpg`);
        tmpFiles.push(framePath);
        if (await extractFrameAt(videoPath, framePath, 0)) {
          b64Frames.push((await readFile(framePath)).toString('base64'));
        }
      }
      if (!b64Frames.length) {
        return NextResponse.json({ error: 'Could not extract frames from the video (ffmpeg)' }, { status: 502 });
      }

      const extraction = await extractCaptionFromFrames(b64Frames, Number(rowNumber) || 0);
      if (!extraction.ok) {
        // 429 lets the client back off past the per-minute quota window; F may
        // already be written — the retry skips it (cell no longer empty).
        return NextResponse.json({ error: extraction.message }, { status: extraction.rateLimited ? 429 : 502 });
      }
      caption = extraction.caption;
      keyUsed = extraction.keyUsed;
      if (caption) {
        // Prepend in front of whatever B already held (read at step 1).
        await writeCell('B', prependCaption(caption, existingTitle));
        wroteTitle = true;
      }
    }

    console.log(
      `[Extract Title/Prompt] Row ${rowNumber} — title: ${wroteTitle ? (existingTitle ? 'prepended' : 'written') : needTitle ? (caption === null ? 'no overlay found' : 'not written') : titleLocked ? 'locked {…}' : 'kept'}, ` +
      `prompt: ${wroteTopic ? 'written' : needTopic ? 'no description available' : 'kept'}${keyUsed ? ` (key #${keyUsed})` : ''}`
    );

    return NextResponse.json({
      success: true,
      rowNumber,
      caption,
      description: description || null,
      wroteTitle,
      // Whether column B already had text that the caption went in front of,
      // vs. an empty cell that was simply filled.
      prependedTitle: wroteTitle && !!existingTitle,
      wroteTopic,
      keyUsed,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : undefined;
    console.error('[Extract Title/Prompt] Error:', message || error);
    if (error instanceof GoogleAuthError) {
      return NextResponse.json({ error: 'Please reconnect your Google account.' }, { status: 401 });
    }
    if (isAbortError(error)) {
      return NextResponse.json({ error: 'Google request timed out. Please try again.' }, { status: 504 });
    }
    return NextResponse.json({ error: message || 'Failed to extract title/prompt' }, { status: 500 });
  } finally {
    // Best-effort temp cleanup (video + frames).
    await Promise.all(tmpFiles.map((f) => unlink(f).catch(() => {})));
  }
}
