// Canvas "rolling number" that mimics @number-flow/react inside the Chart Reels canvas.
// NumberFlow is a DOM component and can't be captured into the MP4 export (the export
// rasterizes the canvas), so we recreate its look on the canvas: each digit sits on a
// vertical reel and SPRINGS to its new value (with a little overshoot) — NumberFlow's
// signature — spinning through intermediate digits when it jumps.
//
// Digits are laid out in uniform cells (each as wide as "0") and centered, so the reel
// stays aligned even with a proportional sans-serif font (system digits aren't fixed-width).
//
// Stateful: the spring is integrated per digit per number each frame. That stays
// deterministic for the export because the export drives it with a fixed dt (1/fps) from
// a freshly reset() instance; the live preview uses real frame deltas.

type SlotState = { pos: number; vel: number };

export class RollingNumber {
  private groups = new Map<string, SlotState[]>();

  // stiffness/damping tuned for a snappy, slightly-springy settle like NumberFlow.
  constructor(private stiffness = 190, private damping = 24) {}

  reset() { this.groups.clear(); }

  // money=true renders "$1,234,567" — the $ and commas are static glyphs; digits still
  // sit on rolling reels (digit state is keyed by position-from-right among digits only,
  // so group separators don't disturb the odometer).
  private fmt(value: number, decimals: number, money: boolean): string {
    const str = (value > 0 ? value : 0).toFixed(decimals);
    if (!money) return str;
    const [int, frac] = str.split('.');
    return '$' + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? '.' + frac : '');
  }

  // Width this number will occupy (uniform digit cells + natural width for non-digits).
  // The caller must have set ctx.font first; matches what draw() renders.
  measure(ctx: CanvasRenderingContext2D, value: number, decimals: number, money = false): number {
    const str = this.fmt(value, decimals, money);
    const cellW = ctx.measureText('0').width;
    let w = 0;
    for (const ch of str) w += ch >= '0' && ch <= '9' ? cellW : ctx.measureText(ch).width;
    return w;
  }

  // Integrate + draw `value` (>=0) to `decimals` as a spring-driven odometer.
  // Caller sets ctx.font + ctx.fillStyle. Left-anchored at (x, yTop), textBaseline 'top'.
  // `dt` = seconds since last frame. Returns the drawn width (matches measure()).
  draw(
    ctx: CanvasRenderingContext2D,
    id: string,
    value: number,
    decimals: number,
    x: number,
    yTop: number,
    fontSize: number,
    dt: number,
    money = false,
  ): number {
    const v = value > 0 ? value : 0;
    const str = this.fmt(v, decimals, money);
    const M = v * Math.pow(10, decimals);
    const cellH = fontSize;
    const cellW = ctx.measureText('0').width;
    const h = Math.max(0, Math.min(0.05, dt)); // clamp dt so the spring stays stable

    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const totalDigits = (str.match(/\d/g) || []).length;

    let states = this.groups.get(id);
    if (!states) { states = []; this.groups.set(id, states); }

    let seen = 0;
    let cx = x;
    for (const ch of str) {
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

        // draw the reel: a few digits around the current position, clipped to one cell,
        // each centered horizontally so proportional digits stay aligned.
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx, yTop, cellW, cellH);
        ctx.clip();
        const base = Math.floor(st.pos);
        for (let d = base - 1; d <= base + 2; d++) {
          const s = String(((d % 10) + 10) % 10);
          const yy = yTop + (d - st.pos) * cellH; // counting up => digits roll upward
          ctx.fillText(s, cx + (cellW - ctx.measureText(s).width) / 2, yy);
        }
        ctx.restore();
        cx += cellW;
      } else {
        ctx.fillText(ch, cx, yTop);
        cx += ctx.measureText(ch).width;
      }
    }
    return cx - x;
  }
}
