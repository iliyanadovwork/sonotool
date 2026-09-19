// ─────────────────────────────────────────────────────────────────────────────
// Spec validation — a Zod schema over DesignSpec so a headless agent gets a clear,
// actionable error BEFORE anything touches the DB. It is deliberately strict at the
// structural level (unknown top-level keys are rejected → typos like `textbox` vs
// `textBoxes` fail loudly) but permissive inside `settings` and per-element style
// (those are validated by the builders' own defaults). Returns a value assignable
// to build.ts's DesignSpec.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import type { DesignSpec } from './build';

const geometry = {
  x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(),
};

// Element specs: require the fields the builders can't default, allow the rest through.
const textBoxSpec = z.looseObject({ text: z.string() });

// A normal image box needs a url; a placeholder (empty slot) may omit it.
const imageBoxSpec = z.looseObject({
  url: z.string().optional(),
  placeholder: z.boolean().optional(),
  placeholderLabel: z.string().optional(),
  ...geometry,
}).refine(
  b => b.placeholder === true || (typeof b.url === 'string' && b.url.length > 0),
  { message: 'imageBox needs a non-empty url (or set placeholder: true for an empty slot)' },
);

const chartBoxSpec = z.looseObject({
  spotifyId: z.string().min(1),
  artistName: z.string().min(1),
  data: z.array(z.object({ index: z.number(), timestamp: z.string() })).min(1, 'chart needs at least one data point'),
  ...geometry,
});

const slideSpec = z.strictObject({
  name: z.string().optional(),
  headline: z.string().optional(),
  subheadline: z.string().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  textBoxes: z.array(textBoxSpec).optional(),
  imageBoxes: z.array(imageBoxSpec).optional(),
  chartBoxes: z.array(chartBoxSpec).optional(),
});

const designSpec = z.strictObject({
  name: z.string().optional(),
  slides: z.array(slideSpec).min(1, 'a design needs at least one slide'),
});

/** Parse + validate an untrusted spec (e.g. JSON from an agent). Throws an Error whose
 *  message lists every problem as `path: message`, or returns a typed DesignSpec. */
export function validateDesignSpec(input: unknown): DesignSpec {
  const res = designSpec.safeParse(input);
  if (!res.success) {
    const lines = res.error.issues.map(i => {
      const path = i.path.length ? i.path.join('.') : '(root)';
      return `  • ${path}: ${i.message}`;
    });
    throw new Error(`invalid design spec:\n${lines.join('\n')}`);
  }
  return res.data as DesignSpec;
}
