import { NextRequest, NextResponse } from 'next/server';
import { getGoogleToken, googleFetch, GoogleAuthError } from '@/lib/video-reels/google-token-storage';
import { isAbortError } from '@/lib/video-reels/fetch-timeout';
import { generateCaptionWithOpenRouter, hasOpenRouterKey } from '@/lib/video-reels/openrouter';
import { generateCaptionWithSearchGrounding, hasSearchGroundingKeys } from '@/lib/video-reels/search-grounding';
import { stripSourceCitations } from '@/lib/video-reels/text-clean';

export const runtime = 'nodejs';
// A grounded Gemini call (Google Search) plus two Sheets calls can take well
// over the default timeout, which surfaces as a Vercel platform 500. Give it
// generous headroom so a single row never gets killed mid-request.
export const maxDuration = 60;

// Instagram's hard caption limit is 2200 chars. We ask the model to OVERSHOOT
// (aim ~2200-2400) since models undershoot length targets, then hard-crop the
// result to CAPTION_TARGET_MAX at a sentence boundary — so captions reliably land
// in the wanted ~1500-2000 range instead of coming out short.
const CAPTION_TARGET_MAX = 2000;

// Fixed prompt prefix — the topic from column F is appended to this.
//
// Optimised for Instagram SEARCH ("reach in the caption") rather than hashtags: Meta
// indexes the caption text itself, so the prompt drives three things — a hook inside the
// ~125 chars the feed shows before truncating, 15-20 real search phrases woven into the
// prose, and enough substance to earn a save or a share (which weigh far more than likes).
//
// Keywords are integrated INTO SENTENCES rather than clustered in brackets at the bottom.
// The bracket-cluster variant of that tactic cannot work here: capCaption() below crops the
// tail to CAPTION_TARGET_MAX, and since the prompt deliberately overshoots that limit, a
// trailing bracket block would be cut on essentially every row. Supporting it would mean
// splitting the cluster off before the crop AND before stripSourceCitations() (which deletes
// any bracket group holding a domain-like token, e.g. a keyword such as "sonotrade.io").
const PROMPT_PREFIX =
  'Write an Instagram caption for the topic below, optimised for Instagram search. ' +
  'Before writing, you must use Google Search to look up current, accurate, up-to-date ' +
  'information about the topic, and base the caption on what you find — do not rely on prior knowledge alone. ' +
  'HOOK: The first 125 characters are the only part shown in the feed before Instagram truncates ' +
  'the caption, so they must earn the tap on "more". Open with something specific and concrete — a ' +
  'surprising fact, a number, a tension, or a claim that demands explanation. Front-load the single ' +
  'most interesting thing you found. Never open with a generic scene-setter ("In the world of...", ' +
  '"In recent years...", "It is no secret that..."), never open with a question, and never open by ' +
  'flatly naming the subject. ' +
  'SEARCH KEYWORDS: Identify 15 to 20 specific phrases that someone interested in this subject would ' +
  'actually type into the Instagram search bar, and work them into the caption. Prefer precise ' +
  'multi-word phrases over single generic nouns. Every keyword must sit inside a sentence where it ' +
  'reads naturally and carries real meaning — never list keywords, never repeat one more than twice, ' +
  'and never bend a sentence around a keyword. If a keyword cannot be used naturally, drop it. ' +
  'VALUE: The caption must give the reader something worth keeping — the context behind the story, ' +
  'what it means, what changed, what to watch next, or a concrete takeaway they could act on. Write ' +
  'it as a micro-blog: short paragraphs of two to four sentences, separated by a blank line. A reader ' +
  'should finish it feeling they learned something. ' +
  'CLEAN OUTPUT: The topic below may be a raw social-media caption containing hashtags, emojis, ' +
  '@handles, and promotional calls-to-action (e.g. "follow us", "link in bio", "via ..."). Ignore all of ' +
  'that noise entirely — write only about the substantive subject, and never reproduce hashtags, ' +
  '@handles, or promo text in your caption. Do NOT use emojis. ' +
  'Do NOT include any source citations, URLs, website names, domain names, or reference markers ' +
  '(e.g. "[wikipedia.org]" or "[1]") in the caption — write it as clean prose with no references. ' +
  'LENGTH: Write a rich, detailed, thorough caption — aim for roughly 2200 to 2400 characters. ' +
  'Be substantial: fully develop the subject. Do NOT stop short or write a brief caption. ' +
  'Output only the caption text, nothing else. Topic:';

