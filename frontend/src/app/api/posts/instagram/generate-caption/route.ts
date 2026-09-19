import { NextRequest, NextResponse } from 'next/server';
import { generateCaptionWithOpenRouter, hasOpenRouterKey } from '@/lib/video-reels/openrouter';
import { generateCaptionWithSearchGrounding, hasSearchGroundingKeys } from '@/lib/video-reels/search-grounding';
import { stripSourceCitations } from '@/lib/video-reels/text-clean';

export const runtime = 'nodejs';
// A grounded Gemini call (Google Search) can take a while; give it headroom.
export const maxDuration = 60;

// Instagram's hard caption limit is 2200 chars. The model can't reliably count
// characters, so we enforce the cap in code regardless of what it returns.
const MAX_CAPTION_CHARS = 2200;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Pool of Gemini API keys tried in priority order (GEMINI_API_KEYS, comma-separated;
// falls back to GEMINI_API_KEY). Separate keys belong to separate Google projects, so
// rotating on a rate limit multiplies usable free-tier quota.
function getGeminiKeys(): string[] {
  const pool = (process.env.GEMINI_API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
  if (pool.length) return pool;
  const single = process.env.GEMINI_API_KEY?.trim();
  return single ? [single] : [];
}

type GeminiResult =
  | { ok: true; caption: string; searchQueries: string[] }
  | { ok: false; rateLimited: boolean; status: number; detail: string };

// Call Gemini with Google Search grounding using a specific key. Returns the caption +
// the queries it ran, or a structured failure (rateLimited flags 429/503 so the caller rotates).
async function generateWithGemini(prompt: string, apiKey: string): Promise<GeminiResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    const rateLimited = res.status === 429 || res.status === 503;
    return { ok: false, rateLimited, status: res.status, detail };
  }

  const data = await res.json();
  const searchQueries: string[] = data.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? [];
  const caption = (data.candidates?.[0]?.content?.parts || [])
    .map((p: { text?: string }) => p.text || '')
    .join('')
    .trim();
  return { ok: true, caption, searchQueries };
}

// Trim to the limit without cutting mid-sentence/word: prefer the last sentence end,
// then the last space, before a hard slice.
function capCaption(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSentence = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '), slice.lastIndexOf('\n'));
  if (lastSentence > max * 0.6) return slice.slice(0, lastSentence + 1).trim();
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > 0) return slice.slice(0, lastSpace).trim();
  return slice.trim();
}

/**
 * Generate an Instagram caption from a free-text prompt (the dialog sends the editable
 * prefix + the user's typed topic). Unlike the video-reels caption route this reads/writes
 * no Google Sheet — it's a thin Gemini wrapper that returns the caption text to the client.
 */
export async function POST(request: NextRequest) {
  const geminiKeys = getGeminiKeys();
  if (!geminiKeys.length) {
    return NextResponse.json(
      { error: 'No Gemini API keys configured (set GEMINI_API_KEYS or GEMINI_API_KEY).' },
      { status: 500 },
    );
  }

  try {
    const body = await request.json() as { prompt?: string };
    const prompt = (body.prompt ?? '').trim();
    if (!prompt) {
      return NextResponse.json({ error: 'A prompt (prefix + topic) is required.' }, { status: 400 });
    }

    let result: Extract<GeminiResult, { ok: true }> | null = null;
    let lastFailure: Extract<GeminiResult, { ok: false }> | null = null;
    // Gate the paid fallbacks on ANY key being rate-limited, not just the last
    // one tried (one bad key shouldn't suppress or spuriously fire them).
    let anyRateLimited = false;

    for (let i = 0; i < geminiKeys.length; i++) {
      const attempt = await generateWithGemini(prompt, geminiKeys[i]);
      if (attempt.ok) { result = attempt; break; }
      lastFailure = attempt;
      if (attempt.rateLimited) anyRateLimited = true;
      const why = attempt.rateLimited ? `rate limited (${attempt.status})` : `error ${attempt.status}`;
      console.warn(`[Posts Caption] Gemini key #${i + 1}/${geminiKeys.length} ${why}${i < geminiKeys.length - 1 ? ' — trying next key' : ''}`);
      if (!attempt.rateLimited) console.error('[Posts Caption] Gemini detail:', attempt.detail.slice(0, 300));
    }

    // Fallback tier 2: all Gemini keys rate limited → still-grounded caption via
    // Serper (Google search) + DeepSeek v4-flash. The client sends one free-text
    // prompt ("<prefix> Topic: <topic>"), so search on the text after "Topic:".
    if (!result && anyRateLimited && hasSearchGroundingKeys()) {
      console.warn('[Posts Caption] All Gemini keys rate limited; trying Serper+DeepSeek fallback');
      // Use the text after "Topic:" as the search query; if the user removed
      // that marker from a custom prefix, fall back to the prompt TAIL (where
      // the topic is appended) rather than the boilerplate head.
      const afterTopic = prompt.split(/\btopic:\s*/i).pop();
      const topicForSearch = (afterTopic && afterTopic !== prompt ? afterTopic : prompt.slice(-400)).trim() || prompt;
      const sg = await generateCaptionWithSearchGrounding(prompt, topicForSearch);
      if (sg.ok && sg.caption) {
        result = { ok: true, caption: sg.caption, searchQueries: [] };
        console.log('[Posts Caption] served by Serper+DeepSeek (Gemini keys rate limited)');
      } else if (sg.ok) {
        console.error('[Posts Caption] Serper+DeepSeek returned an empty caption');
      } else {
        console.error('[Posts Caption] Serper+DeepSeek fallback failed:', sg.status, sg.detail.slice(0, 200));
      }
    }

    // Last resort (tier 3): paid OpenRouter Gemini Flash Lite (ungrounded).
    if (!result && anyRateLimited && hasOpenRouterKey()) {
      console.warn('[Posts Caption] Trying OpenRouter last-resort fallback');
      const or = await generateCaptionWithOpenRouter(prompt);
      if (or.ok && or.caption) {
        result = { ok: true, caption: or.caption, searchQueries: [] };
        console.log('[Posts Caption] served by OpenRouter (Gemini keys rate limited)');
      } else if (or.ok) {
        console.error('[Posts Caption] OpenRouter returned an empty caption (billed)');
      } else {
        console.error('[Posts Caption] OpenRouter fallback failed:', or.status, or.detail.slice(0, 200));
      }
    }

    if (!result) {
      const status = lastFailure?.status ?? 502;
      const msg = anyRateLimited
        ? `All ${geminiKeys.length} Gemini key(s) are rate limited (last status ${status}).`
        : `Gemini API error (${status}).`;
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    if (result.searchQueries.length) {
      console.log('[Posts Caption] 🔎 searched:', result.searchQueries.join(' | '));
    } else {
      console.warn('[Posts Caption] ⚠️ no web search performed — caption is ungrounded');
    }

    const caption = capCaption(stripSourceCitations(result.caption), MAX_CAPTION_CHARS);
    if (!caption) {
      return NextResponse.json({ error: 'Gemini returned an empty caption.' }, { status: 502 });
    }

    return NextResponse.json({ caption });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to generate caption';
    console.error('[Posts Caption] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
