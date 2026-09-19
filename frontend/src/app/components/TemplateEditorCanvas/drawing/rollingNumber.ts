// Posts-local fork of frontend/src/lib/rollingNumber.ts (the Chart Reels canvas odometer that
// mimics @number-flow/react). Forked rather than shared for two reasons:
//  1. exact static parity — the original lays digits in uniform "0"-width cells (tabular), which
//     reads spread-out vs the chart header's proportional text. This fork lays every digit at its
//     NATURAL position in the string (substring-measured, kerning included), so at rest the
//     rendering is pixel-identical to a plain fillText of the same value.
//  2. merge safety — the lib file belongs to the reels branch; a modified copy at the same path
//     would add/add-conflict when both branches land in main.
//
// Mechanics are unchanged: per-digit vertical reels clipped to their glyph band, spring-driven
// (semi-implicit Euler, stiffness 190 / damping 24) with NumberFlow's overshoot-and-settle; the
// last digit rolls continuously and higher digits roll on carry. The reel value is ROUNDED to
// `decimals` (not floored) so the settled digits always equal the toFixed() static string.
// Deterministic for export when stepped with a fixed dt from a reset() instance.

type SlotState = { pos: number; vel: number };

export class RollingNumber {
  private groups = new Map<string, SlotState[]>();

  constructor(private stiffness = 190, private damping = 24) {}

  reset() { this.groups.clear(); }

  // Width this number will occupy — the string's natural width (matches draw()).
  measure(ctx: CanvasRenderingContext2D, value: number, decimals: number): number {
    return ctx.measureText((value > 0 ? value : 0).toFixed(decimals)).width;
  }

  // Integrate + draw `value` (>=0) to `decimals` as a spring-driven odometer.
  // Caller sets ctx.font + ctx.fillStyle. Left-anchored at (x, baseline) with the ALPHABETIC
  // baseline — i.e. drop-in for fillText(value.toFixed(decimals), x, baseline).
  // `dt` = seconds since last frame. Returns the drawn width (matches measure()).
  //
  // Every reel digit is rendered AS PART OF THE FULL STRING — a fillText of the string with just
  // that slot's character swapped, clipped to the slot's substring-measured span. Fonts shape and
  // space digits contextually (fillText("21.18") is not the sum of its isolated glyphs), so this
  // is the only layout that is correct by construction: at rest the slots tile together into the
  // EXACT pixels of a plain fillText, in any font. Because the prefix before a slot is unchanged
  // in its variants, every reel digit's left edge is exact mid-roll too.
  draw(
    ctx: CanvasRenderingContext2D,
    id: string,
    value: number,
    decimals: number,
    x: number,
    baseline: number,
    fontSize: number,
    dt: number,
  ): number {
    const v = value > 0 ? value : 0;
    const str = v.toFixed(decimals);
    // Rounded (like toFixed), NOT floored — so the settled reels match the static string exactly.
    const M = Math.round(v * Math.pow(10, decimals));
    const h = Math.max(0, Math.min(0.05, dt)); // clamp dt so the spring stays stable

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // Each character's true left edge + advance inside the full string (substring-measured).
    const offs: number[] = [];
    for (let i = 0; i < str.length; i++) offs.push(ctx.measureText(str.slice(0, i)).width);
    const total = ctx.measureText(str).width;
    const slotW = (i: number) => (i < str.length - 1 ? offs[i + 1] : total) - offs[i];

    // Vertical glyph band for the reel clip (digits above/below get hidden); padded so
    // antialiasing isn't shaved.
    const dm = ctx.measureText('0123456789');
    const asc = dm.actualBoundingBoxAscent || fontSize * 0.75;
    const desc = dm.actualBoundingBoxDescent || fontSize * 0.08;
    const cellH = fontSize;   // reel spacing between consecutive digits
    const vPad = fontSize * 0.12;
    const clipTop = baseline - asc - vPad;
    const clipH = asc + desc + vPad * 2;

    const totalDigits = (str.match(/\d/g) || []).length;
    let states = this.groups.get(id);
    if (!states) { states = []; this.groups.set(id, states); }

    let seen = 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      const cxL = x + offs[i];
      const w = slotW(i);
      if (ch >= '0' && ch <= '9') {
        const j = totalDigits - seen - 1; // exponent of this digit in M-space (rightmost = 0)
        seen++;
        const target = Math.floor(M / Math.pow(10, j)); // absolute reel position (steps +1 at carry)
        let st = states[j];
        if (!st) { st = states[j] = { pos: target, vel: 0 }; } // first appearance: no spin

        // semi-implicit Euler spring toward target
        const accel = this.stiffness * (target - st.pos) - this.damping * st.vel;
        st.vel += accel * h;
        st.pos += st.vel * h;

        ctx.save();
        ctx.beginPath();
        ctx.rect(cxL, clipTop, w, clipH);
        ctx.clip();
        const base = Math.floor(st.pos);
        for (let d = base - 1; d <= base + 2; d++) {
          const dd = ((d % 10) + 10) % 10;
          const yy = baseline + (d - st.pos) * cellH; // counting up => digits roll upward
          // The full string with only this slot's digit swapped — identical shaping/metrics to the
          // target string for everything up to and including this slot; the clip shows the slot.
          const variant = d === target
            ? str
            : str.slice(0, i) + String(dd) + str.slice(i + 1);
          ctx.fillText(variant, x, yy);
        }
        ctx.restore();
      } else {
        // Non-digit (the decimal point): draw the real string clipped to this slot's span.
        ctx.save();
        ctx.beginPath();
        ctx.rect(cxL, clipTop, w, clipH);
        ctx.clip();
        ctx.fillText(str, x, baseline);
        ctx.restore();
      }
    }

    return total;
  }
}