// ── Alternate prompt — "story" style ─────────────────────────────────────────
// Emulates the narrative caption format another creator runs with AI (reverse-
// engineered from sonotradeio rows 210-220): a fixed `In [year], [artist] …`
// opener, ONE continuous paragraph moving context → creation/BTS → what-the-
// footage-shows → Billboard/RIAA legacy closer, music-journalist superlatives,
// closed with the literal tag `music content` (their originals wrap the whole
// thing in double quotes — ours deliberately do NOT, by request). Their
// originals run ~1,600-1,700 chars; ours target
// 2,000-2,100 — the prompt overshoots (2,100-2,300, models undershoot length)
// and capStoryCaption() crops INSIDE the wrapper so the signature tail survives.
const STORY_TARGET_MAX = 2100;
const STORY_TAG = ' music content';
const STORY_PROMPT_PREFIX =
  'Write an Instagram caption for the music video moment described below. ' +
  'Before writing, use Google Search to verify the facts (year, producers, chart peaks, certifications) — never invent statistics. ' +
  'STRUCTURE — one single continuous paragraph with NO line breaks, built strictly in this order: ' +
  '1. OPENER: the first sentence must begin "In [year], [artist name]" followed by a vivid verb phrase summarizing the moment in the video ' +
  '(e.g. "silenced a lethargic concert crowd", "defied monumental industry odds", "accidentally created the defining anthem"). ' +
  '2. CONTEXT: three to five sentences on where the artist\'s career stood at that moment, the stakes, and what the era was like, ' +
  'opened with a time marker such as "At the time," / "Following..." / "Before the release of..." / "The [era] marked...". ' +
  '3. CREATION: three to five sentences of behind-the-scenes detail on how the song or moment was made — name the producer(s) and ' +
  'describe the sonic ingredients or creative intent, using a pivot phrase like "Produced by...", "The genius of ... was...", ' +
  '"The inside story of..." or "Behind the boards,...". ' +
  '4. THE FOOTAGE: two to four sentences describing what literally happens in the video and why it is impressive, introduced with ' +
  '"This live footage captures..." / "This specific footage captures..." / "The visual features..." or similar. ' +
  '5. LEGACY: two to three closing sentences of hard results — you MUST include a Billboard chart peak (e.g. "peaked at number 4 on ' +
  'the Billboard Hot 100") and an RIAA certification or sales figure (e.g. "certified 2x Platinum by the RIAA"), ending with a ' +
  'legacy statement using "remains", "stands as" or "proving that...". ' +
  'VOICE: enthusiastic music-journalist prose in the third person, past tense, with confident superlatives used naturally: ' +
  '"masterclass", "monumental", "iconic", "legendary", "undeniable", "breathtaking". Em dashes are allowed. Never address the ' +
  'reader, never ask a question, never use hashtags, emojis, @handles, or calls to action. ' +
  "FORMATTING: song titles in 'single quotes'; album titles capitalized with no quotes; short quoted phrases or nicknames in " +
  '"double quotes"; no markdown of any kind. ' +
  'LENGTH: the caption must be RICH and LONG — between 2,100 and 2,300 characters (roughly 350 words). Fully develop every beat; do not stop short. ' +
  'OUTPUT FORMAT: output nothing but the caption itself — NO surrounding quotation marks — ending with a period, a space, and ' +
  'the words music content, exactly like this: [caption text]. music content ' +
  'Topic:';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Pool of Gemini API keys tried in priority order. Set GEMINI_API_KEYS to a
