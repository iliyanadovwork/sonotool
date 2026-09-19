// Shared Gemini-vision overlay-caption extraction, used by both the
// client-frame route (/api/video-reels/extract-caption) and the sheet-driven
// route (/api/video-reels/google/sheets/extract-title-prompt).

import { extractWithOpenRouterVision, hasOpenRouterKey } from './openrouter';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Same key pool as the caption generator: GEMINI_API_KEYS (comma-separated,
// tried in priority order, rotating on rate limit), falling back to the single
// GEMINI_API_KEY. Each key belongs to a separate Google project.
export function getGeminiKeys(): string[] {
  const pool = (process.env.GEMINI_API_KEYS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  if (pool.length) return pool;
  const single = process.env.GEMINI_API_KEY?.trim();
  return single ? [single] : [];
}

// Reads the creator's overlay caption from video frames, verbatim, while
// excluding handles / watermarks / burned-in speech subtitles / footage text.
export function buildExtractionPrompt(frameCount: number): string {
  return (
    'You are reading frames from a social-media reel (TikTok/Instagram). Reels often have a caption the CREATOR ' +
    'overlaid on the video — usually text on the black letterbox bar above or below the video, or the body text of ' +
    'a tweet-style screenshot layout.\n\n' +
    'Your job: return that creator caption VERBATIM — exact wording, casing, punctuation, and line breaks.\n\n' +
    'STRICT exclusions — never include any of these in the caption:\n' +
    '- Usernames, @handles, display names, or verification badges (for tweet-style layouts return ONLY the tweet body text, never the name/handle row above it)\n' +
    '- Watermarks (TikTok/CapCut logos or usernames), channel logos, "link in bio" bugs\n' +
    '- Speech subtitles / closed captions burned into the footage\n' +
    '- News tickers, chyrons, headlines, or any other text that is part of the source footage itself\n' +
    '- UI elements, timestamps, view/follower counts\n\n' +
    `You are given ${frameCount} frame(s) from the SAME video. The creator overlay is identical and identically ` +
    'positioned in every frame; speech subtitles and footage text change between frames — use that to tell them apart.\n\n' +
    'Respond with JSON only, in exactly this shape: {"caption": "<verbatim caption text>"} — or {"caption": null} ' +
    'if the video has no creator overlay caption.'
  );
}

export type ExtractionAttempt =
  | { ok: true; caption: string | null }
  | { ok: false; rateLimited: boolean; status: number; detail: string };

// One Gemini vision call with a specific key. b64Frames are raw base64 JPEGs
// (no data-URL prefix).
export async function extractWithGemini(b64Frames: string[], apiKey: string): Promise<ExtractionAttempt> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: buildExtractionPrompt(b64Frames.length) },
            ...b64Frames.map((b64) => ({ inline_data: { mime_type: 'image/jpeg', data: b64 } })),
          ],
        },
      ],
      // Deterministic + JSON-only output (no tools involved, so JSON mode is fine).
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    const rateLimited = res.status === 429 || res.status === 503;
    return { ok: false, rateLimited, status: res.status, detail };
  }

  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((p: { text?: string }) => p.text || '')
    .join('')
    .trim();

  try {
    const parsed = JSON.parse(text);
    const raw = typeof parsed?.caption === 'string' ? parsed.caption : '';
    // Collapse ALL whitespace (incl. the model's preserved line breaks) to
    // single spaces: the caption lands in a Google Sheets cell + an overlay
    // that word-wraps on its own, so a one-line value is what's wanted.
    const caption = raw.replace(/\s+/g, ' ').trim();
    return { ok: true, caption: caption || null };
  } catch {
    // JSON mode should prevent this; treat unparseable output as "no caption"
    // rather than failing the whole row.
    console.warn('[Caption Extraction] Unparseable model output:', text.slice(0, 200));
    return { ok: true, caption: null };
  }
}

export type ExtractionResult =
  | { ok: true; caption: string | null; keyUsed: number }
  | { ok: false; rateLimited: boolean; status: number; message: string };

// Runs the extraction against the key pool, starting at `spread % poolSize`
// (concurrent callers pass an index so they don't all hammer key #1 first) and
// rotating to the next key on rate limit / overload.
export async function extractCaptionFromFrames(b64Frames: string[], spread = 0): Promise<ExtractionResult> {
  const keys = getGeminiKeys();
  if (!keys.length) {
    return { ok: false, rateLimited: false, status: 500, message: 'No Gemini API keys configured (set GEMINI_API_KEYS or GEMINI_API_KEY).' };
  }

  const startIdx = Math.abs(Math.trunc(spread)) % keys.length;
  let lastFailure: Extract<ExtractionAttempt, { ok: false }> | null = null;

  for (let n = 0; n < keys.length; n++) {
    const i = (startIdx + n) % keys.length;
    const attempt = await extractWithGemini(b64Frames, keys[i]);
    if (attempt.ok) {
      return { ok: true, caption: attempt.caption, keyUsed: i + 1 };
    }
    lastFailure = attempt;
    const why = attempt.rateLimited ? `rate limited (${attempt.status})` : `error ${attempt.status}`;
    console.warn(`[Caption Extraction] Gemini key #${i + 1}/${keys.length} ${why}${n < keys.length - 1 ? ' — trying next key' : ''}`);
    if (!attempt.rateLimited) {
      console.error('[Caption Extraction] Gemini detail:', attempt.detail.slice(0, 300));
    }
  }

  // Last resort: all Gemini keys rate limited → paid OpenRouter Gemini Flash.
  if (lastFailure?.rateLimited && hasOpenRouterKey()) {
    console.warn('[Caption Extraction] All Gemini keys rate limited; trying OpenRouter fallback');
    const or = await extractWithOpenRouterVision(buildExtractionPrompt(b64Frames.length), b64Frames);
    if (or.ok) {
      console.log('[Caption Extraction] served by OpenRouter (Gemini keys rate limited)');
      return { ok: true, caption: or.caption, keyUsed: keys.length + 1 };
    }
    console.error('[Caption Extraction] OpenRouter fallback failed:', or.status, or.detail.slice(0, 200));
  }

  const status = lastFailure?.status ?? 502;
  return {
    ok: false,
    rateLimited: !!lastFailure?.rateLimited,
    status,
    message: lastFailure?.rateLimited
      ? `All ${keys.length} Gemini key(s) are rate limited (last status ${status})`
      : `Gemini API error (${status})`,
  };
}
