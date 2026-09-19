// Client-safe per-IG-page registry. NO secrets — distinct from the OAuth-app
// registry in instagram-apps.ts (keyed by app slug, used only at connect time).
// This maps a CONNECTED IG page (by username) to its Google Sheet tab + on-video
// overlay style, replacing the old manual brand toggle + manual sheet inputs.

export type BrandMode = 'sonotrade' | 'sonotradeio' | 'empty';

// The single spreadsheet all four pages live in today. Supplied by the
// environment so no workspace identifier is committed; this registry stays
// the single source for which tab each page maps to.
export const SHARED_SPREADSHEET_ID =
  process.env.NEXT_PUBLIC_SHARED_SPREADSHEET_ID ?? '';

export interface PageConfig {
  sheetName: string;     // Google Sheet TAB for this page (within spreadsheetId)
  brandMode: BrandMode;  // drives the TikTokCanvas overlay props
  spreadsheetId: string; // spreadsheet the tab lives in (all four share one today)
  label: string;         // page-picker label
}

// Keyed by LOWERCASED IG username (igUser.username.toLowerCase()). Only
// sonotradehq carries an overlay; the other three post with none. The
// 'sonotradeio' BrandMode style is intentionally kept in the code (see
// TikTokCanvas overlay ternaries) but no page maps to it — "kept but unexposed".
export const PAGE_CONFIGS: Record<string, PageConfig> = {
  sonotradehq:  { sheetName: 'SonotradeHQ', brandMode: 'sonotrade', spreadsheetId: SHARED_SPREADSHEET_ID, label: 'SonotradeHQ' },
  sonotradeio:  { sheetName: 'sonotradeio', brandMode: 'empty',     spreadsheetId: SHARED_SPREADSHEET_ID, label: 'sonotradeio' },
  'sono.clips': { sheetName: 'sono.clips',  brandMode: 'empty',     spreadsheetId: SHARED_SPREADSHEET_ID, label: 'sono.clips'  },
  sonomediahd:  { sheetName: 'sonomediahd', brandMode: 'empty',     spreadsheetId: SHARED_SPREADSHEET_ID, label: 'sonomediahd' },
};

// ---------------------------------------------------------------------------
// Templates: the selectable LOOKS a page can render with.
//
// PAGE_CONFIGS above decides where a page's rows come from (sheet tab) and which
// look it OPENS on. This registry adds the looks a user may switch to by hand in
// the post view. Sheet targeting is deliberately not part of a template — a page
// has one content queue, rendered however you choose.
//
// Invariant: templates[0] is the DEFAULT and MUST equal that page's brandMode
// above. A page always opens on its default; a second template is opt-in per
// session and never applies automatically. That is what keeps the old guarantee
// ("never stamp SonotradeHQ branding on a page by accident") intact even now
// that sonotradeio can carry it deliberately.
export interface PageTemplate {
  id: string;           // stable key — persists the picker selection
  label: string;        // shown in the post-view picker
  brandMode: BrandMode; // drives the TikTokCanvas overlay props
  // Optional overrides of the identity the brand implies. Needed because two
  // pages can share a brand yet want different lockup text — sonotradeio's
  // branded template reads "Sonotrade Media" while SonotradeHQ's stays
  // "Sonotrade". Omitted fields fall back to brandOverlay() below.
  overlayLogoSrc?: string;
  overlayDisplayName?: string;
  overlayHandle?: string;
}

/** The on-video lockup a brand mode implies, before any template override. */
export interface OverlayIdentity {
  logoSrc: string;
  displayName: string;
  handle: string;
}

// Single source of truth for the lockup. This used to live as three inline
// ternaries on the TikTokCanvas props in VideoReelsSection, which meant every
// page sharing a brand was stuck with the same name and handle.
export function brandOverlay(brand: BrandMode): OverlayIdentity {
  if (brand === 'empty') return { logoSrc: '', displayName: '', handle: '' };
  if (brand === 'sonotradeio') {
    return { logoSrc: '/sonotrade-glyph-square.png', displayName: 'Sonotrade', handle: '@Sonotradeio' };
  }
  return { logoSrc: '/templatelogo.png', displayName: 'Sonotrade', handle: '@SonotradeHQ' };
}

/** Resolve a template's final lockup: its brand's identity plus any overrides. */
export function templateOverlay(t: PageTemplate): OverlayIdentity {
  const base = brandOverlay(t.brandMode);
  return {
    logoSrc: t.overlayLogoSrc ?? base.logoSrc,
    displayName: t.overlayDisplayName ?? base.displayName,
    handle: t.overlayHandle ?? base.handle,
  };
}

const CLEAN_TEMPLATE: PageTemplate = { id: 'clean', label: 'No overlay', brandMode: 'empty' };

export const PAGE_TEMPLATES: Record<string, PageTemplate[]> = {
  sonotradehq: [{ id: 'sonotrade', label: 'Sonotrade overlay', brandMode: 'sonotrade' }],
  sonotradeio: [
    CLEAN_TEMPLATE,
    // The SonotradeHQ look (same /templatelogo.png) with its own identity:
    // "Sonotrade Media" over @Sonotrade. Both are per-template overrides, so
    // SonotradeHQ's own template keeps "Sonotrade" / @SonotradeHQ untouched.
    {
      id: 'sonotrade-hq',
      label: 'Sonotrade Media overlay',
      brandMode: 'sonotrade',
      overlayDisplayName: 'Sonotrade Media',
      overlayHandle: '@Sonotrade',
    },
  ],
  'sono.clips': [CLEAN_TEMPLATE],
  sonomediahd: [CLEAN_TEMPLATE],
};

/** Templates a page can render with, in picker order. [0] is the default. */
export function getPageTemplates(username: string | null | undefined): PageTemplate[] {
  const key = (username ?? '').trim().toLowerCase();
  return PAGE_TEMPLATES[key] ?? [CLEAN_TEMPLATE];
}

/** Resolve a template id for a page, falling back to that page's default. */
export function getTemplate(
  username: string | null | undefined,
  templateId: string | null | undefined,
): PageTemplate {
  const list = getPageTemplates(username);
  return list.find((t) => t.id === templateId) ?? list[0];
}

// Fallback for a username not in the registry: NO overlay (never stamp
// SonotradeHQ branding onto an unknown account's reels) + tab-name = the username
// itself (matches the convention where the three non-hq tabs equal the username,
// so a newly-added page whose tab is named after it "just works" without a code
// change). If that tab doesn't exist the Sheets tools simply find no rows —
// harmless; posting still works.
export function getPageConfig(username: string | null | undefined): PageConfig {
  const key = (username ?? '').trim().toLowerCase();
  return (
    PAGE_CONFIGS[key] ?? {
      sheetName: key || 'SonotradeHQ',
      brandMode: 'empty',
      spreadsheetId: SHARED_SPREADSHEET_ID,
      label: username || 'Instagram',
    }
  );
}
