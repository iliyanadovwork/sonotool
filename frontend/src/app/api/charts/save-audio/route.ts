import { NextRequest, NextResponse } from 'next/server';
import { writeFile, unlink } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';

export const runtime = 'nodejs';

function parseMp4Duration(buf: Buffer): number | null {
  for (let i = 4; i < buf.length - 36; i++) {
    if (buf[i] === 0x6d && buf[i + 1] === 0x64 && buf[i + 2] === 0x68 && buf[i + 3] === 0x64) {
      const version = buf[i + 4];
      if (version === 0) {
        const ts = buf.readUInt32BE(i + 16);
        const dur = buf.readUInt32BE(i + 20);
        if (ts > 0 && dur > 0) return Math.round((dur / ts) * 1000);
      } else if (version === 1) {
        const ts = buf.readUInt32BE(i + 24);
        const durHi = buf.readUInt32BE(i + 28);
        const durLo = buf.readUInt32BE(i + 32);
        const dur = durHi * 2 ** 32 + durLo;
        if (ts > 0 && dur > 0) return Math.round((dur / ts) * 1000);
      }
    }
  }
  return null;
}

async function convertToMp3(inputPath: string, outputPath: string): Promise<void> {
  const ffmpegPath = (await import('@ffmpeg-installer/ffmpeg')).default.path;
  const ffmpeg = (await import('fluent-ffmpeg')).default;
  ffmpeg.setFfmpegPath(ffmpegPath);
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate(192)
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .run();
  });
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json() as { url?: string };
    if (!url?.trim()) return NextResponse.json({ error: 'url required' }, { status: 400 });

    const dlRes = await fetch(new URL('/api/download', req.url).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.trim() }),
    });
    if (!dlRes.ok) {
      const err = await dlRes.json() as { error?: string };
      return NextResponse.json({ error: err.error || 'Download failed' }, { status: 400 });
    }
    const dlData = await dlRes.json() as { hdplay?: string; play?: string; error?: string };
    if (dlData.error || (!dlData.hdplay && !dlData.play)) {
      return NextResponse.json({ error: dlData.error || 'No media found' }, { status: 400 });
    }

    const cdnUrl = dlData.hdplay || dlData.play || '';
    const proxyUrl = new URL('/api/proxy', req.url);
    proxyUrl.searchParams.set('url', cdnUrl);
    proxyUrl.searchParams.set('stream', '1');

    const fileRes = await fetch(proxyUrl.toString());
    if (!fileRes.ok) return NextResponse.json({ error: 'Failed to fetch audio file' }, { status: 502 });

    const buf = Buffer.from(await fileRes.arrayBuffer());
    const durationMs = parseMp4Duration(buf) ?? 20000;

    // Save MP4 to temp, convert to MP3
    const ts = Date.now();
    const tmpMp4 = path.join(os.tmpdir(), `chart-audio-${ts}.mp4`);
    const audioDir = path.join(process.cwd(), 'public', 'audio');
    if (!existsSync(audioDir)) mkdirSync(audioDir, { recursive: true });
    const filename = `track-custom-${ts}.mp3`;
    const outMp3 = path.join(audioDir, filename);

    await writeFile(tmpMp4, buf);
    await convertToMp3(tmpMp4, outMp3);
    await unlink(tmpMp4).catch(() => {});

    return NextResponse.json({ url: `/audio/${filename}`, durationMs });
  } catch (err) {
    console.error('[save-audio]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