// comma-separated list (primary first); falls back to the single GEMINI_API_KEY.
// Each key should belong to a SEPARATE Google Cloud project, since free-tier
// rate limits are scoped per project — so the pool multiplies usable quota.
function getGeminiKeys(): string[] {
  const pool = (process.env.GEMINI_API_KEYS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  if (pool.length) return pool;
  const single = process.env.GEMINI_API_KEY?.trim();
  return single ? [single] : [];
}

type GeminiResult =
  | { ok: true; caption: string; searchQueries: string[] }
  | { ok: false; rateLimited: boolean; status: number; detail: string };

// Calls Gemini with Google Search grounding using a specific API key. Returns
// the caption + the search queries it ran, or a structured failure (rateLimited
// flags 429/503 so the caller can rotate to the next key in the pool).
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
    // 429 = rate limit / quota exhausted, 503 = model overloaded.
    const rateLimited = res.status === 429 || res.status === 503;
    return { ok: false, rateLimited, status: res.status, detail };
  }

  const data = await res.json();
  const searchQueries: string[] =
    data.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? [];
  const caption = (data.candidates?.[0]?.content?.parts || [])
    .map((p: { text?: string }) => p.text || '')
    .join('')
    .trim();
  return { ok: true, caption, searchQueries };
}

// Trims a caption to the limit without cutting mid-sentence/word. Prefers the
// last sentence end, then the last space, before falling back to a hard slice.
function capCaption(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSentence = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('\n')
  );
  if (lastSentence > max * 0.6) return slice.slice(0, lastSentence + 1).trim();
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > 0) return slice.slice(0, lastSpace).trim();
  return slice.trim();
}

// Normalize a story-style caption into its exact signature shape — `<text> music content`,
// NO surrounding quotation marks — and cap the TOTAL length at STORY_TARGET_MAX by trimming
// the text at a sentence boundary (never the tag), so an overshot generation still ends in
// the signature. Also strips quote wrappers a model adds anyway, and repairs a missing tag.
function capStoryCaption(raw: string): string {
  let inner = raw.trim();
  inner = inner.replace(/^"/, '').replace(/"\.?$/, '').trim();          // strip quotes if the model added them
  const tag = STORY_TAG.trim();
  if (inner.toLowerCase().endsWith(tag)) inner = inner.slice(0, -tag.length).trim();
  inner = capCaption(inner, STORY_TARGET_MAX - STORY_TAG.length);
  return `${inner}${STORY_TAG}`;
}

