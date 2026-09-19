// Free supplemental news source. Google News RSS — no auth, no meaningful rate
// limit, indexes most news sites worldwide. XML parsed by hand.

export interface GNewsArticle {
  title: string;
  link: string;
  description: string | null;
  pubDate: string | null;
  source_id: string | null;
}

const FEED_BASE = 'https://news.google.com/rss/search';

export async function searchGoogleNews(opts: {
  q: string;
  timeframeHours?: number;
}): Promise<GNewsArticle[]> {
  const url = new URL(FEED_BASE);
  url.searchParams.set('q', opts.q);
  url.searchParams.set('hl', 'en-US');
  url.searchParams.set('gl', 'US');
  url.searchParams.set('ceid', 'US:en');

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PauvApp/1.0)' },
  });
  if (!res.ok) throw new Error(`google news ${res.status}: ${await res.text()}`);
  const xml = await res.text();

  const items = parseItems(xml);
  const cutoffMs = opts.timeframeHours
    ? Date.now() - opts.timeframeHours * 3_600_000
    : null;

  const articles: GNewsArticle[] = [];
  for (const it of items) {
    if (cutoffMs !== null && it.pubDate) {
      const t = Date.parse(it.pubDate);
      if (Number.isFinite(t) && t < cutoffMs) continue;
    }
    articles.push({
      title: it.title,
      link: it.link,
      description: it.description,
      pubDate: it.pubDate,
      source_id: it.source ?? null,
    });
  }
  return articles;
}

// ---- minimal RSS parser ----

interface RawItem {
  title: string;
  link: string;
  description: string | null;
  pubDate: string | null;
  source: string | null;
}

function parseItems(xml: string): RawItem[] {
  const out: RawItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];
    out.push({
      title: decodeXml(stripCdata(extractTag(block, 'title'))) ?? '',
      link: decodeXml(stripCdata(extractTag(block, 'link'))) ?? '',
      description: decodeXml(stripCdata(extractTag(block, 'description'))) ?? null,
      pubDate: stripCdata(extractTag(block, 'pubDate')) ?? null,
      source: decodeXml(stripCdata(extractTag(block, 'source'))) ?? null,
    });
  }
  return out.filter(it => it.title && it.link);
}

function extractTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`);
  const m = re.exec(block);
  return m ? m[1].trim() : null;
}

function stripCdata(s: string | null): string | null {
  if (s === null) return null;
  const m = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(s);
  return m ? m[1] : s;
}

function decodeXml(s: string | null): string | null {
  if (s === null) return null;
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}
