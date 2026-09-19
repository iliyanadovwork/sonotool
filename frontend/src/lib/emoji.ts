export interface EmojiDef {
  char: string;
  unified: string;
  name: string;
  keywords: string[];
  pinned?: boolean;
}

export const EMOJIS: EmojiDef[] = [
  { char: '😂', unified: '1f602', name: 'Face with Tears of Joy', keywords: ['laugh', 'lol', 'haha', 'crying laughing', 'funny'], pinned: true },
  { char: '🔥', unified: '1f525', name: 'Fire', keywords: ['lit', 'hot', 'flame', 'fire'], pinned: true },
  { char: '😀', unified: '1f600', name: 'Grinning Face', keywords: ['smile', 'happy', 'grin'] },
  { char: '😅', unified: '1f605', name: 'Grinning Face with Sweat', keywords: ['nervous', 'sweat', 'phew', 'laugh'] },
  { char: '🤣', unified: '1f923', name: 'Rolling on the Floor Laughing', keywords: ['rofl', 'lmao', 'laugh', 'funny'] },
  { char: '😍', unified: '1f60d', name: 'Smiling Face with Heart-Eyes', keywords: ['love', 'heart', 'crush', 'adore'] },
  { char: '😎', unified: '1f60e', name: 'Smiling Face with Sunglasses', keywords: ['cool', 'sunglasses', 'chill'] },
  { char: '🥳', unified: '1f973', name: 'Partying Face', keywords: ['party', 'celebrate', 'birthday'] },
  { char: '😭', unified: '1f62d', name: 'Loudly Crying Face', keywords: ['cry', 'sob', 'sad', 'tears'] },
  { char: '😱', unified: '1f631', name: 'Face Screaming in Fear', keywords: ['shock', 'omg', 'scared'] },
  { char: '🤔', unified: '1f914', name: 'Thinking Face', keywords: ['think', 'hmm', 'consider'] },
  { char: '💀', unified: '1f480', name: 'Skull', keywords: ['dead', 'dying', 'lol', 'skull'] },
  { char: '👀', unified: '1f440', name: 'Eyes', keywords: ['look', 'watching', 'eyes'] },
  { char: '🙏', unified: '1f64f', name: 'Folded Hands', keywords: ['pray', 'thanks', 'please'] },
  { char: '💪', unified: '1f4aa', name: 'Flexed Biceps', keywords: ['strong', 'muscle', 'flex'] },
  { char: '👏', unified: '1f44f', name: 'Clapping Hands', keywords: ['clap', 'applause', 'bravo'] },
  { char: '🙌', unified: '1f64c', name: 'Raising Hands', keywords: ['praise', 'celebrate', 'hooray'] },
  { char: '🤝', unified: '1f91d', name: 'Handshake', keywords: ['deal', 'agree', 'partner'] },
  { char: '🎉', unified: '1f389', name: 'Party Popper', keywords: ['party', 'celebrate', 'tada'] },
  { char: '💯', unified: '1f4af', name: 'Hundred Points', keywords: ['100', 'perfect', 'agree'] },
  { char: '🚀', unified: '1f680', name: 'Rocket', keywords: ['moon', 'launch', 'fast'] },
  { char: '📈', unified: '1f4c8', name: 'Chart Increasing', keywords: ['up', 'stocks', 'growth', 'gains'] },
  { char: '💰', unified: '1f4b0', name: 'Money Bag', keywords: ['money', 'cash', 'rich', 'profit'] },
  { char: '⚡', unified: '26a1', name: 'High Voltage', keywords: ['lightning', 'energy', 'fast'] },
];

export const emojiSrc = (unified: string) => `/emoji/${unified}.png`;

const CHAR_TO_UNIFIED = new Map(EMOJIS.map(e => [e.char, e.unified]));

export function emojiSrcForChar(char: string): string | null {
  const u = CHAR_TO_UNIFIED.get(char);
  return u ? emojiSrc(u) : null;
}

const EMOJI_CHARS = EMOJIS.map(e => e.char).sort((a, b) => b.length - a.length);

const imgCache = new Map<string, HTMLImageElement>();

export function getEmojiImage(char: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  const unified = CHAR_TO_UNIFIED.get(char);
  if (!unified) return null;
  let img = imgCache.get(unified);
  if (!img) {
    img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = emojiSrc(unified);
    imgCache.set(unified, img);
  }
  return img;
}

export function preloadEmojiImages(): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  return Promise.all(EMOJIS.map(e => new Promise<void>(resolve => {
    const img = getEmojiImage(e.char);
    if (!img || (img.complete && img.naturalWidth > 0)) return resolve();
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => resolve(), { once: true });
  }))).then(() => undefined);
}

export type EmojiToken = { type: 'text'; value: string } | { type: 'emoji'; value: string };

type Token = { t: 's'; v: string } | { t: 'e'; v: string };

function tokenize(str: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let buf = '';
  while (i < str.length) {
    let matched: string | null = null;
    for (const ch of EMOJI_CHARS) {
      if (str.startsWith(ch, i)) { matched = ch; break; }
    }
    if (matched) {
      if (buf) { tokens.push({ t: 's', v: buf }); buf = ''; }
      tokens.push({ t: 'e', v: matched });
      i += matched.length;
    } else {
      buf += str[i];
      i++;
    }
  }
  if (buf) tokens.push({ t: 's', v: buf });
  return tokens;
}

export function splitEmojiTokens(str: string): EmojiToken[] {
  return tokenize(str).map(t => t.t === 's'
    ? { type: 'text', value: t.v } as const
    : { type: 'emoji', value: t.v } as const);
}

const emojiAdvance = (size: number) => size * 1.1;

export function measureRichWidth(ctx: CanvasRenderingContext2D, str: string, emojiSize: number): number {
  let w = 0;
  for (const tok of tokenize(str)) {
    w += tok.t === 's' ? ctx.measureText(tok.v).width : emojiAdvance(emojiSize);
  }
  return w;
}

export function wrapRichText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  emojiSize: number,
): string[] {
  const out: string[] = [];
  const spaceW = ctx.measureText(' ').width;
  for (const para of text.split('\n')) {
    if (!para) { out.push(''); continue; }
    let cur = '';
    let curW = 0;
    for (const word of para.split(' ')) {
      const wordW = measureRichWidth(ctx, word, emojiSize);
      const addW = (cur ? spaceW : 0) + wordW;
      if (cur && curW + addW > maxWidth) {
        out.push(cur);
        cur = word;
        curW = wordW;
      } else {
        cur = cur ? `${cur} ${word}` : word;
        curW += addW;
      }
    }
    out.push(cur);
  }
  return out;
}

export function drawRichLine(
  ctx: CanvasRenderingContext2D,
  line: string,
  x: number,
  baselineY: number,
  emojiSize: number,
): void {
  let cursor = x;
  for (const tok of tokenize(line)) {
    if (tok.t === 's') {
      ctx.fillText(tok.v, cursor, baselineY);
      cursor += ctx.measureText(tok.v).width;
    } else {
      const adv = emojiAdvance(emojiSize);
      const img = getEmojiImage(tok.v);
      if (img && img.complete && img.naturalWidth > 0) {
        const left = cursor + (adv - emojiSize) / 2;
        const top = baselineY - emojiSize * 0.85;
        ctx.drawImage(img, left, top, emojiSize, emojiSize);
      } else {
        ctx.fillText(tok.v, cursor, baselineY);
      }
      cursor += adv;
    }
  }
}
