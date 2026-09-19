// OpenRouter (OpenAI-compatible) — a PAID last-resort fallback used only when
// every Gemini key in the pool is rate limited. Configure with OPENROUTER_API_KEY.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Default to the cheap Gemini 2.5 Flash Lite (override with OPENROUTER_MODEL).
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-lite';
// Web-search grounding (the ":online" model suffix) is OFF by default — it was
// ~75% of the per-call cost, and this only fires as a rare last resort where the
// column-F topic already supplies context. Set OPENROUTER_GROUNDING=true to
// re-enable it (no code change / redeploy of logic needed).
const OPENROUTER_GROUNDING = /^(1|true|yes)$/i.test(process.env.OPENROUTER_GROUNDING || '');
const CAPTION_MODEL = OPENROUTER_GROUNDING ? `${OPENROUTER_MODEL}:online` : OPENROUTER_MODEL;

export function hasOpenRouterKey(): boolean {
  return !!process.env.OPENROUTER_API_KEY?.trim();
}

function headers(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    // Optional attribution headers OpenRouter recommends.
    'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://sonotool.app',
    'X-Title': 'Sonotool',
  };
}

type OpenRouterText =
  | { ok: true; caption: string }
  | { ok: false; status: number; detail: string };

// Last-resort caption generation. Web-search grounding is off by default (see
// OPENROUTER_GROUNDING) to keep this cheap; the caption is written from the
// column-F topic seed the primary path already grounded.
export async function generateCaptionWithOpenRouter(prompt: string): Promise<OpenRouterText> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) return { ok: false, status: 500, detail: 'OPENROUTER_API_KEY not set' };
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: headers(key),
      body: JSON.stringify({
        model: CAPTION_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      }),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, detail: await res.text() };
    }
    const data = await res.json();
    const caption = (data.choices?.[0]?.message?.content ?? '').trim();
    return { ok: true, caption };
  } catch (e) {
    return { ok: false, status: 502, detail: (e instanceof Error ? e.message : undefined) || 'OpenRouter request failed' };
  }
}

type OpenRouterVision =
  | { ok: true; caption: string | null }
  | { ok: false; status: number; detail: string };

// Vision extraction (overlay-caption reading from frames). b64Frames are raw
// base64 JPEGs. Returns { caption } parsed from JSON-object output.
export async function extractWithOpenRouterVision(prompt: string, b64Frames: string[]): Promise<OpenRouterVision> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) return { ok: false, status: 500, detail: 'OPENROUTER_API_KEY not set' };
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: headers(key),
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...b64Frames.map((b64) => ({
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${b64}` },
              })),
            ],
          },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, detail: await res.text() };
    }
    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content ?? '').trim();
    try {
      const parsed = JSON.parse(text);
      const raw = typeof parsed?.caption === 'string' ? parsed.caption : '';
      const caption = raw.replace(/\s+/g, ' ').trim();
      return { ok: true, caption: caption || null };
    } catch {
      return { ok: true, caption: null };
    }
  } catch (e) {
    return { ok: false, status: 502, detail: (e instanceof Error ? e.message : undefined) || 'OpenRouter request failed' };
  }
}
