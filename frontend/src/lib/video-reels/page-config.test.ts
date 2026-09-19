import { describe, it, expect } from 'vitest';
import {
  getPageConfig,
  getPageTemplates,
  getTemplate,
  templateOverlay,
  brandOverlay,
  PAGE_CONFIGS,
  PAGE_TEMPLATES,
  SHARED_SPREADSHEET_ID,
} from './page-config';

describe('getPageConfig', () => {
  it('maps sonotradehq to the SonotradeHQ tab with the sonotrade overlay', () => {
    const cfg = getPageConfig('sonotradehq');
    expect(cfg.sheetName).toBe('SonotradeHQ');
    expect(cfg.brandMode).toBe('sonotrade');
    expect(cfg.spreadsheetId).toBe(SHARED_SPREADSHEET_ID);
  });

  it('maps the three non-hq pages to their own tab with NO overlay', () => {
    for (const username of ['sonotradeio', 'sono.clips', 'sonomediahd']) {
      const cfg = getPageConfig(username);
      expect(cfg.sheetName).toBe(username); // tab named after the page
      expect(cfg.brandMode).toBe('empty');  // no on-video overlay
      expect(cfg.spreadsheetId).toBe(SHARED_SPREADSHEET_ID);
    }
  });

  it('is case-insensitive on the username', () => {
    expect(getPageConfig('SonoTradeHQ').brandMode).toBe('sonotrade');
    expect(getPageConfig('SONO.CLIPS').sheetName).toBe('sono.clips');
  });

  it('trims surrounding whitespace', () => {
    expect(getPageConfig('  sonotradehq  ').sheetName).toBe('SonotradeHQ');
  });

  it('falls back for an unknown page: NO overlay + tab = the username itself', () => {
    const cfg = getPageConfig('somenewpage');
    expect(cfg.brandMode).toBe('empty'); // never stamp SonotradeHQ branding on an unknown page
    expect(cfg.sheetName).toBe('somenewpage');
    expect(cfg.spreadsheetId).toBe(SHARED_SPREADSHEET_ID);
  });

  // Narrowed deliberately: sonotradeio can now carry the SonotradeHQ overlay, but
  // only when a user picks that template by hand. What must still never happen is
  // a page DEFAULTING into another page's branding.
  it('never DEFAULTS to the sonotrade overlay for anything but sonotradehq', () => {
    for (const key of Object.keys(PAGE_CONFIGS)) {
      if (key !== 'sonotradehq') expect(PAGE_CONFIGS[key].brandMode).not.toBe('sonotrade');
    }
    expect(getPageConfig('random').brandMode).not.toBe('sonotrade');
  });

  it('handles null/undefined/empty without throwing (empty-overlay default)', () => {
    for (const v of [null, undefined, '']) {
      const cfg = getPageConfig(v);
      expect(cfg.brandMode).toBe('empty');
      expect(cfg.spreadsheetId).toBe(SHARED_SPREADSHEET_ID);
    }
  });

  it('opens every page on a default template matching its brandMode', () => {
    // The picker resets to templates[0] on each page change, so a drift here would
    // silently render a page with the wrong overlay.
    for (const key of Object.keys(PAGE_CONFIGS)) {
      expect(getPageTemplates(key)[0].brandMode).toBe(PAGE_CONFIGS[key].brandMode);
    }
  });

  it('gives sonotradeio a second, opt-in template based on SonotradeHQ', () => {
    const templates = getPageTemplates('sonotradeio');
    expect(templates).toHaveLength(2);
    expect(templates[0].brandMode).toBe('empty');           // default stays clean
    expect(templates[1].brandMode).toBe('sonotrade');       // same brand as HQ
    expect(templates[1].brandMode).toBe(PAGE_CONFIGS.sonotradehq.brandMode);
  });

  it('gives the sonotradeio branded template its own name and handle', () => {
    const io = templateOverlay(getTemplate('sonotradeio', 'sonotrade-hq'));
    expect(io.displayName).toBe('Sonotrade Media');
    expect(io.handle).toBe('@Sonotrade');         // not @SonotradeHQ
    expect(io.logoSrc).toBe('/templatelogo.png'); // but the same logo as HQ
  });

  it('leaves the SonotradeHQ lockup untouched by that override', () => {
    // The whole point of per-template overrides: renaming one page's lockup must
    // not rename every page sharing the brand.
    const hq = templateOverlay(getTemplate('sonotradehq', null));
    expect(hq.displayName).toBe('Sonotrade');
    expect(hq.handle).toBe('@SonotradeHQ');
    expect(hq.logoSrc).toBe('/templatelogo.png');
  });

  it('renders no lockup at all for a clean template', () => {
    for (const page of ['sonotradeio', 'sono.clips', 'sonomediahd']) {
      const o = templateOverlay(getTemplate(page, null));
      expect(o).toEqual({ logoSrc: '', displayName: '', handle: '' });
    }
  });

  it('brandOverlay keeps the dormant sonotradeio brand style intact', () => {
    expect(brandOverlay('sonotradeio')).toEqual({
      logoSrc: '/sonotrade-glyph-square.png',
      displayName: 'Sonotrade',
      handle: '@Sonotradeio',
    });
    expect(brandOverlay('empty')).toEqual({ logoSrc: '', displayName: '', handle: '' });
  });

  it('leaves the other pages single-template', () => {
    for (const key of ['sonotradehq', 'sono.clips', 'sonomediahd']) {
      expect(getPageTemplates(key)).toHaveLength(1);
    }
    expect(getPageTemplates('somenewpage')).toHaveLength(1);
  });

  it('getTemplate falls back to the page default for an unknown or missing id', () => {
    expect(getTemplate('sonotradeio', 'sonotrade-hq').brandMode).toBe('sonotrade');
    // A stale id from another page must not leave a foreign brand applied.
    expect(getTemplate('sonotradeio', 'nope').brandMode).toBe('empty');
    expect(getTemplate('sonotradeio', null).brandMode).toBe('empty');
    expect(getTemplate('sono.clips', 'sonotrade-hq').brandMode).toBe('empty');
  });

  it('exposes a template list for every configured page', () => {
    for (const key of Object.keys(PAGE_CONFIGS)) expect(PAGE_TEMPLATES[key]).toBeDefined();
  });
});
