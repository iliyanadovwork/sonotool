// ─────────────────────────────────────────────────────────────────────────────
// Fetch anything: page text and element screenshots, through a real browser.
//
// Why this exists. Two classes of source kept blocking post research:
//   1. Cloudflare / bot-walled pages (Album of the Year returned 403 to every
//      curl and WebFetch attempt), so a real fan-reaction thread could not be
//      quoted or captured.
//   2. Artifacts that only exist as rendered pages — an X post, a comment thread,
//      a chart on someone else's site — where the EVIDENCE is how it looks, not
//      the text behind it.
// A headless browser clears both: it executes JS, carries a real UA, solves the
// passive bot checks, and can screenshot one element as a publishable asset.
//
// This is deliberately NOT a scraper for bulk extraction. It fetches the specific
// artifact a post is reporting on, which is the same editorial use as screenshotting
// the news you are covering. Respect robots/ToS for anything beyond that.
//
// Usage:
//   npx tsx scripts/capture.ts --url <url> [--out shot.png] [--selector "css"]
//                              [--text] [--links [substr]] [--dark] [--full-page] [--wait 2500]
//                              [--click 'button:has-text("I Accept")'  → dismiss a cookie wall first;
//                                        pass several separated by | and the first that exists is clicked]
//                              [--width 1400] [--height 900] [--scale 2]
//
//   # the whole page as text (for reading a walled article/thread)
//   npx tsx scripts/capture.ts --url https://example.com/thread --text
//
//   # one element as a publishable screenshot
//   npx tsx scripts/capture.ts --url https://x.com/user/status/123 \
//     --selector 'article' --out post.png --scale 2
//
// Node-only. Uses relative imports so `tsx` resolves them without the Next alias.
// ─────────────────────────────────────────────────────────────────────────────

import { writeFile } from 'node:fs/promises';
import { chromium, type Browser, type Page } from 'playwright';

interface Args {
  url: string;
  out?: string;
  selector?: string;
  text: boolean;
  fullPage: boolean;
  waitMs: number;
  width: number;
  height: number;
  scale: number;
  links?: string | true;
  dark: boolean;
  click?: string;
}

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else { flags[key] = next; i++; }
  }
  const str = (k: string): string | undefined => (typeof flags[k] === 'string' ? (flags[k] as string) : undefined);
  const num = (k: string, dflt: number): number => {
    const v = str(k);
    if (v === undefined) return dflt;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`--${k} must be a positive number (got ${JSON.stringify(v)})`);
    return n;
  };
  const url = str('url');
  if (!url) throw new Error('capture: --url is required');
  if (!/^https?:\/\//i.test(url)) throw new Error(`capture: --url must be http(s) (got ${JSON.stringify(url)})`);
  return {
    url,
    out: str('out'),
    selector: str('selector'),
    text: flags.text === true || flags.text === 'true',
    fullPage: flags['full-page'] === true || flags['full-page'] === 'true',
    waitMs: num('wait', 2500),
    width: num('width', 1400),
    height: num('height', 1000),
    scale: num('scale', 2),
    links: flags.links === true ? true : str('links'),
    // Cookie/consent walls dim or cover the article on a huge share of news sites,
    // which silently ruins a capture: you get a greyed-out page instead of the
    // artifact. Clicking the accept button first is the difference between a
    // usable source screenshot and a wasted fetch.
    click: str('click'),
    // Sites that honour prefers-color-scheme render dark for us, which matters when
    // the screenshot is going onto a dark slide: a white card fights the design.
    dark: flags.dark === true || flags.dark === 'true',
  };
}

// A stock headless browser announces itself in ways passive bot checks look for.
// These are the cheap, standard mitigations — a real UA, a real viewport, a
// language header, and hiding navigator.webdriver. Nothing here defeats an actual
// challenge page; if a site genuinely blocks us we report that rather than escalate.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function openPage(browser: Browser, a: Args): Promise<Page> {
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: a.width, height: a.height },
    deviceScaleFactor: a.scale,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    colorScheme: a.dark ? 'dark' : 'light',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  return ctx.newPage();
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  if (!a.text && !a.out && a.links === undefined) {
    throw new Error('capture: pass --out <file.png> to screenshot, --text to dump text, --links [filter] to list hrefs');
  }

  const browser = await chromium.launch();
  try {
    const page = await openPage(browser, a);
    const res = await page.goto(a.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const status = res?.status() ?? 0;
    // Let client-rendered content settle. networkidle hangs on pages that poll,
    // so prefer an explicit wait we control.
    await page.waitForTimeout(a.waitMs);

    // Dismiss a consent wall if one was named. Best-effort: a missing button is
    // the normal case on sites that never showed one, not an error.
    if (a.click) {
      for (const sel of a.click.split('|')) {
        try {
          await page.locator(sel.trim()).first().click({ timeout: 4000 });
          await page.waitForTimeout(1200);
          break;
        } catch { /* not present — try the next selector */ }
      }
    }

    const title = await page.title().catch(() => '');
    const out: Record<string, unknown> = { ok: true, url: a.url, status, title };

    // A challenge page returns 200 with a body that is not the article. Say so
    // rather than handing back a screenshot of a bot-check as if it were evidence.
    const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
    const walled = /just a moment|checking your browser|verify you are human|enable javascript and cookies/i.test(bodyText.slice(0, 800));
    if (walled) out.warning = 'This looks like a bot-check page, not the content. The capture below is of the challenge screen.';

    if (a.selector) {
      const el = page.locator(a.selector).first();
      const count = await page.locator(a.selector).count();
      if (count === 0) throw new Error(`capture: --selector ${JSON.stringify(a.selector)} matched nothing on the page`);
      out.selectorMatches = count;
      if (a.out) { await el.screenshot({ path: a.out }); out.out = a.out; }
      if (a.text) out.text = (await el.innerText()).trim();
    } else {
      if (a.out) { await page.screenshot({ path: a.out, fullPage: a.fullPage }); out.out = a.out; }
      if (a.text) out.text = bodyText.trim();
    }

    // --links turns this into a navigator. Without hrefs you can read a search
    // results page but not follow it, which leaves you guessing URL shapes — the
    // whole point is to reach a specific artifact without a search engine.
    if (a.links !== undefined) {
      const needle = typeof a.links === 'string' ? a.links.toLowerCase() : '';
      const anchors = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]')).map(el => ({
          text: (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
          href: (el as HTMLAnchorElement).href,
        })));
      const seen = new Set<string>();
      out.links = anchors
        .filter(l => l.href && !seen.has(l.href) && (seen.add(l.href), true))
        .filter(l => !needle || l.href.toLowerCase().includes(needle) || l.text.toLowerCase().includes(needle))
        .slice(0, 60);
    }

    if (typeof out.text === 'string' && out.text.length > 20_000) {
      out.text = `${(out.text as string).slice(0, 20_000)}\n…[truncated at 20000 chars]`;
    }
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  console.error('ERROR:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