// Generates an Instagram caption for a single sheet row:
//   1. Reads the topic from column F of `rowNumber`
//   2. Asks Gemini (with Google Search grounding) to write the caption,
//      rotating through the GEMINI_API_KEYS pool if a key is rate limited
//   3. Writes the result back to column D of the same row
export async function POST(request: NextRequest) {
  const tokenData = await getGoogleToken();

  if (!tokenData) {
    return NextResponse.json(
      { error: 'Not connected to Google. Please connect your account first.' },
      { status: 401 }
    );
  }

  const geminiKeys = getGeminiKeys();
  if (!geminiKeys.length) {
    return NextResponse.json(
      { error: 'No Gemini API keys configured (set GEMINI_API_KEYS or GEMINI_API_KEY).' },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { spreadsheetId, sheetName, rowNumber } = body;
    // 'search' (default) = the keyword-optimised prompt; 'story' = the narrative
    // creator-style format (In [year]… → stats closer, ends "music content").
    const story = body.style === 'story';

    if (!spreadsheetId || !sheetName || rowNumber === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: spreadsheetId, sheetName, rowNumber' },
        { status: 400 }
      );
    }

    // 1. Read the existing caption (column D) and the topic (column F) in one
    // call (auto-refreshes the token on 401). Range D:F returns [D, E, F].
    const readRange = `${encodeURIComponent(sheetName)}!D${rowNumber}:F${rowNumber}`;
    const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${readRange}`;

    const readRes = await googleFetch(readUrl, {
      headers: { Accept: 'application/json' },
    });

    if (!readRes.ok) {
      const errorText = await readRes.text();
      console.error('[Generate Caption] Failed to read columns D:F:', errorText);
      return NextResponse.json(
        { error: `Failed to read sheet: ${readRes.statusText}` },
        { status: readRes.status }
      );
    }

    const readData = await readRes.json();
    const cols: string[] = readData.values?.[0] ?? [];
    const existingCaption = (cols[0] ?? '').trim(); // column D
    const topic = (cols[2] ?? '').trim();           // column F

    if (existingCaption) {
      // Column D already has a caption — don't overwrite it. Skip this row.
      console.log('[Generate Caption] Row', rowNumber, '⏭️ already has a caption in column D — skipping');
      return NextResponse.json({ skipped: true, reason: 'exists', rowNumber });
    }

    if (!topic) {
      // Nothing to generate from — let the client mark this row as skipped.
      return NextResponse.json({ skipped: true, reason: 'no-topic', rowNumber });
    }

    // 2. Generate the caption with Gemini, grounded with Google Search, trying
    // every key in the pool and rotating on failure (rate limit / daily quota).
    // The starting key is derived from the row number so that rows generated
    // concurrently spread across the whole pool instead of all hitting key #1
    // first and cascading through shared 429s.
    const prompt = `${story ? STORY_PROMPT_PREFIX : PROMPT_PREFIX} ${topic}`;
    let result: Extract<GeminiResult, { ok: true }> | null = null;
    let usedKey = 0;
    let lastFailure: Extract<GeminiResult, { ok: false }> | null = null;
    // True if ANY key was rate-limited (429/503) this pass — gates the paid
    // fallbacks and the 429-vs-502 status. Keying off only the LAST key's
    // failure would let one bad key (e.g. a 400) in the pool suppress the
    // fallbacks (or fire them spuriously).
    let anyRateLimited = false;

    const startIdx = Number.isFinite(Number(rowNumber))
      ? Math.abs(Math.trunc(Number(rowNumber))) % geminiKeys.length
      : 0;
    for (let n = 0; n < geminiKeys.length; n++) {
      const i = (startIdx + n) % geminiKeys.length;
      const attempt = await generateWithGemini(prompt, geminiKeys[i]);
      if (attempt.ok) {
        result = attempt;
        usedKey = i + 1;
        break;
      }
      lastFailure = attempt;
      if (attempt.rateLimited) anyRateLimited = true;
      const why = attempt.rateLimited ? `rate limited (${attempt.status})` : `error ${attempt.status}`;
      const more = n < geminiKeys.length - 1 ? ' — trying next key' : '';
      console.warn(`[Generate Caption] Row ${rowNumber} — Gemini key #${i + 1}/${geminiKeys.length} ${why}${more}`);
      if (!attempt.rateLimited) {
        console.error('[Generate Caption] Gemini detail:', attempt.detail.slice(0, 300));
      }
    }

    // Fallback tier 2: when EVERY Gemini key is rate limited, generate a still-
    // GROUNDED caption via Serper (Google search) + DeepSeek v4-flash — far
    // cheaper than the OpenRouter web-search path (~$0.0012/caption). Only on
    // rate limiting — other errors (bad request etc.) shouldn't burn paid quota.
    if (!result && anyRateLimited && hasSearchGroundingKeys()) {
      console.warn('[Generate Caption] Row', rowNumber, '— all Gemini keys rate limited; trying Serper+DeepSeek fallback');
      const sg = await generateCaptionWithSearchGrounding(prompt, topic);
      if (sg.ok && sg.caption) {
        result = { ok: true, caption: sg.caption, searchQueries: [] };
        usedKey = geminiKeys.length + 1; // virtual key id = Serper+DeepSeek
        console.log('[Generate Caption] Row', rowNumber, '— served by Serper+DeepSeek (Gemini keys rate limited)');
      } else if (sg.ok) {
        console.error('[Generate Caption] Row', rowNumber, 'Serper+DeepSeek returned an empty caption');
      } else {
        console.error('[Generate Caption] Row', rowNumber, 'Serper+DeepSeek fallback failed:', sg.status, sg.detail.slice(0, 200));
      }
    }

    // Last resort (tier 3): paid OpenRouter Gemini Flash Lite (ungrounded).
    let openRouterEmpty = false;
    if (!result && anyRateLimited && hasOpenRouterKey()) {
      console.warn('[Generate Caption] Row', rowNumber, '— trying OpenRouter last-resort fallback');
      const or = await generateCaptionWithOpenRouter(prompt);
      if (or.ok && or.caption) {
        result = { ok: true, caption: or.caption, searchQueries: [] };
        usedKey = geminiKeys.length + 2; // virtual key id = OpenRouter
        console.log('[Generate Caption] Row', rowNumber, '— served by OpenRouter (Gemini keys rate limited)');
      } else if (or.ok) {
        // A billed HTTP 200 with no caption. Mark terminal so the client does
        // NOT retry (retrying re-runs — and re-bills — this paid call).
        openRouterEmpty = true;
        console.error('[Generate Caption] Row', rowNumber, 'OpenRouter returned an empty caption (billed) — not retrying');
      } else {
        console.error('[Generate Caption] Row', rowNumber, 'OpenRouter fallback failed:', or.status, or.detail.slice(0, 200));
      }
    }

    if (!result) {
      const status = lastFailure?.status ?? 502;
      const msg = openRouterEmpty
        ? 'OpenRouter fallback returned an empty caption'
        : anyRateLimited
          ? `All ${geminiKeys.length} Gemini key(s) are rate limited (last status ${status})`
          : `Gemini API error (${status})`;
      console.error('[Generate Caption] Row', rowNumber, 'all keys failed:', msg);
      // 422 when the paid fallback already ran but produced nothing — a terminal
      // status the client won't retry (avoids re-billing OpenRouter). Otherwise
      // pool-wide rate limiting surfaces as 429 so the client backs off for the
      // per-minute quota window to roll over.
      const httpStatus = openRouterEmpty ? 422 : anyRateLimited ? 429 : 502;
      return NextResponse.json({ error: msg }, { status: httpStatus });
    }

    // Log which tier served this row. usedKey = 1..N is a Gemini key; N+1 is the
    // Serper+DeepSeek grounded tier; N+2 is the OpenRouter last resort.
    const servedBy =
      usedKey === geminiKeys.length + 1 ? 'Serper+DeepSeek (grounded)'
        : usedKey === geminiKeys.length + 2 ? 'OpenRouter flash-lite (ungrounded)'
          : `Gemini key #${usedKey}/${geminiKeys.length}`;
    console.log(`[Generate Caption] Row ${rowNumber} — served by ${servedBy}`);
    // The grounding proof (searchQueries) only exists for the Gemini path; the
    // Serper tier is grounded via Serper (no queries returned), so don't warn it.
    if (usedKey <= geminiKeys.length) {
      if (result.searchQueries.length) {
        console.log('[Generate Caption] Row', rowNumber, '🔎 searched:', result.searchQueries.join(' | '));
      } else {
        console.warn('[Generate Caption] Row', rowNumber, '⚠️ no web search performed — caption is ungrounded');
      }
    }

    // Strip any source-citation markers the grounded model appended
    // (e.g. "[wikipedia.org, billboard.com]"), then enforce the char cap.
    const rawCaption = stripSourceCitations(result.caption);

    // Crop the (overshot) caption to the target at a sentence boundary. Story style
    // crops inside its quote wrapper so the `music content".` signature survives.
    const caption = story ? capStoryCaption(rawCaption) : capCaption(rawCaption, CAPTION_TARGET_MAX);
    if (caption.length < rawCaption.length) {
      console.log(
        '[Generate Caption] Row', rowNumber,
        `trimmed ${rawCaption.length} → ${caption.length} chars`
      );
    }

    if (!caption) {
      console.error(`[Generate Caption] Empty Gemini response from key #${usedKey}`);
      return NextResponse.json(
        { error: 'Gemini returned an empty caption' },
        { status: 502 }
      );
    }

    // 3. Write the caption into column D
    const writeRange = `${encodeURIComponent(sheetName)}!D${rowNumber}`;
    const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${writeRange}?valueInputOption=USER_ENTERED`;

    const writeRes = await googleFetch(writeUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [[caption]] }),
    });

    if (!writeRes.ok) {
      const errorText = await writeRes.text();
      console.error('[Generate Caption] Failed to write column D:', errorText);
      return NextResponse.json(
        { error: `Failed to write caption: ${writeRes.statusText}` },
        { status: writeRes.status }
      );
    }

    console.log('[Generate Caption] ✅ Row', rowNumber, `→ column D updated (${servedBy})`);
    return NextResponse.json({ success: true, rowNumber, caption, keyUsed: usedKey });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Generate Caption] Error:', message);

    // Refresh failed definitively — tell the client to reconnect Google.
    if (error instanceof GoogleAuthError) {
      return NextResponse.json(
        { error: 'Please reconnect your Google account.' },
        { status: 401 }
      );
    }
    // Upstream timed out — surface as a gateway timeout.
    if (isAbortError(error)) {
      return NextResponse.json(
        { error: 'Google request timed out. Please try again.' },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { error: message || 'Failed to generate caption' },
      { status: 500 }
    );
  }
}
