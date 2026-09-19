// Cleanup for scraped social-media post descriptions before they become the
// AI-caption topic (sheet column F). Source captions are noisy: HTML entities
// (from the og:description fallback), hashtags, @handles, follow/CTA promo, and
// emojis — all of which pollute the AI prompt (and the sheet).
//
// Design guarantee: NEVER destroy substantive prose. Noise is stripped as
// tokens; a line is dropped only if nothing substantive remains after stripping.
// Promo matching is restricted to phrases that don't occur in ordinary prose
// (so "flew via London", "give the rookie credit", "check out the album",
// "@mariah nailed it" all survive).

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"', amp: '&', apos: "'", lt: '<', gt: '>', nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
};

// Decode named + decimal (&#NN;) + hex (&#xNN;) entities, including astral code
// points (emoji). Unknown/invalid entities are left as-is.
export function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const cp = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff) {
        try { return String.fromCodePoint(cp); } catch { return m; }
      }
      return m;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named !== undefined ? named : m;
  });
}

// Emoji / pictograph / dingbat / flag ranges. Deliberately EXCLUDES general
// punctuation (U+2000–206F), currency, math, CJK, and plain arrows (→ U+2192)
// so real text is preserved; only emoji-style symbols are removed.
const EMOJI_RE =
  /(?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{2049}\u{203C}\u{2122}\u{2139}\u{2194}-\u{21AA}\u{231A}\u{231B}\u{23E9}-\u{23FA}\u{24C2}\u{25AA}-\u{25FE}\u{2934}\u{2935}\u{3030}\u{303D}\u{3297}\u{3299}]\u{FE0F}?\u{20E3}?|[\u{FE00}-\u{FE0F}\u{200D}])/gu;

// Promo / CTA phrases to strip. Restricted to multi-word or colon-anchored
// phrasings that essentially never appear in descriptive prose. Optional
// lead-ins ("don't forget to …", "make sure to …") are consumed so the whole
// CTA is removed rather than leaving a dangling fragment. All quantifiers are
// bounded (no unbounded .* ) so there is no ReDoS exposure.
const LEADIN =
  "(?:(?:please|pls|go|now|don'?t\\s+forget\\s+to|don'?t\\s+forget|make\\s+sure\\s+(?:to|you)|be\\s+sure\\s+to|remember\\s+to|hit\\s+that|smash\\s+that)\\s+){0,2}";
const PROMO_BODY = [
  "follow(?:\\s+(?:us|for|more|me))+",   // follow us / follow us for more / follow me
  "follow\\s+@\\S+",
  "link\\s+in\\s+(?:my\\s+)?bio",
  "turn\\s+on\\s+[\\w\\s]{0,20}notif\\w*",
  "post\\s+notif\\w*",
  "dm\\s+(?:us|me)\\b",
  "double\\s+tap",
  "swipe\\s+(?:up|left|right)",
  "tag\\s+(?:a\\s+friend|someone)",
  "comment\\s+(?:below|down)",
  "(?:save|share)\\s+(?:this|the)\\s+(?:post|reel|video|clip)",
  "via\\s*:",       // colon-anchored: "Via: X" is attribution, "flew via London" is not
  "credits?\\s*:", // colon-anchored: "Credits:" is attribution, "credit to crew" is not
].join("|");
const PROMO_RE = new RegExp(LEADIN + "(?:" + PROMO_BODY + ")", "gi");

// Removes source-citation markers a grounded model may append to a generated
// caption — e.g. "[billboard.com, wikipedia.org]" or "[apnews.com]" (common in
// OpenRouter ":online" web-search output and occasional Gemini grounding
// leakage), plus numbered/footnote refs like "[3]" / "[^2]". Only strips
// bracketed groups that clearly contain a domain or citation number, so
// ordinary prose (and parenthetical years like "(2005)") is untouched.
export function stripSourceCitations(input: string | null | undefined): string {
  if (!input) return '';
  return String(input)
    // [ … domain.tld … ] — any bracket group containing a domain-like token
    .replace(/\s*\[[^\]\n]*?\b[a-z0-9-]+\.[a-z]{2,}[^\]\n]*?\]/gi, '')
    // [1] / [1, 2, 3] — numbered citations (1–3 digits, so years like [2005] survive)
    .replace(/\s*\[\d{1,3}(?:\s*,\s*\d{1,3})*\]/g, '')
    // [^1] — markdown footnote refs
    .replace(/\s*\[\^\d+\]/g, '')
    // tidy space orphaned before punctuation, and doubled spaces
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .trim();
}

// Turns a raw scraped description into a clean, single-line AI-caption topic.
export function cleanDescription(input: string | null | undefined): string {
  if (!input) return '';
  const decoded = decodeHtmlEntities(String(input)).replace(/\r\n?/g, '\n');

  const kept: string[] = [];
  for (const rawLine of decoded.split('\n')) {
    let line = rawLine.trim();
    if (!line) continue;
    if (/^[\s\-–—_=*·•.]+$/.test(line)) continue; // pure separator

    line = line
      .replace(EMOJI_RE, '')
      .replace(/(^|\s)#[^\s#]+/g, '$1')          // hashtags (never prose)
      .replace(/(^|\s)@[A-Za-z0-9._]+/g, '$1')   // @handles (leaves the sentence)
      .replace(PROMO_RE, ' ')                     // promo / CTA phrases
      // tidy punctuation orphaned by the removals above
      .replace(/\s+([,;:.!?])/g, '$1')
      .replace(/([,;:.!?])(?:\s*[,;:.!?])+/g, '$1') // collapse orphaned runs (", ," → ",")
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s,;:.!?\-–—]+|[\s,;:\-–—]+$/g, '')
      .trim();

    // Keep the line only if something substantive survived (guards against
    // ever wiping real content to empty).
    if (line.replace(/[^A-Za-z0-9]/g, '').length < 3) continue;
    kept.push(line);
  }

  return kept.join(' ').replace(/\s+/g, ' ').trim();
}
