import {
  BASE_HEADER_HEIGHT,
  CAPTION_LINE_HEIGHT,
  CAPTION_TOP_PADDING,
  HEADER_PADDING_X,
  HEADER_PADDING_TOP,
  SONOTRADE_AVATAR_SIZE,
  SONOTRADE_TEXT_X,
  SONOTRADE_CAPTION_MAX_W,
  VERIFIED_TICK_SVG,
} from '../constants';
import type { DrawHeaderOptions } from '../types';
import { countSonotradeCaptionLines, SONOTRADE_CAP_FONT } from './countCaptionLines';

const CHIRP = 'Chirp, "Twitter Chirp", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

// Proportionally matches X's shape-square-rx-16 (16px on 40px = 40% corner radius)
const AVATAR_SIZE = SONOTRADE_AVATAR_SIZE;           // 108
const AVATAR_RADIUS = 16;
const TEXT_X_OFFSET = SONOTRADE_TEXT_X;              // 168 from canvas left

// Scaled from Twitter's 15px @ ~390px content width → 1080px canvas
const NAME_SIZE = 42;
const HANDLE_SIZE = 40;
// Baseline gap between name and handle rows (tight like Twitter)
const NAME_HANDLE_LINE_H = 52;

// Tweet body (caption): same size as display name
const CAP_SIZE = 42;
// Gap from handle baseline to first caption line top
const CAP_GAP = 24;

export function drawHeaderOnContext({
  ctx,
  cx,
  cy,
  cw,
  overlayCaption,
  overlayLogoSrc,
  overlayDisplayName,
  overlayHandle,
  overlayVerified,
  logoImgRef,
  verifiedImgRef,
}: DrawHeaderOptions): number {
  const captionLines = countSonotradeCaptionLines(ctx, overlayCaption);
  const CAPTION_BOTTOM_OFFSET = 18;
  const headerHeight = overlayCaption
    ? BASE_HEADER_HEIGHT + CAPTION_TOP_PADDING + (captionLines * CAPTION_LINE_HEIGHT) - CAPTION_BOTTOM_OFFSET
    : BASE_HEADER_HEIGHT;

  // ── Background ──────────────────────────────────────────────────────────────
  ctx.fillStyle = '#000';
  ctx.fillRect(cx, cy, cw, headerHeight);

  // ── Avatar ──────────────────────────────────────────────────────────────────
  const avatarX = cx + HEADER_PADDING_X;
  const avatarY = cy + HEADER_PADDING_TOP;

  let logo = logoImgRef.current;
  if (!logo) {
    logo = new Image();
    logo.crossOrigin = 'anonymous';
    logo.src = overlayLogoSrc;
    logoImgRef.current = logo;
  }

  if (logo.complete && logo.naturalWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE, AVATAR_RADIUS);
    ctx.closePath();
    ctx.clip();
    // object-fit: cover — scale to fill, crop center
    const iw = logo.naturalWidth;
    const ih = logo.naturalHeight;
    const scale = Math.max(AVATAR_SIZE / iw, AVATAR_SIZE / ih);
    const sw = AVATAR_SIZE / scale;
    const sh = AVATAR_SIZE / scale;
    const sx = (iw - sw) / 2;
    const sy = (ih - sh) / 2;
    ctx.drawImage(logo, sx, sy, sw, sh, avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE);
    ctx.restore();
  }

  // ── Right column: Name + Handle (stacked, vertically centered in avatar) ────
  const blockH = NAME_SIZE + (NAME_HANDLE_LINE_H - NAME_SIZE) + HANDLE_SIZE;
  const blockTop = avatarY + (AVATAR_SIZE - blockH) / 2;

  const nameBaseline = blockTop + NAME_SIZE;
  const handleBaseline = nameBaseline + (NAME_HANDLE_LINE_H - NAME_SIZE) + HANDLE_SIZE;

  // Display name — 700 weight, near-white
  ctx.font = `700 ${NAME_SIZE}px ${CHIRP}`;
  ctx.fillStyle = 'rgb(231, 233, 234)';
  ctx.fillText(overlayDisplayName, TEXT_X_OFFSET, nameBaseline);
  const nameWidth = ctx.measureText(overlayDisplayName).width;

  // Gold verified badge — inline immediately after name, centered on cap-height
  if (overlayVerified) {
    const BADGE = 34;
    const badgeX = TEXT_X_OFFSET + nameWidth + 6;
    // Cap-height ≈ 70% of font size; center badge on that visual midpoint
    const capMid = nameBaseline - Math.round(NAME_SIZE * 0.35);
    const badgeY = capMid - BADGE / 2;
    let img = verifiedImgRef.current;
    if (!img) {
      img = new Image();
      img.src = `data:image/svg+xml;utf8,${encodeURIComponent(VERIFIED_TICK_SVG)}`;
      verifiedImgRef.current = img;
    }
    if (img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, badgeX, badgeY, BADGE, BADGE);
    }
  }

  // @handle — 400 weight, gray
  ctx.font = `400 ${HANDLE_SIZE}px ${CHIRP}`;
  ctx.fillStyle = 'rgb(113, 118, 123)';
  ctx.fillText(overlayHandle, TEXT_X_OFFSET, handleBaseline);

  // ── Tweet body (caption) — full width, starts at avatar left edge ──────────
  if (overlayCaption) {
    const captionX = cx + HEADER_PADDING_X;
    const captionBaseline = handleBaseline + CAP_GAP + CAP_SIZE;

    ctx.font = SONOTRADE_CAP_FONT;
    ctx.fillStyle = 'rgb(231, 233, 234)';

    let y = captionBaseline;
    for (const userLine of overlayCaption.split('\n')) {
      if (!userLine) { y += CAPTION_LINE_HEIGHT; continue; }
      let line = '';
      for (const word of userLine.split(' ')) {
        const test = line + word + ' ';
        if (ctx.measureText(test).width > SONOTRADE_CAPTION_MAX_W && line) {
          ctx.fillText(line.trimEnd(), captionX, y);
          line = word + ' ';
          y += CAPTION_LINE_HEIGHT;
        } else {
          line = test;
        }
      }
      ctx.fillText(line.trimEnd(), captionX, y);
      y += CAPTION_LINE_HEIGHT;
    }
  }

  return headerHeight;
}
