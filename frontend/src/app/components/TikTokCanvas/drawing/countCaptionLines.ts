import {
  CANVAS_W, HEADER_PADDING_X, CAPTION_LINE_HEIGHT,
  SONOTRADE_CAPTION_MAX_W, SONOTRADE_CAPTION_FONT,
} from '../constants';

const CLEAN_FONT = '400 42px Chirp, "Comic Sans MS", cursive';
const CLEAN_MAX_W = CANVAS_W - (HEADER_PADDING_X + 43) * 2;

export const SONOTRADE_CAP_FONT = `400 42px ${SONOTRADE_CAPTION_FONT}`;

export function countCaptionLines(
  ctx: CanvasRenderingContext2D,
  overlayCaption: string,
  font = CLEAN_FONT,
  maxWidth = CLEAN_MAX_W,
): number {
  if (!overlayCaption) return 0;

  ctx.font = font;

  const userLines = overlayCaption.split('\n');
  let total = 0;

  for (const userLine of userLines) {
    if (!userLine) { total++; continue; }
    let line = '';
    let lineCount = 1;
    for (const word of userLine.split(' ')) {
      const test = line + word + ' ';
      if (ctx.measureText(test).width > maxWidth && line) {
        lineCount++;
        line = word + ' ';
      } else {
        line = test;
      }
    }
    total += lineCount;
  }

  return total;
}

export function countSonotradeCaptionLines(
  ctx: CanvasRenderingContext2D,
  overlayCaption: string,
): number {
  return countCaptionLines(ctx, overlayCaption, SONOTRADE_CAP_FONT, SONOTRADE_CAPTION_MAX_W);
}
