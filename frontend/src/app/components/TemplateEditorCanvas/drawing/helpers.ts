import type { CarouselTextAlign, CarouselFontLabel, CarouselFontWeight, TagStyle } from '../../templateEditorTypes';

// Browser-only: ensures a font is ready before drawing. Google fonts get a stylesheet <link>;
// custom (uploaded) fonts are pre-registered as FontFaces, so we just await document.fonts.load.
export async function ensureFontLoaded(font: { label: string; css: string; google: string | null }, weight: number, italic: boolean) {
  if (font.google) {
    const id = `gfont-${font.label.replace(/\s+/g, '-')}`;
    if (!document.getElementById(id)) {
      const link = document.createElement('link');
      link.id = id; link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
      document.head.appendChild(link);
    }
  }
  try { await document.fonts.load(`${italic ? 'italic' : 'normal'} ${weight} 40px ${font.css}`); } catch { /* fall back silently */ }
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) { lines.push(current); current = word; }
    else current = test;
  }
  if (current) lines.push(current);
  return lines;
}

export function drawAligned(
  ctx: CanvasRenderingContext2D, line: string, y: number, isLast: boolean,
  align: CarouselTextAlign, paddingX: number, maxW: number, canvasW: number,
) {
  if (align === 'justify' && !isLast) {
    const words = line.split(' ');
    if (words.length > 1) {
      const totalW = words.reduce((s, w) => s + ctx.measureText(w).width, 0);
      const gap = (maxW - totalW) / (words.length - 1);
      let x = paddingX;
      ctx.textAlign = 'left';
      for (const word of words) { ctx.fillText(word, x, y); x += ctx.measureText(word).width + gap; }
      return;
    }
  }
  if (align === 'center')     { ctx.textAlign = 'center'; ctx.fillText(line, canvasW / 2, y); }
  else if (align === 'right') { ctx.textAlign = 'right';  ctx.fillText(line, canvasW - paddingX, y); }
  else                        { ctx.textAlign = 'left';   ctx.fillText(line, paddingX, y); }
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const cr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + cr, y);
  ctx.lineTo(x + w - cr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + cr);
  ctx.lineTo(x + w, y + h - cr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - cr, y + h);
  ctx.lineTo(x + cr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - cr);
  ctx.lineTo(x, y + cr);
  ctx.quadraticCurveTo(x, y, x + cr, y);
  ctx.closePath();
}

export function drawTag(
  ctx: CanvasRenderingContext2D,
  text: string,
  slotX: number, slotY: number, slotW: number, slotH: number,
  halign: 'left' | 'center' | 'right',
  valign: 'top' | 'center' | 'bottom',
  ts: TagStyle,
  fontCss: string,
  pxScale = 1,
) {
  ctx.save();
  const fs  = Math.round(ts.fontSize    * pxScale);
  const px  = Math.round(ts.paddingX    * pxScale);
  const py  = Math.round(ts.paddingY    * pxScale);
  const bw  = ts.borderWidth > 0 ? Math.max(1, Math.round(ts.borderWidth * pxScale)) : 0;
  const cr  = Math.round(ts.cornerRadius * pxScale);
  const tc  = ts.textCase ?? 'none';
  const displayText = tc === 'upper' ? text.toUpperCase() : text;
  const variant = tc === 'smallcaps' ? 'small-caps ' : '';
  const fontStr = `${ts.italic ? 'italic ' : ''}${variant}${ts.fontWeight} ${fs}px ${fontCss}`;
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
    `${((ts.letterSpacing ?? 0) * pxScale).toFixed(2)}px`;
  ctx.font = fontStr;
  const textW = ctx.measureText(displayText).width;
  const boxW  = Math.round(textW + px * 2);
  const boxH  = Math.round(fs * 1.2 + py * 2);
  const bx    = halign === 'left' ? slotX : halign === 'right' ? slotX + slotW - boxW : Math.round(slotX + (slotW - boxW) / 2);
  const by    = valign === 'top'  ? slotY : valign === 'bottom' ? slotY + slotH - boxH : Math.round(slotY + (slotH - boxH) / 2);

  if (ts.bgOpacity > 0) {
    ctx.fillStyle = hexToRgba(ts.bgColor, ts.bgOpacity / 100);
    if (cr > 0) { roundRectPath(ctx, bx, by, boxW, boxH, cr); ctx.fill(); }
    else { ctx.fillRect(bx, by, boxW, boxH); }
  }
  if (bw > 0 && ts.borderOpacity > 0) {
    ctx.strokeStyle = hexToRgba(ts.borderColor, ts.borderOpacity / 100);
    ctx.lineWidth = bw;
    const inset = bw / 2;
    if (cr > 0) { roundRectPath(ctx, bx + inset, by + inset, boxW - bw, boxH - bw, cr); ctx.stroke(); }
    else { ctx.strokeRect(bx + inset, by + inset, boxW - bw, boxH - bw); }
  }
  ctx.fillStyle = ts.textColor;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = fontStr;
  ctx.fillText(displayText, bx + px, by + boxH / 2);
  ctx.restore();
}

export function drawLogoFit(
  ctx: CanvasRenderingContext2D, img: HTMLImageElement,
  x: number, y: number, maxW: number, maxH: number,
  halign: 'left' | 'center' | 'right' = 'center',
  valign: 'top' | 'center' | 'bottom' = 'center',
  scale = 100,
  cornerRadius = 0,
) {
  const fitS = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
  const dw = img.naturalWidth  * fitS * (scale / 100);
  const dh = img.naturalHeight * fitS * (scale / 100);
  const dx = halign === 'left' ? x : halign === 'right' ? x + maxW - dw : x + (maxW - dw) / 2;
  const dy = valign === 'top'  ? y : valign === 'bottom' ? y + maxH - dh : y + (maxH - dh) / 2;
  if (cornerRadius > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(dx, dy, dw, dh, cornerRadius);
    ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(img, dx, dy, dw, dh);
  }
}
