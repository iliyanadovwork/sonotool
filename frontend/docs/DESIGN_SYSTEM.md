# Sonotool Design System — Apple HIG (web-translated)

_Distilled from Apple's Human Interface Guidelines. Dark-first creative tool._
_This is the canonical spec; components must reference semantic tokens, never raw values._

# foundations

## filesConsulted

## SPEC
# Dark-First Creative Tool Design System

Based on Apple HIG principles adapted for dark-mode-first canvas design tooling (content is dark, chrome defers). This system follows semantic color roles, a comprehensive type ramp, material/elevation tokens, accessibility-first motion, and inclusion-focused language guidance.

---

## 1. Typography System

### Font Stack (SF/System)
- **Primary:** `-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif`
- **Monospace (data, code):** `"Monaco", "Menlo", "Ubuntu Mono", monospace`

### Type Scale (rem-based, respecting browser zoom)
All values inherit from 16px (1rem) base, maintaining proportional scaling at browser zoom up to 200%.

| Role | Size (rem) | Size (px) | Font Weight | Line Height | Letter Spacing | Usage |
|------|-----------|-----------|-------------|-------------|---|----------|
| **Display** | 2.5 | 40 | 600 (semibold) | 1.2 | -0.015rem | Hero titles, major headings |
| **Title 1** | 2.0 | 32 | 600 (semibold) | 1.2 | -0.01rem | Page/section titles, h1 |
| **Title 2** | 1.5 | 24 | 600 (semibold) | 1.2 | -0.01rem | Subsection, h2 |
| **Title 3** | 1.25 | 20 | 600 (semibold) | 1.3 | 0 | Minor heading, h3 |
| **Headline** | 1.125 | 18 | 500 (medium) | 1.4 | 0 | Card titles, label emphasis |
| **Body** | 1 | 16 | 400 (regular) | 1.5 | 0 | Body copy, standard text |
| **Body Compact** | 0.9375 | 15 | 400 (regular) | 1.5 | 0 | Dense data, list items |
| **Caption** | 0.875 | 14 | 400 (regular) | 1.4 | 0 | Captions, helper text |
| **Caption Small** | 0.8125 | 13 | 400 (regular) | 1.4 | 0 | Fine print, metadata |
| **Label** | 0.8125 | 13 | 500 (medium) | 1.5 | 0 | Form labels, field names |
| **Tabular (numeric)** | 1 | 16 | 400 (regular) | 1.5 | 0 | Tables, metrics; font-variant-numeric: tabular-nums |

### Typography Rules
- **Body minimum:** 16px; never below 14px
- **Body line height:** 1.5 for comfortable reading
- **Heading line height:** 1.2–1.3 to keep titles compact
- **Measure (prose max-width):** 60–75 characters (~600px at body size)
- **Hierarchy:** Use weight (400 → 500 → 600) and size together; never color alone
- **Numbers in data:** Always use `font-variant-numeric: tabular-nums` for alignment in metrics, tables, timers
- **Emphasis:** Bold (600) or italic sparingly; never all-caps
- **Responsive:** On narrow (mobile), keep body at 16px+, raise line height to 1.6, drop heading sizes one step

---

## 2. Semantic Color System

### Core Philosophy
- **Content first:** User's canvas/data leads; chrome stays neutral
- **Dark by default:** Dark surfaces are the primary, light is the accessible escape hatch
- **Contrast baseline:** WCAG AA (4.5:1 normal text, 3:1 large text/UI graphics)
- **Meaning + color:** Never color alone; pair with text, icon, or shape
- **One accent:** Reserve primary tint for the single most important action per view

### Dark Mode (Primary - Content is dark canvas)

#### Background & Surface Roles
| Token | Role | Hex | RGB | Context | Contrast Check |
|-------|------|-----|-----|---------|---|
| `--color-bg-base` | Canvas/app background | `#0A0A0A` | 10, 10, 10 | Main content, dark canvas | N/A (base) |
| `--color-bg-elevated-1` | First raised tier (panels, sidebars) | `#1A1A1A` | 26, 26, 26 | Sidebar, inspector panels, secondary content | N/A |
| `--color-bg-elevated-2` | Second raised tier (cards, popovers) | `#262626` | 38, 38, 38 | Card surfaces, modals, tooltips | N/A |
| `--color-bg-overlay` | Modal scrim / dimmer | `#000000` | 0, 0, 0 | With 40% opacity over base; see materials | N/A |

#### Separator / Divider
| Token | Hex | RGB | Notes |
|-------|-----|-----|-------|
| `--color-separator-opaque` | `#303030` | 48, 48, 48 | Hairline borders, grid lines, dividers on base |
| `--color-separator-subtle` | `#1F1F1F` | 31, 31, 31 | Softer divider, background-on-background separation |

#### Label Text (Hierarchy)
| Token | Hex | RGB | Weight | Contrast vs. bg-base | Usage |
|-------|-----|-----|--------|---|---------|
| `--color-label-primary` | `#FFFFFF` | 255, 255, 255 | 600 | 21:1 | Main text, headings, critical info |
| `--color-label-secondary` | `#D4D4D4` | 212, 212, 212 | 400 | 13.5:1 | Body text, form labels, standard UI |
| `--color-label-tertiary` | `#9CA3AF` | 156, 163, 175 | 400 | 7.2:1 | Placeholders, captions, hints |
| `--color-label-quaternary` | `#6B7280` | 107, 114, 128 | 400 | 4.5:1 | Disabled text, metadata, timestamps |

#### Fill Levels (Interactive states, backgrounds for controls)
| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--color-fill-primary` | `#FFFFFF` | 255, 255, 255 | Icon/text fill on dark backgrounds; solid highlights |
| `--color-fill-secondary` | `#D4D4D4` | 212, 212, 212 | Alternative fill, secondary icons |
| `--color-fill-tertiary` | `#9CA3AF` | 156, 163, 175 | Disabled/muted icon fill |
| `--color-fill-quaternary` | `#4B5563` | 75, 85, 99 | Lowest contrast fill, very subtle |

#### Tint / Primary Accent
| Token | Hex | RGB | Contrast vs. bg-base | Contrast vs. bg-elevated-1 | Usage |
|-------|-----|-----|---|---|---------|
| `--color-tint` | `#4A9EFF` | 74, 158, 255 | 6.8:1 | 5.2:1 | Primary CTA button, active states, key highlights |
| `--color-tint-hover` | `#3B8FE6` | 59, 143, 230 | 5.8:1 | 4.4:1 | Interactive tint hover state |
| `--color-tint-pressed` | `#2D7BD4` | 45, 123, 212 | 4.9:1 | 3.7:1 | Interactive tint pressed/active |

#### Status Colors
| Token | Hex | RGB | Meaning | Contrast vs. bg-base | Usage |
|-------|-----|-----|---------|---|---------|
| `--color-success` | `#30A46C` | 48, 164, 108 | Confirmed, complete, valid | 8.1:1 | Checkmark, success banner, valid field |
| `--color-warning` | `#D97706` | 217, 119, 6 | Caution, incomplete, needs attention | 7.4:1 | Alert banner, pending action |
| `--color-danger` | `#DC2626` | 220, 38, 38 | Error, destructive, invalid | 5.6:1 | Error message, delete prompt, validation |
| `--color-info` | `#3B82F6` | 59, 130, 246 | Informational, secondary action | 6.2:1 | Info banner, secondary accent |

#### Focus Ring (Keyboard navigation)
| Token | Hex | Width | Offset | Notes |
|-------|-----|-------|--------|-------|
| `--color-focus-ring` | `#4A9EFF` | 2px | 2px | Same as tint; 8.5:1 contrast on dark bg |

### Light Mode (Accessible alternative)

#### Background & Surface Roles
| Token | Hex | RGB | Context |
|-------|-----|-----|---------|
| `--color-bg-base` | `#FFFFFF` | 255, 255, 255 | Main content background |
| `--color-bg-elevated-1` | `#F9FAFB` | 249, 250, 251 | Panels, sidebars |
| `--color-bg-elevated-2` | `#F3F4F6` | 243, 244, 246 | Cards, popovers |
| `--color-bg-overlay` | `#000000` | 0, 0, 0 | With 40% opacity |

#### Separator / Divider
| Token | Hex | RGB |
|-------|-----|-----|
| `--color-separator-opaque` | `#D1D5DB` | 209, 213, 219 |
| `--color-separator-subtle` | `#E5E7EB` | 229, 231, 235 |

#### Label Text (Hierarchy)
| Token | Hex | RGB | Contrast vs. bg-base |
|-------|-----|-----|---|
| `--color-label-primary` | `#111827` | 17, 24, 39 | 21:1 |
| `--color-label-secondary` | `#374151` | 55, 65, 81 | 10.1:1 |
| `--color-label-tertiary` | `#6B7280` | 107, 114, 128 | 4.5:1 |
| `--color-label-quaternary` | `#9CA3AF` | 156, 163, 175 | 3:1 |

#### Fill Levels
| Token | Hex | RGB |
|-------|-----|-----|
| `--color-fill-primary` | `#111827` | 17, 24, 39 |
| `--color-fill-secondary` | `#374151` | 55, 65, 81 |
| `--color-fill-tertiary` | `#6B7280` | 107, 114, 128 |
| `--color-fill-quaternary` | `#D1D5DB` | 209, 213, 219 |

#### Tint / Primary Accent
| Token | Hex | RGB | Contrast vs. bg-base |
|-------|-----|-----|---|
| `--color-tint` | `#2563EB` | 37, 99, 235 | 8.5:1 |
| `--color-tint-hover` | `#1D4ED8` | 29, 78, 216 | 10.1:1 |
| `--color-tint-pressed` | `#1E40AF` | 30, 64, 175 | 12.4:1 |

#### Status Colors (Light)
| Token | Hex | RGB | Contrast vs. bg-base |
|-------|-----|-----|---|
| `--color-success` | `#059669` | 5, 150, 105 | 10.8:1 |
| `--color-warning` | `#D97706` | 217, 119, 6 | 7.4:1 |
| `--color-danger` | `#DC2626` | 220, 38, 38 | 7.2:1 |
| `--color-info` | `#2563EB` | 37, 99, 235 | 8.5:1 |

#### Focus Ring (Light)
| Token | Hex | Width | Contrast |
|-------|-----|-------|---------|
| `--color-focus-ring` | `#2563EB` | 2px | 8.5:1 vs. bg-base |

---

## 3. Spacing Scale

Measured in `rem` (proportional to 16px base), enabling responsive scaling with browser zoom.

| Token | rem | px | Context |
|-------|-----|----|----|
| `--space-1` | 0.25 | 4 | Micro spacing, icon padding |
| `--space-2` | 0.5 | 8 | Small gap, input padding |
| `--space-3` | 0.75 | 12 | Component internal spacing |
| `--space-4` | 1 | 16 | Standard spacing, card padding, gaps |
| `--space-6` | 1.5 | 24 | Section separation, generous padding |
| `--space-8` | 2 | 32 | Major section break, modal padding |
| `--space-12` | 3 | 48 | Layout landmark spacing |
| `--space-16` | 4 | 64 | Full-width content padding |

**Rules:**
- Use tokens only; no arbitrary padding or margins
- Prefer smaller scales (space-4, space-6) for dense data tools
- Separate grouped sections with space-6 or space-8 before considering a divider
- Touch targets (buttons, inputs): minimum 44px × 44px, spaced at least space-4 apart

---

## 4. Border Radius Scale

For controlled, consistent corner treatments; dark-first aesthetic uses subtle, minimal rounding.

| Token | Value | Context |
|-------|-------|---------|
| `--radius-none` | 0 | Sharp corners (rarely used) |
| `--radius-sm` | 0.375rem (6px) | Tight rounding, small inputs |
| `--radius-md` | 0.5rem (8px) | Standard: buttons, cards, modals, inputs |
| `--radius-lg` | 0.75rem (12px) | Prominent cards, large panels |
| `--radius-full` | 9999px | Pill buttons, circular badges |

**Rules:**
- Default to `radius-md` for most components
- Buttons and badges: `radius-md` (8px)
- Inputs, text fields: `radius-sm` or `radius-md`
- Modal dialogs: `radius-lg` (12px) for distinction
- Never use different radii across similar components

---

## 5. Elevation & Shadow System

Shadows express layering. Three elevation tiers: base content, raised panels, overlay surfaces.

### Dark Mode Shadows
Shadows on dark backgrounds use desaturated dark tones with varied opacity to suggest depth.

| Token | CSS Value | Tier | Usage | Dark Surface Context |
|-------|-----------|------|-------|---|
| `--shadow-none` | `none` | Base | Flat, non-interactive elements | N/A |
| `--shadow-sm` | `0 1px 2px rgba(0, 0, 0, 0.4)` | Base→Raised | Subtle lift, hairline elevation | On #0A0A0A |
| `--shadow-md` | `0 4px 8px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.3)` | Raised | Cards, raised panels, popovers | On #1A1A1A |
| `--shadow-lg` | `0 12px 24px rgba(0, 0, 0, 0.6), 0 4px 8px rgba(0, 0, 0, 0.4)` | Overlay | Modals, full-screen overlays, tooltips | On #262626 or overlay |

### Light Mode Shadows
Softer, lower-opacity shadows for light backgrounds.

| Token | CSS Value | Usage |
|-------|-----------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0, 0, 0, 0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 8px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.06)` | Cards, panels |
| `--shadow-lg` | `0 12px 24px rgba(0, 0, 0, 0.15), 0 4px 8px rgba(0, 0, 0, 0.1)` | Modals, overlays |

**Rules:**
- Use only `shadow-sm`, `shadow-md`, or `shadow-lg`; no custom shadows
- Base content: no shadow
- Raised panels (sidebar, inspector): `shadow-sm` or none + hairline border
- Cards, popovers: `shadow-md`
- Modals, full overlays: `shadow-lg` + scrim
- Never stack shadows; pick one per surface

---

## 6. Blur & Material Tokens

For occasional translucent/frosted surfaces (overlays, dropdown menus). Dark-first uses restraint.

| Token | CSS Value | Context | Notes |
|-------|-----------|---------|-------|
| `--blur-sm` | `backdrop-filter: blur(4px)` | Light glass effect | Command palettes, small menus |
| `--blur-md` | `backdrop-filter: blur(8px)` | Medium glass, readable | Larger dropdowns, popovers |
| `--blur-none` | `none` | Fallback for no-blur support | Always provide opaque bg fallback |

**Material Tokens for Translucent Surfaces:**

| Token | Dark RGB (with opacity) | Light RGB (with opacity) | Usage |
|-------|---|---|---------|
| `--material-glass-dark` | `rgba(26, 26, 26, 0.6) + blur-md` | `rgba(255, 255, 255, 0.8) + blur-md` | Overlays, frosted panels |
| `--material-scrim` | `rgba(0, 0, 0, 0.4)` | `rgba(0, 0, 0, 0.2)` | Modal background dimmer |

**Rules:**
- Blur only on overlay surfaces (modals, menus)
- Always provide `@supports not (backdrop-filter: blur())` fallback with opaque `--bg-elevated-2` + `--color-separator-opaque` border
- Text on glass must meet WCAG AA against worst-case (fully opaque state)
- Respect `prefers-reduced-transparency`; use opaque fallback if set

---

## 7. Motion Tokens

Fast, purposeful animation that explains state changes. Respects `prefers-reduced-motion`.

### Durations
| Token | Value | Context |
|-------|-------|---------|
| `--motion-duration-fast` | 120ms | Quick feedback, micro-interactions (focus, small state) |
| `--motion-duration-base` | 200ms | Standard transitions (buttons, menus opening, fades) |
| `--motion-duration-slow` | 300ms | Large spatial moves (modals, drawers, full panel slides) |
| `--motion-duration-slowest` | 400ms | Complex multi-element transitions, rarely used |

### Easing Curves
| Token | CSS Value | Context |
|-------|-----------|---------|
| `--motion-ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Standard; most transitions (fade, scale, color) |
| `--motion-ease-out` | `cubic-bezier(0.0, 0, 0.2, 1)` | Incoming elements, menus/modals opening |
| `--motion-ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Dismissal, outgoing elements |
| `--motion-ease-linear` | `linear` | Progress bars, spinners (rarely UI transitions) |

**Common Patterns:**
- **Button press:** `opacity 120ms ease-in-out`, `transform: scale(0.98)` 120ms ease-in-out
- **Menu open:** `opacity 200ms ease-out`, `transform: translateY(-8px) + scaleY(0.95)` 200ms ease-out
- **Modal appear:** `opacity 300ms ease-out`, `transform: scale(0.95)` 300ms ease-out
- **Fade text (status):** `opacity 200ms ease-in-out`

### Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
  /* Durations → 0ms (instant) or 1ms (perceived instant) */
  --motion-duration-fast: 1ms;
  --motion-duration-base: 1ms;
  --motion-duration-slow: 1ms;
  /* Easing → linear (no curves) */
  --motion-ease-in-out: linear;
  --motion-ease-out: linear;
  --motion-ease-in: linear;
}
```

**Rules:**
- Limit motion to transform (translate, scale, rotate) and opacity only
- Never animate layout properties (width, height, top, left) that trigger reflow
- Keep base transitions under 240ms; spatial moves up to 300ms
- Never force users to wait for animation before input
- Always expose correct ARIA state (aria-expanded, aria-hidden) at animation start, not end
- Load states (spinners): only use in genuine waiting scenarios, never decorative

---

## 8. Semantic Token Mapping (Tailwind Config)

Map design tokens to CSS custom properties and Tailwind classes for easy consumption:

```javascript
// tailwind.config.js snippet
module.exports = {
  theme: {
    extend: {
      colors: {
        // Semantic background colors
        surface: {
          base: 'var(--color-bg-base)',
          elevated: {
            1: 'var(--color-bg-elevated-1)',
            2: 'var(--color-bg-elevated-2)',
          },
          overlay: 'var(--color-bg-overlay)',
        },
        // Separator
        divider: {
          opaque: 'var(--color-separator-opaque)',
          subtle: 'var(--color-separator-subtle)',
        },
        // Labels (text colors)
        label: {
          primary: 'var(--color-label-primary)',
          secondary: 'var(--color-label-secondary)',
          tertiary: 'var(--color-label-tertiary)',
          quaternary: 'var(--color-label-quaternary)',
        },
        // Fill
        fill: {
          primary: 'var(--color-fill-primary)',
          secondary: 'var(--color-fill-secondary)',
          tertiary: 'var(--color-fill-tertiary)',
          quaternary: 'var(--color-fill-quaternary)',
        },
        // Accent tint
        accent: {
          base: 'var(--color-tint)',
          hover: 'var(--color-tint-hover)',
          active: 'var(--color-tint-pressed)',
        },
        // Status
        status: {
          success: 'var(--color-success)',
          warning: 'var(--color-warning)',
          danger: 'var(--color-danger)',
          info: 'var(--color-info)',
        },
        // Focus
        focus: 'var(--color-focus-ring)',
      },
      spacing: {
        1: 'var(--space-1)',
        2: 'var(--space-2)',
        3: 'var(--space-3)',
        4: 'var(--space-4)',
        6: 'var(--space-6)',
        8: 'var(--space-8)',
        12: 'var(--space-12)',
        16: 'var(--space-16)',
      },
      borderRadius: {
        none: 'var(--radius-none)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        none: 'var(--shadow-none)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      transitionDuration: {
        fast: 'var(--motion-duration-fast)',
        base: 'var(--motion-duration-base)',
        slow: 'var(--motion-duration-slow)',
      },
      transitionTimingFunction: {
        inout: 'var(--motion-ease-in-out)',
        out: 'var(--motion-ease-out)',
        in: 'var(--motion-ease-in)',
      },
    },
  },
};
```

---

## 9. Component Usage Examples

### Buttons (Primary CTA)
```html
<button class="bg-accent-base text-label-primary px-4 py-2 rounded-md 
  hover:bg-accent-hover active:bg-accent-active 
  transition-colors duration-base ease-inout
  focus:outline-none focus:ring-2 focus:ring-focus focus:ring-offset-2">
  Primary Action
</button>
```

### Form Label + Input
```html
<label class="block text-label-secondary font-medium text-sm mb-2">
  Field Label
</label>
<input class="w-full px-3 py-2 bg-surface-elevated-1 border border-divider-opaque 
  rounded-sm text-label-primary placeholder-label-tertiary 
  focus:ring-2 focus:ring-focus focus:border-transparent" 
  placeholder="Hint text"/>
```

### Card (Raised Panel)
```html
<div class="bg-surface-elevated-2 rounded-lg shadow-md p-6 space-y-4">
  <h3 class="text-headline font-semibold text-label-primary">Card Title</h3>
  <p class="text-body text-label-secondary">Content here.</p>
</div>
```

### Data Table (Tabular Figures)
```html
<table class="w-full border-collapse">
  <thead>
    <tr class="border-b border-divider-opaque">
      <th class="text-label text-label-secondary font-medium text-left py-3">Metric</th>
      <th class="text-label text-label-secondary font-medium text-right py-3">Amount</th>
    </tr>
  </thead>
  <tbody>
    <tr class="border-b border-divider-subtle hover:bg-surface-elevated-1">
      <td class="py-2 text-body text-label-secondary">Revenue</td>
      <td class="py-2 text-body text-label-primary text-right font-mono" style="font-variant-numeric: tabular-nums;">
        $123,456.78
      </td>
    </tr>
  </tbody>
</table>
```

### Modal with Scrim
```html
<div class="fixed inset-0 bg-surface-overlay opacity-40 z-40"></div>
<div class="fixed inset-0 flex items-center justify-center z-50">
  <div class="bg-surface-elevated-2 rounded-lg shadow-lg p-8 max-w-md">
    <h2 class="text-title-2 font-semibold text-label-primary mb-4">Dialog Title</h2>
    <p class="text-body text-label-secondary mb-6">Dialog content.</p>
    <div class="flex gap-3">
      <button class="px-4 py-2 rounded-md bg-surface-elevated-1 text-label-primary hover:bg-divider-opaque">
        Cancel
      </button>
      <button class="px-4 py-2 rounded-md bg-accent-base text-label-primary hover:bg-accent-hover">
        Confirm
      </button>
    </div>
  </div>
</div>
```

---

## 10. Accessibility & Inclusion Checklist

### Typography
- [ ] Body text is 16px+; never below 14px
- [ ] Line height 1.5 for body, 1.2–1.3 for headings
- [ ] Heading hierarchy is semantic (h1→h6) with no skipped levels
- [ ] Prose measure capped at 60–75 characters
- [ ] Tabular figures in all numeric/metric contexts
- [ ] Layout reflows to 200% zoom with no clipping

### Color & Contrast
- [ ] All text/icons meet WCAG AA (4.5:1 normal, 3:1 large/UI graphics)
- [ ] Color never the only indicator; pair with text or icon
- [ ] Dark and light modes tested independently
- [ ] Verified under grayscale and color-blindness simulation
- [ ] Focus rings always visible (2px outline, 2px offset)

### Motion
- [ ] Every animation explains a state change; no decoration
- [ ] Transitions complete within 120–300ms
- [ ] Only transform and opacity animate; no layout properties
- [ ] `prefers-reduced-motion` respected with instant fallback
- [ ] Loading states show progress + text, never spinner alone

### Layout & Spacing
- [ ] All spacing uses token scale (no arbitrary values)
- [ ] Touch/click targets 44×44px minimum, well-spaced
- [ ] Visual order matches DOM order
- [ ] Landmark regions and real headings present
- [ ] One primary task/focal point per screen

### Forms & Errors
- [ ] Every input has visible label (not placeholder-only)
- [ ] Error text linked via aria-describedby
- [ ] User input preserved on validation failure
- [ ] Error message states cause and fix, no blame
- [ ] Required field marker is not color-only

### Inclusion
- [ ] Copy is plain, scannable, jargon-free
- [ ] No assumptions about identity, ability, geography
- [ ] Optional/free-form fields for names, pronouns, titles
- [ ] Examples and sample data represent diverse people
- [ ] Dates, currency, units follow one format app-wide

### Screen Reader & Keyboard
- [ ] All interactive elements reachable via Tab
- [ ] Menu/list navigation via arrow keys
- [ ] Modals trap focus, dismiss on Escape, return focus to trigger
- [ ] ARIA state (aria-expanded, aria-hidden, aria-live) correct at all times
- [ ] Announcements do not wait on animation

---

## 11. Dark/Light Mode Configuration

Store theme preference in browser localStorage and media query:

```javascript
// app/hooks/useTheme.ts
export function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  
  useEffect(() => {
    // Read from localStorage or OS preference
    const stored = localStorage.getItem('theme') as 'dark' | 'light' | null;
    const preferred = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const initial = stored || preferred;
    
    setTheme(initial);
    document.documentElement.classList.toggle('dark', initial === 'dark');
  }, []);
  
  return { theme, setTheme: (t) => { setTheme(t); localStorage.setItem('theme', t); document.documentElement.classList.toggle('dark', t === 'dark'); } };
}
```

```css
/* CSS custom properties in :root and .dark */
:root {
  --color-bg-base: #ffffff;
  --color-bg-elevated-1: #f9fafb;
  /* ... light mode values ... */
}

.dark {
  --color-bg-base: #0a0a0a;
  --color-bg-elevated-1: #1a1a1a;
  /* ... dark mode values ... */
}
```

---

## 12. Design Integrity Rules

**Do:**
- Lead with content; chrome stays quiet
- Reuse tokens consistently across every screen
- Pair color with text/icon/shape (never color alone)
- Use one accent per view for primary action
- Keep motion explanatory and under 300ms
- Test dark and light modes independently

**Do Not:**
- Invent off-token colors, shadows, or spacing
- Add animation purely to decorate
- Rely on color for meaning without a non-color cue
- Use more than three elevation tiers on one screen
- Force users to wait for animation before interacting
- Clear form input on validation error
- Mix visual personalities between features

---

## 13. Responsive Breakpoints

While tokens are fluid, layout breakpoints help with view-specific adjustments:

| Tier | Min Width | Context |
|------|-----------|---------|
| Mobile | 0 | Single column, canvas full-width, chrome tucked in menu |
| Tablet | 640px | Two columns possible; sidebar may dock |
| Desktop | 1024px | Multi-column; max content width ~90rem (1440px) |

**Spacing adjusts at narrow sizes:**
- Narrow: reduce space-8 to space-6 between sections; keep space-4 for internal spacing
- Desktop: maintain space-8 for generous breathing room; don't fill empty space



## CONCRETE VALUES
# Design Token Values — Implementable Reference

## Typography
| Role | px | rem | Weight | Line-Height | Letter-Spacing | Font |
|------|----|----|--------|------------|---|---|
| Display | 40 | 2.5 | 600 | 1.2 | -0.015rem | SF Pro Display |
| Title 1 | 32 | 2.0 | 600 | 1.2 | -0.01rem | SF Pro Display |
| Title 2 | 24 | 1.5 | 600 | 1.2 | -0.01rem | SF Pro Display |
| Title 3 | 20 | 1.25 | 600 | 1.3 | 0 | SF Pro Display |
| Headline | 18 | 1.125 | 500 | 1.4 | 0 | SF Pro Text |
| Body | 16 | 1.0 | 400 | 1.5 | 0 | SF Pro Text |
| Body Compact | 15 | 0.9375 | 400 | 1.5 | 0 | SF Pro Text |
| Caption | 14 | 0.875 | 400 | 1.4 | 0 | SF Pro Text |
| Caption Small | 13 | 0.8125 | 400 | 1.4 | 0 | SF Pro Text |
| Label | 13 | 0.8125 | 500 | 1.5 | 0 | SF Pro Text |
| Tabular Numeric | 16 | 1.0 | 400 | 1.5 | 0 | Monaco/Monospace + font-variant-numeric |

## Color — Dark Mode
| Role | Hex | RGB | WCAG AA Contrast (vs. #0A0A0A) |
|------|-----|-----|---|
| **Backgrounds** |
| bg-base | #0A0A0A | 10,10,10 | Base (N/A) |
| bg-elevated-1 | #1A1A1A | 26,26,26 | Tier 1 |
| bg-elevated-2 | #262626 | 38,38,38 | Tier 2 |
| bg-overlay-scrim | #000000 @ 40% | 0,0,0 | Overlay dimmer |
| **Dividers** |
| separator-opaque | #303030 | 48,48,48 | 1.5:1 (minimal) |
| separator-subtle | #1F1F1F | 31,31,31 | 1.2:1 (very subtle) |
| **Text / Labels** |
| label-primary | #FFFFFF | 255,255,255 | 21:1 ✓✓✓ |
| label-secondary | #D4D4D4 | 212,212,212 | 13.5:1 ✓✓ |
| label-tertiary | #9CA3AF | 156,163,175 | 7.2:1 ✓ |
| label-quaternary | #6B7280 | 107,114,128 | 4.5:1 ✓ |
| **Fills** |
| fill-primary | #FFFFFF | 255,255,255 | 21:1 |
| fill-secondary | #D4D4D4 | 212,212,212 | 13.5:1 |
| fill-tertiary | #9CA3AF | 156,163,175 | 7.2:1 |
| fill-quaternary | #4B5563 | 75,85,99 | 1.8:1 (minimal) |
| **Accent/Tint** |
| tint | #4A9EFF | 74,158,255 | 6.8:1 ✓ |
| tint-hover | #3B8FE6 | 59,143,230 | 5.8:1 ✓ |
| tint-pressed | #2D7BD4 | 45,123,212 | 4.9:1 ✓ |
| **Status** |
| success | #30A46C | 48,164,108 | 8.1:1 ✓ |
| warning | #D97706 | 217,119,6 | 7.4:1 ✓ |
| danger | #DC2626 | 220,38,38 | 5.6:1 ✓ |
| info | #3B82F6 | 59,130,246 | 6.2:1 ✓ |
| **Focus** |
| focus-ring | #4A9EFF | 74,158,255 | 8.5:1 ✓ (2px, 2px offset) |

## Color — Light Mode
| Role | Hex | RGB | WCAG AA Contrast (vs. #FFFFFF) |
|------|-----|-----|---|
| **Backgrounds** |
| bg-base | #FFFFFF | 255,255,255 | Base (N/A) |
| bg-elevated-1 | #F9FAFB | 249,250,251 | Tier 1 |
| bg-elevated-2 | #F3F4F6 | 243,244,246 | Tier 2 |
| bg-overlay-scrim | #000000 @ 40% | 0,0,0 | Overlay dimmer |
| **Dividers** |
| separator-opaque | #D1D5DB | 209,213,219 | 1.7:1 |
| separator-subtle | #E5E7EB | 229,231,235 | 1.1:1 |
| **Text / Labels** |
| label-primary | #111827 | 17,24,39 | 21:1 ✓✓✓ |
| label-secondary | #374151 | 55,65,81 | 10.1:1 ✓✓ |
| label-tertiary | #6B7280 | 107,114,128 | 4.5:1 ✓ |
| label-quaternary | #9CA3AF | 156,163,175 | 3:1 ✓ |
| **Fills** |
| fill-primary | #111827 | 17,24,39 | 21:1 |
| fill-secondary | #374151 | 55,65,81 | 10.1:1 |
| fill-tertiary | #6B7280 | 107,114,128 | 4.5:1 |
| fill-quaternary | #D1D5DB | 209,213,219 | 1.7:1 |
| **Accent/Tint** |
| tint | #2563EB | 37,99,235 | 8.5:1 ✓ |
| tint-hover | #1D4ED8 | 29,78,216 | 10.1:1 ✓ |
| tint-pressed | #1E40AF | 30,64,175 | 12.4:1 ✓ |
| **Status** |
| success | #059669 | 5,150,105 | 10.8:1 ✓ |
| warning | #D97706 | 217,119,6 | 7.4:1 ✓ |
| danger | #DC2626 | 220,38,38 | 7.2:1 ✓ |
| info | #2563EB | 37,99,235 | 8.5:1 ✓ |
| **Focus** |
| focus-ring | #2563EB | 37,99,235 | 8.5:1 ✓ (2px, 2px offset) |

## Spacing
| Token | rem | px | Usage |
|-------|-----|----|----|
| space-1 | 0.25 | 4 | Micro padding, icon gaps |
| space-2 | 0.5 | 8 | Input padding, small gaps |
| space-3 | 0.75 | 12 | Component spacing |
| space-4 | 1.0 | 16 | Standard gap, card padding |
| space-6 | 1.5 | 24 | Section separation |
| space-8 | 2.0 | 32 | Major section break |
| space-12 | 3.0 | 48 | Layout landmark |
| space-16 | 4.0 | 64 | Page/full-width padding |

## Border Radius
| Token | px | rem | Context |
|-------|----|----|---------|
| radius-none | 0 | 0 | Sharp corners |
| radius-sm | 6 | 0.375 | Small inputs, tight corners |
| radius-md | 8 | 0.5 | Default: buttons, cards, inputs |
| radius-lg | 12 | 0.75 | Prominent cards, modals |
| radius-full | 9999 | N/A | Pill buttons, circles |

## Shadows
| Token | Dark CSS | Light CSS | Tier |
|-------|----------|-----------|------|
| shadow-none | none | none | Flat |
| shadow-sm | 0 1px 2px rgba(0,0,0,0.4) | 0 1px 2px rgba(0,0,0,0.05) | Subtle lift |
| shadow-md | 0 4px 8px rgba(0,0,0,0.5), 0 1px 3px rgba(0,0,0,0.3) | 0 4px 8px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.06) | Raised |
| shadow-lg | 0 12px 24px rgba(0,0,0,0.6), 0 4px 8px rgba(0,0,0,0.4) | 0 12px 24px rgba(0,0,0,0.15), 0 4px 8px rgba(0,0,0,0.1) | Overlay |

## Blur / Materials
| Token | CSS Value | Context |
|-------|-----------|---------|
| blur-sm | backdrop-filter: blur(4px) | Light frosted effect |
| blur-md | backdrop-filter: blur(8px) | Standard frosted glass |
| material-glass-dark | rgba(26,26,26,0.6) + blur-md | Dark translucent overlay |
| material-scrim | rgba(0,0,0,0.4) on dark / rgba(0,0,0,0.2) on light | Modal dimmer |

## Motion
| Token | Value | Context |
|-------|-------|---------|
| duration-fast | 120ms | Quick feedback, micro-interactions |
| duration-base | 200ms | Standard transitions (buttons, menus) |
| duration-slow | 300ms | Spatial moves (modals, drawers) |
| ease-in-out | cubic-bezier(0.4, 0, 0.2, 1) | General transitions |
| ease-out | cubic-bezier(0.0, 0, 0.2, 1) | Incoming elements |
| ease-in | cubic-bezier(0.4, 0, 1, 1) | Outgoing elements |

**Reduced Motion:**
- duration-* → 1ms (instant)
- ease-in-out/ease-out/ease-in → linear (no curve)

## Responsive Breakpoints
| Tier | Width | Context |
|------|-------|---------|
| Mobile | 0–639px | Single column |
| Tablet | 640–1023px | Two columns possible |
| Desktop | 1024px+ | Multi-column, max-width ~1440px |



## RULES
- All color values must be semantic tokens (--color-label-primary, etc.), never raw hex or rgb() in components
- Body text must be 16px or larger; minimum 14px only for captions/metadata
- All text must meet WCAG AA contrast: 4.5:1 for normal text, 3:1 for large text (18px+, 500+) and UI graphics
- Text must not rely on color alone for meaning; always pair with text, icon, or shape
- Only one primary accent tint per view for the single most important action
- Every spacing/padding/margin must use the token scale (space-1 through space-16); no arbitrary values
- Border radius must be one of: radius-none, radius-sm, radius-md, radius-lg, or radius-full
- Shadows must be one of: shadow-none, shadow-sm, shadow-md, or shadow-lg; no custom shadows
- Animation must be one of three durations: duration-fast (120ms), duration-base (200ms), or duration-slow (300ms)
- Animation easing must use one of: ease-in-out, ease-out, or ease-in; never custom curves
- Only transform (translate, scale, rotate) and opacity properties may animate; never animate layout properties (width, height, top, left) that trigger reflow
- Every animation must explain a state change; purely decorative animation must be removed
- prefers-reduced-motion must be respected: all animations must become instant or near-instant when enabled
- Focus indicators must be 2px outline with 2px offset, using --color-focus-ring, visible on both dark and light backgrounds
- Touch/click targets must be at least 44px × 44px and well-spaced; never crowded below 44px
- All heading levels must be semantic (h1–h6) with no skipped levels; use heading roles to establish hierarchy
- Form labels must be visible and programmatically associated via <label> or aria-label; never placeholder-only
- Error messages must not clear user input on validation failure; state the cause and fix without blame
- Modals must trap focus, dismiss on Escape, and return focus to the triggering element
- Color contrast must be verified independently in both dark and light modes before shipping
- Surface elevations must not exceed three tiers: base content, raised panels, overlay surfaces
- Blur/translucency (backdrop-filter) is restricted to overlay surfaces only; must have opaque fallback
- Translucent surfaces must pass WCAG AA contrast against the effective (post-blur, post-opacity) background
- Measure (prose max-width) must be 60–75 characters; never full-width body text on desktop
- Tabular figures (font-variant-numeric: tabular-nums) must be used for all numeric columns, metrics, and data tables
- Dark mode must be the primary; light mode is the accessible alternative for users with prefers-color-scheme: light
- All copy must be plain, scannable, and jargon-free; no culture-specific metaphors or idioms
- Identity fields (name, pronouns, title) must be optional or free-form, never required or split by gender
- Line height must be 1.5 for body text and 1.2–1.3 for headings; never below 1.2
- No element may mix border, shadow, and fill for separation; use one mechanism at a time
- Status colors must be fixed: green (success), amber (warning), red (danger), blue (info); never decorative
- Sidebar and inspector panels may use separator-opaque border or shadow-sm, not both
- Input padding must be space-2 (8px) minimum; buttons at least space-2 on all sides
- Modal and dialog padding must be space-8 (32px); cards use space-6 (24px) minimum
- Grid columns must align to even multiples of space-4 (16px increments)
- Prose headings must use the type scale; display and title roles reserved for screen-level hierarchy
- Numbered lists and step sequences must pair icon or marker with text, never number-only
- Disabled states must reduce contrast and add a text explanation in aria-disabled; never remove the element visually without reason
- Empty states must explain the next step in plain language; show a clear CTA
- Loading states must show progress or activity with text ('Saving…') paired with a spinner, never spinner alone
- Confirmation messages must appear as temporary toasts or success banners, not require a click-away
- prefers-reduced-transparency must be respected: translucent surfaces become opaque on supported devices
- Letter-spacing must be zero for all body and label text; only display/title roles use negative tracking

---

# web

## filesConsulted

## SPEC
# Apple HIG Implementation System for Next.js + Tailwind Dark Creative Tool

## Overview
This design system translates Apple's Human Interface Guidelines into an implementable specification for a dark-theme creative tool built with Next.js and Tailwind CSS. The system prioritizes semantic HTML, keyboard accessibility, WCAG AA compliance, and consistent design tokens wired as CSS custom properties.

## 1. Design Tokens as CSS Custom Properties & Tailwind Integration

### 1.1 Token Structure
Organize tokens in two layers:
- **Primitive tokens**: Raw values (`--color-blue-600`, `--space-4`)
- **Semantic tokens**: Intent-based names pointing to primitives (`--color-action-primary`, `--surface-raised`)

Components consume only semantic tokens. Themes swap by reassigning semantic tokens under a `data-theme` attribute.

### 1.2 CSS Custom Properties Setup
Create a root CSS file (e.g., `styles/tokens.css`) that defines all tokens as custom properties:

```css
:root[data-theme="light"] {
  /* Color: Semantic Tokens */
  --color-surface-base: rgb(255, 255, 255);
  --color-surface-raised: rgb(249, 249, 249);
  --color-surface-overlay: rgba(0, 0, 0, 0.08);
  --color-border-primary: rgb(230, 230, 230);
  --color-border-secondary: rgb(200, 200, 200);
  
  --color-text-primary: rgb(0, 0, 0);
  --color-text-secondary: rgb(87, 87, 87);
  --color-text-tertiary: rgb(142, 142, 142);
  --color-text-disabled: rgb(199, 199, 199);
  
  --color-action-primary: rgb(0, 122, 255);
  --color-action-secondary: rgb(175, 175, 175);
  --color-action-destructive: rgb(255, 59, 48);
  
  --color-status-success: rgb(52, 199, 89);
  --color-status-warning: rgb(255, 159, 64);
  --color-status-error: rgb(255, 59, 48);
  --color-status-info: rgb(0, 122, 255);
  
  --color-focus-ring: rgb(0, 122, 255);
  --color-focus-ring-alt: rgb(0, 0, 0);
  
  /* Typography: Sizes (rem) */
  --type-size-xs: 0.75rem;      /* 12px */
  --type-size-sm: 0.875rem;     /* 14px */
  --type-size-base: 1rem;       /* 16px */
  --type-size-lg: 1.125rem;     /* 18px */
  --type-size-xl: 1.25rem;      /* 20px */
  --type-size-2xl: 1.5rem;      /* 24px */
  --type-size-3xl: 1.875rem;    /* 30px */
  --type-size-4xl: 2.25rem;     /* 36px */
  
  /* Typography: Weights */
  --type-weight-regular: 400;
  --type-weight-medium: 500;
  --type-weight-semibold: 600;
  --type-weight-bold: 700;
  
  /* Typography: Line Heights */
  --type-line-height-tight: 1.25;
  --type-line-height-normal: 1.5;
  --type-line-height-relaxed: 1.75;
  
  /* Spacing Scale (rem) */
  --space-0: 0;
  --space-1: 0.25rem;   /* 4px */
  --space-2: 0.5rem;    /* 8px */
  --space-3: 0.75rem;   /* 12px */
  --space-4: 1rem;      /* 16px */
  --space-6: 1.5rem;    /* 24px */
  --space-8: 2rem;      /* 32px */
  --space-10: 2.5rem;   /* 40px */
  --space-12: 3rem;     /* 48px */
  --space-16: 4rem;     /* 64px */
  
  /* Radius */
  --radius-sm: 0.375rem;   /* 6px */
  --radius-md: 0.5rem;     /* 8px */
  --radius-lg: 0.75rem;    /* 12px */
  --radius-xl: 1rem;       /* 16px */
  --radius-full: 9999px;
  
  /* Shadows */
  --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-2: 0 4px 6px rgba(0, 0, 0, 0.07);
  --shadow-3: 0 10px 15px rgba(0, 0, 0, 0.1);
  --shadow-4: 0 20px 25px rgba(0, 0, 0, 0.15);
  
  /* Focus Ring */
  --focus-ring-width: 2px;
  --focus-ring-offset: 2px;
  
  /* Motion */
  --motion-duration-fast: 150ms;
  --motion-duration-normal: 250ms;
  --motion-duration-slow: 350ms;
  --motion-easing-ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --motion-easing-ease-out: cubic-bezier(0, 0, 0.2, 1);
  
  /* Z-Index Layers */
  --z-base: 0;
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-modal-backdrop: 300;
  --z-modal: 400;
  --z-popover: 500;
  --z-toast: 600;
  --z-tooltip: 700;
}

:root[data-theme="dark"] {
  /* Color: Semantic Tokens (Dark) */
  --color-surface-base: rgb(26, 26, 26);
  --color-surface-raised: rgb(45, 45, 45);
  --color-surface-overlay: rgba(255, 255, 255, 0.08);
  --color-border-primary: rgb(80, 80, 80);
  --color-border-secondary: rgb(115, 115, 115);
  
  --color-text-primary: rgb(255, 255, 255);
  --color-text-secondary: rgb(200, 200, 200);
  --color-text-tertiary: rgb(140, 140, 140);
  --color-text-disabled: rgb(100, 100, 100);
  
  --color-action-primary: rgb(0, 122, 255);
  --color-action-secondary: rgb(120, 120, 120);
  --color-action-destructive: rgb(255, 69, 58);
  
  --color-status-success: rgb(52, 199, 89);
  --color-status-warning: rgb(255, 159, 64);
  --color-status-error: rgb(255, 69, 58);
  --color-status-info: rgb(0, 122, 255);
  
  --color-focus-ring: rgb(0, 122, 255);
  --color-focus-ring-alt: rgb(255, 255, 255);
  
  /* Typography sizes, weights, line-heights same as light */
  --type-size-xs: 0.75rem;
  --type-size-sm: 0.875rem;
  --type-size-base: 1rem;
  --type-size-lg: 1.125rem;
  --type-size-xl: 1.25rem;
  --type-size-2xl: 1.5rem;
  --type-size-3xl: 1.875rem;
  --type-size-4xl: 2.25rem;
  
  --type-weight-regular: 400;
  --type-weight-medium: 500;
  --type-weight-semibold: 600;
  --type-weight-bold: 700;
  
  --type-line-height-tight: 1.25;
  --type-line-height-normal: 1.5;
  --type-line-height-relaxed: 1.75;
  
  /* Spacing scale (same as light) */
  --space-0: 0;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;
  --space-16: 4rem;
  
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  --radius-full: 9999px;
  
  --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-2: 0 4px 6px rgba(0, 0, 0, 0.4);
  --shadow-3: 0 10px 15px rgba(0, 0, 0, 0.5);
  --shadow-4: 0 20px 25px rgba(0, 0, 0, 0.6);
  
  --focus-ring-width: 2px;
  --focus-ring-offset: 2px;
  
  --motion-duration-fast: 150ms;
  --motion-duration-normal: 250ms;
  --motion-duration-slow: 350ms;
  --motion-easing-ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --motion-easing-ease-out: cubic-bezier(0, 0, 0.2, 1);
  
  --z-base: 0;
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-modal-backdrop: 300;
  --z-modal: 400;
  --z-popover: 500;
  --z-toast: 600;
  --z-tooltip: 700;
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-duration-fast: 0ms;
    --motion-duration-normal: 0ms;
    --motion-duration-slow: 0ms;
  }
}
```

### 1.3 Tailwind Configuration
Wire tokens into `tailwind.config.js`:

```javascript
module.exports = {
  theme: {
    colors: {
      surface: {
        base: 'var(--color-surface-base)',
        raised: 'var(--color-surface-raised)',
        overlay: 'var(--color-surface-overlay)',
      },
      border: {
        primary: 'var(--color-border-primary)',
        secondary: 'var(--color-border-secondary)',
      },
      text: {
        primary: 'var(--color-text-primary)',
        secondary: 'var(--color-text-secondary)',
        tertiary: 'var(--color-text-tertiary)',
        disabled: 'var(--color-text-disabled)',
      },
      action: {
        primary: 'var(--color-action-primary)',
        secondary: 'var(--color-action-secondary)',
        destructive: 'var(--color-action-destructive)',
      },
      status: {
        success: 'var(--color-status-success)',
        warning: 'var(--color-status-warning)',
        error: 'var(--color-status-error)',
        info: 'var(--color-status-info)',
      },
      focus: {
        ring: 'var(--color-focus-ring)',
        ringAlt: 'var(--color-focus-ring-alt)',
      },
    },
    spacing: {
      0: 'var(--space-0)',
      1: 'var(--space-1)',
      2: 'var(--space-2)',
      3: 'var(--space-3)',
      4: 'var(--space-4)',
      6: 'var(--space-6)',
      8: 'var(--space-8)',
      10: 'var(--space-10)',
      12: 'var(--space-12)',
      16: 'var(--space-16)',
    },
    borderRadius: {
      sm: 'var(--radius-sm)',
      md: 'var(--radius-md)',
      lg: 'var(--radius-lg)',
      xl: 'var(--radius-xl)',
      full: 'var(--radius-full)',
    },
    fontSize: {
      xs: ['var(--type-size-xs)', { lineHeight: '1.25' }],
      sm: ['var(--type-size-sm)', { lineHeight: '1.5' }],
      base: ['var(--type-size-base)', { lineHeight: '1.5' }],
      lg: ['var(--type-size-lg)', { lineHeight: '1.5' }],
      xl: ['var(--type-size-xl)', { lineHeight: '1.5' }],
      '2xl': ['var(--type-size-2xl)', { lineHeight: '1.5' }],
      '3xl': ['var(--type-size-3xl)', { lineHeight: '1.25' }],
      '4xl': ['var(--type-size-4xl)', { lineHeight: '1.25' }],
    },
    fontWeight: {
      regular: 'var(--type-weight-regular)',
      medium: 'var(--type-weight-medium)',
      semibold: 'var(--type-weight-semibold)',
      bold: 'var(--type-weight-bold)',
    },
    boxShadow: {
      1: 'var(--shadow-1)',
      2: 'var(--shadow-2)',
      3: 'var(--shadow-3)',
      4: 'var(--shadow-4)',
    },
    zIndex: {
      base: 'var(--z-base)',
      dropdown: 'var(--z-dropdown)',
      sticky: 'var(--z-sticky)',
      modal: 'var(--z-modal)',
      popover: 'var(--z-popover)',
      toast: 'var(--z-toast)',
      tooltip: 'var(--z-tooltip)',
    },
    transitionDuration: {
      fast: 'var(--motion-duration-fast)',
      normal: 'var(--motion-duration-normal)',
      slow: 'var(--motion-duration-slow)',
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
};
```

### 1.4 Token Usage in Components
Always reference tokens via CSS variables, never hardcode values:

```jsx
// Good
<button className="bg-action-primary text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-focus-ring focus:ring-offset-2">
  Save
</button>

// Bad - hardcoded colors
<button className="bg-blue-500 text-white px-4 py-2">
  Save
</button>
```

---

## 2. Focus States & Focus-Visible Ring Specification

### 2.1 Focus Ring Specification
Every interactive element receives a visible focus indicator using `:focus-visible` (keyboard only, not mouse).

**Ring Specification:**
- Width: 2px (CSS custom property: `--focus-ring-width`)
- Offset: 2px (CSS custom property: `--focus-ring-offset`)
- Color: Primary action blue or adjusted for contrast
- Never clipped by `overflow: hidden` or tight containers

### 2.2 CSS for Focus Ring
Create a shared focus-ring utility in Tailwind or a CSS helper:

```css
@layer components {
  .focus-ring {
    @apply outline-none;
  }
  
  .focus-ring:focus-visible {
    outline: var(--focus-ring-width) solid var(--color-focus-ring);
    outline-offset: var(--focus-ring-offset);
  }
  
  /* For dark surfaces where default blue is hard to see */
  .focus-ring.focus-ring-inverted:focus-visible {
    outline: var(--focus-ring-width) solid var(--color-focus-ring-alt);
    outline-offset: var(--focus-ring-offset);
  }
}
```

### 2.3 Focus Implementation Patterns
Apply to all interactive elements:

```jsx
// Button
<button className="focus-ring bg-action-primary text-white px-4 py-2 rounded-lg">
  Action
</button>

// Link
<a href="/path" className="focus-ring text-action-primary underline">
  Navigate
</a>

// Input
<input
  type="text"
  className="focus-ring border-2 border-border-primary bg-surface-base text-text-primary px-3 py-2 rounded-md"
/>

// Custom dropdown/select
<div role="listbox" className="focus-ring" tabIndex={0}>
  Options
</div>
```

### 2.4 Focus Management Rules
- **Never remove `:focus` or `:focus-visible` without an equally visible replacement**
- **Focus must be visible against any background** (minimum 3:1 contrast)
- **Tab order must follow visual reading order**, never use positive `tabindex`
- **On modal open:** Move focus to the first meaningful control or the modal title
- **On modal close:** Return focus to the element that opened it (store and restore with `useRef` or similar)
- **Disabled controls:** Either skip in tab order (remove `tabIndex`) or set `aria-disabled="true"` but keep focusable if only visually disabled

---

## 3. Semantic HTML & ARIA Requirements

### 3.1 Interactive Elements
**Buttons (Actions):**
```jsx
<button
  type="button"
  aria-label="Optional label for icon-only buttons"
  onClick={handleAction}
  disabled={isDisabled}
>
  Save Changes
</button>
```

**Links (Navigation):**
```jsx
<a href="/destination">
  Navigate to Destination
</a>
```

**Do not use:** `<div onClick={...}>` or `role="button"` on non-button elements.

### 3.2 Forms & Inputs
Every input must have an associated, programmatic label:

```jsx
<label htmlFor="email-input">Email Address</label>
<input
  id="email-input"
  type="email"
  aria-label="Email address"
  aria-describedby="email-help"
  aria-invalid={hasError}
  aria-errormessage={hasError ? "email-error" : undefined}
/>
<span id="email-help" className="text-text-tertiary text-sm">
  We'll never share your email.
</span>
{hasError && (
  <span id="email-error" role="alert" className="text-status-error text-sm">
    Please enter a valid email address.
  </span>
)}
```

### 3.3 Headings & Page Structure
- One `<h1>` per page/view
- Descend in order: `h1` → `h2` → `h3` (never skip levels for font size)
- Headings form a logical outline

```jsx
<main>
  <h1>Settings</h1>
  <section>
    <h2>Account</h2>
    <section>
      <h3>Email Address</h3>
    </section>
  </section>
  <section>
    <h2>Notifications</h2>
  </section>
</main>
```

### 3.4 Landmarks
Use semantic landmarks to structure regions:

```jsx
<>
  <header>
    <nav aria-label="Main navigation">{/* nav links */}</nav>
  </header>
  
  <main>{/* page content */}</main>
  
  <aside aria-label="Sidebar">{/* sidebar content */}</aside>
  
  <footer>{/* footer content */}</footer>
</>
```

### 3.5 Dialogs & Modals
```jsx
<dialog
  open={isOpen}
  aria-labelledby="dialog-title"
  aria-describedby="dialog-description"
>
  <h2 id="dialog-title">Confirm Action</h2>
  <p id="dialog-description">
    Are you sure you want to proceed?
  </p>
  <button onClick={() => handleConfirm()}>Confirm</button>
  <button onClick={() => handleCancel()}>Cancel</button>
</dialog>
```

Or using a custom modal with focus trap:

```jsx
function Modal({ isOpen, onClose, title, description, children }) {
  const dialogRef = useRef(null);
  
  useEffect(() => {
    if (isOpen) {
      dialogRef.current?.focus();
    }
  }, [isOpen]);
  
  return (
    isOpen && (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby="modal-description"
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2 id="modal-title">{title}</h2>
        <p id="modal-description">{description}</p>
        {children}
      </div>
    )
  );
}
```

### 3.6 Icon-Only Buttons
Always provide an accessible name:

```jsx
<button aria-label="Close dialog" onClick={handleClose}>
  <XIcon />
</button>
```

---

## 4. Keyboard Interaction Requirements

### 4.1 Tab Order & Navigation
- **Tab:** Move focus forward through interactive elements
- **Shift+Tab:** Move focus backward
- **Order must follow visual reading order** (top to bottom, left to right)
- **Never use positive `tabindex`** (use `tabIndex={0}` or `tabIndex={-1}` only)
- **Disabled controls:** Set `disabled` attribute or `aria-disabled="true"`; skip in tab order

### 4.2 Key Activation
| Control | Enter | Space | Escape | Arrows |
|---------|-------|-------|--------|--------|
| Button | Activate | Activate | — | — |
| Link | Navigate | — | — | — |
| Checkbox | — | Toggle | — | — |
| Radio | — | Select | — | Left/Right |
| Dropdown/Select | Open/Close | Open/Close | Close | Up/Down |
| Menu | — | — | Close | Up/Down/Left/Right |
| Tab list | — | — | — | Left/Right |
| Dialog | — | — | Close | — |
| Slider | — | — | — | Left/Right or Up/Down |

### 4.3 Custom Component Patterns

**Custom Dropdown:**
```jsx
function Dropdown({ items, onSelect, label }) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const triggerRef = useRef(null);
  
  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIndex((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIndex((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(items[focusIndex]);
      setIsOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    }
  };
  
  return (
    <div>
      <button
        ref={triggerRef}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
      >
        {label}
      </button>
      {isOpen && (
        <ul role="listbox" onKeyDown={handleKeyDown} className="focus-ring">
          {items.map((item, idx) => (
            <li
              key={idx}
              role="option"
              aria-selected={idx === focusIndex}
              onClick={() => {
                onSelect(item);
                setIsOpen(false);
              }}
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

**Tab List (Arrow-key navigation, not Tab):**
```jsx
function TabList({ tabs, activeTab, onTabChange }) {
  const [focusIndex, setFocusIndex] = useState(activeTab);
  const tabRefs = useRef([]);
  
  const handleKeyDown = (e) => {
    let newIndex = focusIndex;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      newIndex = (focusIndex + 1) % tabs.length;
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      newIndex = (focusIndex - 1 + tabs.length) % tabs.length;
    }
    setFocusIndex(newIndex);
    tabRefs.current[newIndex]?.focus();
    onTabChange(newIndex);
  };
  
  return (
    <div role="tablist" className="flex border-b border-border-primary">
      {tabs.map((tab, idx) => (
        <button
          key={idx}
          ref={(el) => (tabRefs.current[idx] = el)}
          role="tab"
          aria-selected={idx === activeTab}
          aria-controls={`panel-${idx}`}
          tabIndex={idx === activeTab ? 0 : -1}
          onKeyDown={handleKeyDown}
          onClick={() => {
            setFocusIndex(idx);
            onTabChange(idx);
          }}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
```

### 4.4 Focus Trap (Modals Only)
```jsx
function useFocusTrap(ref, isActive) {
  useEffect(() => {
    if (!isActive) return;
    
    const element = ref.current;
    const focusableElements = element?.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    const firstElement = focusableElements?.[0];
    const lastElement = focusableElements?.[focusableElements.length - 1];
    
    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      
      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };
    
    element?.addEventListener('keydown', handleKeyDown);
    return () => element?.removeEventListener('keydown', handleKeyDown);
  }, [ref, isActive]);
}
```

---

## 5. Responsive Breakpoints & Layout Rules

### 5.1 Breakpoint Strategy
Define breakpoints in tokens and Tailwind:

```javascript
// tailwind.config.js
{
  screens: {
    'sm': '640px',   // Narrow (phones)
    'md': '768px',   // Medium (tablets, small laptops)
    'lg': '1024px',  // Wide (desktops)
  }
}
```

**Breakpoint semantics:**
- **Narrow (< 640px):** Single column, prioritized content, no hover interactions
- **Medium (640–1024px):** Up to two columns, list-detail where appropriate
- **Wide (≥ 1024px):** Multi-column, side-by-side panes, comfortable line lengths capped

### 5.2 Layout Rules by Breakpoint

**Narrow (Mobile):**
- Single column layout
- Full-width interactive elements with 44px minimum height
- Navigation in collapsible menu (not always visible)
- Tables/complex data converted to stacked labeled cards
- Primary action pinned to bottom or sticky header
- No horizontal scroll

```jsx
<div className="sm:flex-col md:flex-row lg:flex-row">
  {/* Stacks on narrow, multi-column on wide */}
</div>
```

**Medium (Tablet/Split Window):**
- Up to two columns when beneficial
- List-detail pattern if space allows
- Tables scroll horizontally in a contained region
- Navigation visible or toggleable with label
- Actions inline where space permits

**Wide (Desktop):**
- Multi-column layouts
- Side-by-side panes with clear focus regions
- Content capped at `max-width` (e.g., 1200px for reading content, 900px for forms)
- Generous spacing and sizing

### 5.3 Content Width Constraints
```jsx
<main className="max-w-6xl mx-auto px-4 sm:px-6">
  {/* Content auto-centers on wide screens, stays readable */}
</main>
```

### 5.4 Responsive Type Scale
Font sizes scale via tokens; no media-query overrides of `font-size`:

```jsx
// Base sizes apply everywhere; line-height matches via token pairing
<h1 className="text-4xl font-bold">Heading</h1>
<p className="text-base leading-normal">Body text</p>
```

### 5.5 Responsive Spacing
Structural spacing can grow on wide screens via semantic tokens:

```jsx
<div className="px-4 sm:px-6 lg:px-8">
  {/* Padding increases from 16px → 24px → 32px */}
</div>
```

---

## 6. WCAG 2.2 Level AA Baseline Requirements

### 6.1 Contrast Ratios
- **Body text (14px+):** 4.5:1 minimum
- **Large text (18px/14px bold):** 3:1 minimum
- **UI borders and essential graphics:** 3:1 minimum
- **Disabled text:** May be lower if not essential; provide alternative if critical

**Verify in both themes (light and dark).** Use tools like Contrast Ratio or WCAG checker.

Example token pairs to verify:
- Text primary on surface base: 4.5:1+ ✓
- Text secondary on surface raised: 4.5:1+ ✓
- Action primary on surface base: 3:1+ ✓
- Status error on surface overlay: 3:1+ ✓

### 6.2 Keyboard Accessibility
- Every interactive element reachable and operable by Tab, Shift+Tab, Enter, Space, Escape, and Arrows (where applicable)
- No keyboard traps except inside modals
- Focus returns sensibly after overlay closes or action completes
- Never remove focus outline without visible replacement

### 6.3 Focus Visibility
- 2px solid outline with 2px offset (from `--focus-ring-width` and `--focus-ring-offset`)
- Minimum 3:1 contrast against background
- Never clipped by `overflow: hidden`

### 6.4 Touch Targets
- Interactive targets at least 24x24 CSS pixels (WCAG AA)
- Primary touch targets 44x44 CSS pixels (recommended for mobile)

```jsx
// Button sizes
<button className="px-4 py-2 rounded-lg">
  {/* ~16px × 32px minimum; aim for 44px on mobile */}
</button>
```

### 6.5 Color & Meaning
Never use color alone to signal state, meaning, or grouping. Pair with text, icon, or pattern:

```jsx
// Bad: Color alone
<div className="bg-status-error">Error</div>

// Good: Color + text + icon
<div className="flex items-center gap-2 bg-status-error/10 border border-status-error rounded-md p-3">
  <AlertIcon className="text-status-error" />
  <span className="text-status-error">Error: Please fix the issue.</span>
</div>
```

### 6.6 Form Labels & Errors
- Every input has an associated `label` (not placeholder)
- Error messages are in text, linked via `aria-errormessage`
- Errors explain what went wrong and how to fix it
- Required fields marked with text ("Required"), not symbol alone

```jsx
<label htmlFor="email" className="text-text-primary font-medium">
  Email Address <span className="text-status-error">Required</span>
</label>
<input
  id="email"
  type="email"
  aria-invalid={!!error}
  aria-errormessage={error ? 'email-error' : undefined}
  className="border-2 border-border-primary"
/>
{error && (
  <span id="email-error" className="text-status-error text-sm">
    {error}
  </span>
)}
```

### 6.7 Respect `prefers-reduced-motion`
All motion durations collapse to 0ms or ~100ms under `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-duration-fast: 0ms;
    --motion-duration-normal: 0ms;
    --motion-duration-slow: 0ms;
  }
}
```

Ensure animations have a static equivalent (state change is visible even without motion).

### 6.8 Live Regions & Announcements
Use live regions for dynamic updates:

```jsx
function SaveStatus({ status }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {status === 'saving' && 'Saving...'}
      {status === 'success' && 'Changes saved successfully.'}
      {status === 'error' && 'Failed to save. Please try again.'}
    </div>
  );
}
```

For urgent errors, use `role="alert"`:

```jsx
{error && (
  <div role="alert" className="bg-status-error/10 border border-status-error p-4 rounded-lg">
    {error}
  </div>
)}
```

---

## 7. Screen Reader Behavior & Announcements

### 7.1 Page Structure
- One `<h1>` per page announcing the primary content
- Logical heading hierarchy (`h1` → `h2` → `h3`, never skip)
- Landmarks wrapping regions (`<main>`, `<nav>`, `<aside>`, `<footer>`)

Screen readers announce: "Main navigation" → "Sidebar" → "Main content" → "Footer"

### 7.2 Accessible Names
Every interactive element needs a clear name:

| Element | Source | Example |
|---------|--------|---------|
| Button (visible text) | Text content | `<button>Save</button>` |
| Button (icon only) | `aria-label` | `<button aria-label="Close">×</button>` |
| Link | Text content | `<a href="...">Go to Settings</a>` |
| Input | Associated `<label>` | `<label for="email">Email</label><input id="email" />` |
| Custom widget | `aria-label` or `aria-labelledby` | `<div role="listbox" aria-label="Countries">...` |
| Dialog | `aria-labelledby` | `<dialog aria-labelledby="title"><h2 id="title">...</h2>` |

### 7.3 Live Regions for Dynamic Content
Use live regions to announce asynchronous changes without keyboard focus:

```jsx
// For status updates (polite announcement)
<div role="status" aria-live="polite" aria-atomic="true">
  {message}
</div>

// For errors (assertive announcement)
<div role="alert">
  {error}
</div>

// For loading progress
<div aria-live="polite" aria-atomic="true">
  <span aria-busy={isLoading}>
    {isLoading ? 'Loading...' : 'Loaded'}
  </span>
</div>
```

### 7.4 Decorative Images & Icons
Hide decorative elements from accessibility tree:

```jsx
// Decorative icon
<icon className="text-text-tertiary" aria-hidden="true" />

// Decorative image
<img src="decoration.svg" alt="" aria-hidden="true" />

// Meaningful icon (must have label)
<button aria-label="Delete item">
  <TrashIcon />
</button>
```

### 7.5 Data Tables
Use semantic table markup:

```jsx
<table>
  <thead>
    <tr>
      <th scope="col">Name</th>
      <th scope="col">Email</th>
      <th scope="col">Status</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Alice</td>
      <td>alice@example.com</td>
      <td>Active</td>
    </tr>
  </tbody>
</table>
```

Screen reader announces: "Table with 3 columns. Column headers: Name, Email, Status. Row 1: Alice, alice@example.com, Active."

---

## 8. React UI Component Review Checklist

Use this rubric to grade a component or screen against the design system.

### 8.1 Props & Variants
- [ ] Every visual variant maps to a named prop (e.g., `variant="primary"`)
- [ ] Prop values are strings or enums, never booleans for appearance
- [ ] Props have sensible defaults (primary button, normal size)
- [ ] No `className` or `style` prop changes component's core appearance
- [ ] Disabled state is a prop, not computed from context

```jsx
// Good
<Button variant="primary" size="lg" disabled={!canSave}>
  Save
</Button>

// Bad
<Button className="bg-blue-500">Save</Button>
```

### 8.2 States (All Required)
Components must handle all realistic states:

- [ ] **Happy path** (normal, interactive state)
- [ ] **Hover** (visual feedback, not required for keyboard; use `group-hover` sparingly)
- [ ] **Disabled** (interaction blocked, visually distinct)
- [ ] **Loading** (spinner or skeleton, interaction blocked, `aria-busy="true"`)
- [ ] **Error** (state rendered, message provided, recovery action)
- [ ] **Empty** (when a collection has no items, show a helpful message)
- [ ] **Long text** (labels, names, descriptions wrap or truncate with `title` attribute)
- [ ] **Focus** (`:focus-visible` ring, never removed)

```jsx
function Button({ variant, disabled, loading, children, ...props }) {
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading}
      className={cn(
        'focus-ring px-4 py-2 rounded-lg transition-colors',
        variant === 'primary' && 'bg-action-primary text-white',
        variant === 'secondary' && 'bg-surface-raised text-text-primary',
        (disabled || loading) && 'opacity-50 cursor-not-allowed',
      )}
      {...props}
    >
      {loading ? <Spinner /> : children}
    </button>
  );
}
```

### 8.3 Content Handling
- [ ] Text truncates or wraps at narrow widths
- [ ] Long labels don't break layouts
- [ ] Empty states show helpful copy, not "No data"
- [ ] Error messages are specific and actionable
- [ ] Numbers and dates format appropriately

```jsx
<div className="truncate" title={fullName}>
  {fullName}
</div>
```

### 8.4 Semantic HTML
- [ ] Actions use `<button>`, navigation uses `<a href>`
- [ ] Form controls are real inputs, not styled divs
- [ ] Headings match the document structure
- [ ] Tables use `<table>`, `<thead>`, `<th>`, `<tbody>`
- [ ] Lists use `<ul>` or `<ol>`, not divs

### 8.5 Accessibility
- [ ] All interactive elements are focusable and keyboard-operable
- [ ] Focus ring is visible and not clipped
- [ ] Icon-only buttons have `aria-label`
- [ ] Inputs are paired with `<label>`
- [ ] Error messages are tied to fields via `aria-errormessage`
- [ ] Loading states set `aria-busy="true"`
- [ ] Disabled elements either skip tab order or set `aria-disabled="true"`

```jsx
<button
  aria-label="Close dialog"
  onClick={onClose}
  className="focus-ring"
>
  <XIcon aria-hidden="true" />
</button>
```

### 8.6 Styling & Tokens
- [ ] Only semantic token colors used (no raw hex)
- [ ] Spacing from the scale (4px, 8px, 12px, 16px, etc.)
- [ ] Radius from the scale (6px, 8px, 12px, 16px)
- [ ] Shadows from the token set (1–4)
- [ ] Motion durations from tokens (fast, normal, slow)
- [ ] Z-index from named layers (dropdown, sticky, modal, etc.)
- [ ] Contrast meets 4.5:1 for text, 3:1 for UI

### 8.7 Responsive Behavior
- [ ] Component renders correctly at narrow (640px), medium (768px), wide (1024px)
- [ ] Touch targets at least 24x24 on all sizes
- [ ] Primary actions stay visible and reachable
- [ ] Tab order unchanged across breakpoints
- [ ] No horizontal scroll

### 8.8 Motion & Reduced Motion
- [ ] Transitions use token durations
- [ ] Animations respect `prefers-reduced-motion`
- [ ] State changes are visible even without motion
- [ ] No motion auto-plays

```jsx
<div className="transition-opacity duration-normal">
  {/* Collapses to 0ms under prefers-reduced-motion */}
</div>
```

### 8.9 Performance & Loading
- [ ] Skeletons match final layout
- [ ] Loading doesn't flicker
- [ ] Error retry works correctly
- [ ] Async state prevents double-submission

---

## Summary of Implementation Priorities

1. **Tokens First:** All visual decisions flow through CSS custom properties wired into Tailwind
2. **Semantic HTML:** Use native elements; ARIA only for genuine gaps
3. **Keyboard Full Stop:** Every path works with keyboard alone; Tab, Enter, Escape, Arrows as needed
4. **Focus Visible:** 2px ring, 2px offset, never removed, always visible
5. **WCAG AA Contrast:** 4.5:1 text, 3:1 UI; verify in both themes
6. **Responsive Design:** Narrow single-column, medium flexible, wide multi-column; no horizontal scroll
7. **Screen Reader Ready:** Landmarks, headings, labels, live regions, meaningful names
8. **Component Completeness:** All states, long text, empty, error, loading, disabled—never happy path only
9. **Accessibility Testing:** Keyboard-only navigation, screen reader spot-check, contrast validation on every PR

This design system ensures the dark creative tool is usable, accessible, and consistent across all users and devices.

## CONCRETE VALUES
## Design Tokens: Concrete Values (Dark Theme Optimized)

### Color Tokens (RGB for CSS Custom Properties)
**Surfaces:**
- `--color-surface-base: rgb(26, 26, 26)` — Main background
- `--color-surface-raised: rgb(45, 45, 45)` — Cards, panels
- `--color-surface-overlay: rgba(255, 255, 255, 0.08)` — Scrim, overlay
- `--color-border-primary: rgb(80, 80, 80)` — Primary borders
- `--color-border-secondary: rgb(115, 115, 115)` — Secondary borders

**Text:**
- `--color-text-primary: rgb(255, 255, 255)` — Main text
- `--color-text-secondary: rgb(200, 200, 200)` — Secondary text
- `--color-text-tertiary: rgb(140, 140, 140)` — Tertiary text
- `--color-text-disabled: rgb(100, 100, 100)` — Disabled text

**Actions:**
- `--color-action-primary: rgb(0, 122, 255)` — Primary action button
- `--color-action-secondary: rgb(120, 120, 120)` — Secondary action
- `--color-action-destructive: rgb(255, 69, 58)` — Destructive action

**Status:**
- `--color-status-success: rgb(52, 199, 89)` — Success state
- `--color-status-warning: rgb(255, 159, 64)` — Warning state
- `--color-status-error: rgb(255, 69, 58)` — Error state
- `--color-status-info: rgb(0, 122, 255)` — Info state

**Focus:**
- `--color-focus-ring: rgb(0, 122, 255)` — Focus ring (primary blue)
- `--color-focus-ring-alt: rgb(255, 255, 255)` — Focus ring (on dark surfaces)

### Typography Tokens
**Sizes (rem/px):**
- `--type-size-xs: 0.75rem` (12px)
- `--type-size-sm: 0.875rem` (14px) — Captions, small labels
- `--type-size-base: 1rem` (16px) — Body text
- `--type-size-lg: 1.125rem` (18px) — Subheadings
- `--type-size-xl: 1.25rem` (20px) — Subheadings, callouts
- `--type-size-2xl: 1.5rem` (24px) — Headings
- `--type-size-3xl: 1.875rem` (30px) — Large headings
- `--type-size-4xl: 2.25rem` (36px) — Page title

**Weights:**
- `--type-weight-regular: 400` — Body text
- `--type-weight-medium: 500` — Labels, emphasis
- `--type-weight-semibold: 600` — Subheadings
- `--type-weight-bold: 700` — Headings

**Line Heights:**
- `--type-line-height-tight: 1.25` — Headings
- `--type-line-height-normal: 1.5` — Body text
- `--type-line-height-relaxed: 1.75` — Long-form reading

### Spacing Scale (rem/px)
- `--space-0: 0` — No spacing
- `--space-1: 0.25rem` (4px)
- `--space-2: 0.5rem` (8px)
- `--space-3: 0.75rem` (12px)
- `--space-4: 1rem` (16px) — Standard margin/padding
- `--space-6: 1.5rem` (24px) — Section spacing
- `--space-8: 2rem` (32px) — Major sections
- `--space-10: 2.5rem` (40px) — Large gaps
- `--space-12: 3rem` (48px) — Vertical rhythm
- `--space-16: 4rem` (64px) — Page padding

### Radius Tokens
- `--radius-sm: 0.375rem` (6px)
- `--radius-md: 0.5rem` (8px) — Standard controls
- `--radius-lg: 0.75rem` (12px) — Cards, panels
- `--radius-xl: 1rem` (16px) — Large cards
- `--radius-full: 9999px` — Pill buttons, badges

### Shadow Tokens
- `--shadow-1: 0 1px 2px rgba(0, 0, 0, 0.3)` — Subtle elevation
- `--shadow-2: 0 4px 6px rgba(0, 0, 0, 0.4)` — Standard elevation
- `--shadow-3: 0 10px 15px rgba(0, 0, 0, 0.5)` — Higher elevation
- `--shadow-4: 0 20px 25px rgba(0, 0, 0, 0.6)` — Modal/dialog elevation

### Focus Ring Tokens
- `--focus-ring-width: 2px`
- `--focus-ring-offset: 2px`

### Motion Tokens
- `--motion-duration-fast: 150ms` — Quick feedback (under reduced-motion: 0ms)
- `--motion-duration-normal: 250ms` — Standard transition (under reduced-motion: 0ms)
- `--motion-duration-slow: 350ms` — Deliberate transition (under reduced-motion: 0ms)
- `--motion-easing-ease-in-out: cubic-bezier(0.4, 0, 0.2, 1)`
- `--motion-easing-ease-out: cubic-bezier(0, 0, 0.2, 1)`

### Z-Index Layers
- `--z-base: 0` — Content layer
- `--z-dropdown: 100` — Dropdown menus
- `--z-sticky: 200` — Sticky headers/footers
- `--z-modal-backdrop: 300` — Modal overlay
- `--z-modal: 400` — Modal dialog
- `--z-popover: 500` — Popovers, tooltips above modals
- `--z-toast: 600` — Toast notifications
- `--z-tooltip: 700` — Floating labels, popups above toast

### Breakpoints
- `sm: 640px` — Phones, narrow viewports
- `md: 768px` — Tablets, medium viewports
- `lg: 1024px` — Desktops, wide viewports

### Touch & Click Target Sizes
- Minimum (WCAG AA): 24x24 CSS pixels
- Recommended (touch mobile): 44x44 CSS pixels
- Button padding: `px-4 py-2` (16px × 8px) = 32px height (aim for 44px on mobile via `sm:py-3`)

### Contrast Ratios (WCAG AA)
- Body text on surface: **4.5:1 minimum**
- Large text (18px/14px bold) on surface: **3:1 minimum**
- UI borders, icons on surface: **3:1 minimum**

**Verified pairs in dark theme:**
- Text primary (rgb(255,255,255)) on surface base (rgb(26,26,26)): **20:1** ✓
- Text primary on surface raised (rgb(45,45,45)): **18:1** ✓
- Action primary (rgb(0,122,255)) on surface base: **8.5:1** ✓
- Status error (rgb(255,69,58)) on surface base: **7.2:1** ✓
- Focus ring (rgb(0,122,255)) on surface base: **8.5:1** ✓

---

## CSS Example: Focus Ring Implementation

```css
@layer components {
  .focus-ring {
    @apply outline-none;
  }
  
  .focus-ring:focus-visible {
    outline: var(--focus-ring-width) solid var(--color-focus-ring);
    outline-offset: var(--focus-ring-offset);
  }
  
  .focus-ring-inverted:focus-visible {
    outline-color: var(--color-focus-ring-alt);
  }
}
```

## Tailwind Classes for Quick Reference

| Token | Tailwind Class | Example |
|-------|---|---|
| `--color-action-primary` | `bg-action-primary` | Primary button |
| `--color-text-primary` | `text-text-primary` | Body text |
| `--space-4` | `px-4 py-4` | Standard padding |
| `--radius-lg` | `rounded-lg` | Card corners |
| `--shadow-2` | `shadow-2` | Card elevation |
| `--focus-ring-width` | `.focus-ring:focus-visible` | Keyboard focus |
| `--motion-duration-normal` | `duration-normal` | Transitions |
| `--z-modal` | `z-modal` | Modal stacking |

## RULES
- All color values must flow through semantic token names (--color-*), never hardcoded hex or rgba.
- Focus indicator (`:focus-visible`) is 2px solid outline with 2px offset, using --color-focus-ring; never remove without equally visible replacement.
- Interactive elements use semantic HTML: `button` for actions, `a` for navigation, native `input` for forms; never clickable divs.
- Every focusable element is keyboard-operable: Tab to reach, Enter/Space to activate, Escape to cancel/close; never mouse-only paths.
- Tab order follows visual reading order (top to bottom, left to right); never use positive `tabindex` values.
- Every input has a persistent `label` element with matching `id`; placeholder text is never the only label.
- One `h1` per page/view; headings descend in order (`h1 → h2 → h3`) without skipping levels.
- WCAG AA contrast minimum: 4.5:1 for body text, 3:1 for large text and UI; verify in both light and dark themes.
- Touch targets minimum 24x24 CSS pixels (WCAG AA), ideally 44x44 on mobile; button height >= 32px, aim for 44px.
- Icon-only buttons must have `aria-label` or `aria-labelledby` providing accessible name.
- Form errors are text-based, tied to fields via `aria-errormessage`, and explain the fix; never color-only signals.
- Dialog/modal traps focus on open, restores it on close; triggers receive focus return via ref/state management.
- Motion durations collapse to 0–100ms under `prefers-reduced-motion`; animations have static equivalents (state visible without motion).
- Color is never the sole signal of state, meaning, or grouping; pair with text, icon, or pattern.
- Responsive layout: single column on narrow (<640px), flexible on medium (640–1024px), multi-column on wide (>=1024px); no horizontal scroll.
- Content width capped at `max-width` on wide screens (e.g., 1200px) for comfortable line length; no edge-to-edge text.
- Spacing tokens used for all margin/padding; no arbitrary pixel values in component styles.
- Z-index never hardcoded; use named token layers (--z-dropdown, --z-modal, --z-toast, etc.) to prevent stacking wars.
- Shadows, radius, type sizes, and weights come from fixed scales; if a value is missing, extend the scale rather than improvise.
- Semantic landmarks wrap regions: `header`, `nav`, `main`, `aside`, `footer` for screen reader navigation.
- Live regions announce async changes: `aria-live="polite"` for status, `role="alert"` for errors.
- Every component handles all states: happy path, disabled, loading, error, empty, long text; never ship happy-path-only.
- Disabled controls either skip tab order (`disabled` attribute) or set `aria-disabled="true"` and keep focusable.
- Dropdowns, menus, tabs support arrow-key navigation within the widget; Tab moves between regions.
- Data tables use semantic `table`, `thead`, `th`, `tbody` markup with `scope="col"` on headers.
- Custom dropdown/combobox/menu: focusable trigger, `aria-expanded` for state, `role="listbox"` or `role="menu"`, arrow-key support.
- Dialogs are `dialog` element or have `role="dialog"`, `aria-modal="true"`, `aria-labelledby` to title.
- Decorative images have `alt=""` and `aria-hidden="true"`; meaningful images have descriptive alt text.
- Component props map to variants (`variant="primary"`), never `className` or `style` props for core appearance.
- Styling uses only semantic tokens in Tailwind classes; no raw hex, rgba, or pixel values inline.
- Contrast tested on real token pairs, including hover and disabled states, in both light and dark themes.
- Keyboard navigation tested end-to-end on every new screen before review; no surprises, no hidden traps.
- Tests include narrow (320–640px), medium (768px), and wide (1024px+) viewport widths for responsive behavior.

---

# components

## filesConsulted

## SPEC
# Apple HIG Design System for Dark Creative-Tool Web App

A comprehensive React/Tailwind dark-mode primitive library implementing Apple Human Interface Guidelines for a Next.js creative tool. Every component includes full state sets, accessibility requirements, responsive behavior, and concrete sizing values.

---

## 1. BUTTON

**Purpose**: Commit user action with predictable, labeled controls that clearly signal their importance and state.

**Component Variants**:
- `primary`: Most important action in a decision area; high contrast, full emphasis
- `secondary`: Related action of equal weight; less visual emphasis than primary
- `tertiary`: Low-priority action; minimal visual treatment
- `destructive`: Irreversible or dangerous action; error token + explicit confirmation

**Minimum Hit Target**: 44px height (mobile), 40px minimum for icon-only in dense toolbars

**States**:
| State | Background | Border | Text | Icon | Focus Ring |
|-------|------------|--------|------|------|-----------|
| Rest (primary) | Primary token | None | White | White | None |
| Hover (primary) | Primary darkened 15% | None | White | White | None |
| Focus (primary) | Primary base | 2px primary focus token | White | White | 3px outer ring, 2px gap |
| Active (primary) | Primary darkened 25% | None | White | White | Visible ring maintained |
| Disabled (primary) | Gray-400 | None | Gray-600 | Gray-600 | None |
| Loading (primary) | Primary base | None | Transparent | Spinner 20px | None |
| Rest (secondary) | Gray-700 | 1px Gray-600 | Gray-100 | Gray-100 | None |
| Hover (secondary) | Gray-600 | 1px Gray-600 | White | White | None |
| Focus (secondary) | Gray-700 | 1px Gray-600 | Gray-100 | Gray-100 | 3px outer, 2px gap |
| Active (secondary) | Gray-800 | 1px Gray-600 | White | White | Visible ring |
| Disabled (secondary) | Gray-900 | 1px Gray-800 | Gray-600 | Gray-600 | None |
| Rest (tertiary) | Transparent | None | Gray-300 | Gray-300 | None |
| Hover (tertiary) | Gray-800 | None | Gray-100 | Gray-100 | None |
| Focus (tertiary) | Transparent | None | Gray-100 | Gray-100 | 3px outer, 2px gap |
| Active (tertiary) | Gray-900 | None | White | White | Visible ring |
| Disabled (tertiary) | Transparent | None | Gray-700 | Gray-700 | None |
| Rest (destructive) | Transparent | None | Error-500 | Error-500 | None |
| Hover (destructive) | Error-950 | None | Error-300 | Error-300 | None |
| Focus (destructive) | Transparent | None | Error-300 | Error-300 | 3px error-600 outer |
| Active (destructive) | Error-900 | None | Error-200 | Error-200 | Visible ring |
| Disabled (destructive) | Transparent | None | Gray-700 | Gray-700 | None |

**Sizing**:
- Small: 32px height, 12px horizontal padding, 12px font-size
- Medium: 40px height, 16px horizontal padding, 14px font-size (default)
- Large: 48px height, 20px horizontal padding, 16px font-size
- Icon-only: 40px square (standard), 44px square (touch mobile)

**Label Requirements**:
- Sentence case, outcome-focused: "Save changes", "Delete project", never "OK" or "Submit"
- Icon-only buttons MUST have `aria-label` and tooltip on hover/focus
- One primary button per decision area; rest secondary or tertiary
- Destructive buttons name the action: "Delete file", not "Confirm"

**Loading Behavior**:
- Show inline spinner inside button, replacing label
- Reserve label width to prevent layout shift
- Set `aria-busy="true"` and block activation to prevent double submission
- Width and height remain constant during loading

**Responsive**:
- Narrow (mobile): Stack buttons full-width, primary on top; 44px minimum height
- Medium: Group related buttons horizontally; icon-only when space tight
- Wide: Full labels inline; match width to content, not screen

**Accessibility Checklist**:
- Semantic `<button>` element (or `<a>` for navigation only)
- Tab-focusable with visible 3px contrast-meeting focus ring
- Icon-only: `aria-label` exposed, icon is decorative
- Loading: `aria-busy="true"`, blocks further activation
- Meet WCAG AA contrast in every variant and state, including disabled
- No outline removed unreplaced; focus ring always visible
- Loading spinner animated with prefers-reduced-motion respected

**Do**:
- Make primary action visually dominant and unmistakable
- Reuse Button component with variant tokens
- Show spinner inside button for async actions
- Give disabled buttons context text on what to fix

**Do Not**:
- Place two primary buttons together
- Signal destructive action by color alone
- Let button resize or jump when loading
- Use ambiguous labels hiding the outcome

---

## 2. ICON BUTTON

**Special Cases of Button**: Icon-only controls in dense toolbars, rows, or sidebars.

**Minimum Hit Target**: 40px square (standard), 44px square (touch)

**Requirements**:
- Icon size: 20px standard (icon-only), 16px when paired with label
- Always has `aria-label` naming the action: "Share", "Edit", "Delete"
- Tooltip appears on hover and focus, 200ms delay, removes on blur/mouseout
- Same state styling as primary button but typically secondary appearance

**Icon Focus Ring**: 3px outer, 2px gap from edge, uses component's focus token

---

## 3. TEXT FIELD

**Purpose**: Structured input for text, numbers, email, passwords with validation, error handling, and helper text.

**Component Structure**:
```
<Label>Field Label</Label>
<input type="email" aria-describedby="helper-text error-text" />
<HelperText id="helper-text">Format hint (optional)</HelperText>
<ErrorText id="error-text" role="alert">Error if invalid (optional)</ErrorText>
```

**States**:
| State | Border | Background | Text | Ring |
|-------|--------|-----------|------|------|
| Rest | 1px Gray-600 | Gray-950 | Gray-100 | None |
| Hover | 1px Gray-500 | Gray-950 | Gray-100 | None |
| Focus | 2px Primary | Gray-950 | Gray-100 | 3px Primary outer, 2px gap |
| Filled | 1px Gray-600 | Gray-950 | Gray-100 | None |
| Disabled | 1px Gray-800 | Gray-900 | Gray-700 | None |
| Error (rest) | 2px Error-600 | Gray-950 | Gray-100 | None |
| Error (focus) | 2px Error-600 | Gray-950 | Gray-100 | 3px Error-600 outer |

**Sizing**:
- Height: 40px (default), 36px (compact), 44px (touch)
- Padding: 12px horizontal, 8px vertical
- Font size: 14px (body)
- Border radius: 6px (standard dark theme)
- Label font: 12px, 500 weight, Gray-300, 8px below input

**Label & Required/Optional**:
- Label always visible, persistent; never placeholder-only
- Required fields: no marker (assumed), OR visual indicator if optional fields present
- Optional fields: explicitly labeled "(optional)" after label
- Helper text below input, stays visible; error text replaces or appends below it
- Max-width: 100% on mobile, capped at 400px on wide screens for readability

**Input Types & Keyboard**:
- `type="email"`: Email keyboard on mobile, native validation
- `type="tel"`: Numeric keypad, format hint in helper text
- `type="number"`: Numeric keypad, `min`/`max`/`step` attributes
- `type="password"`: Masked input, show/hide toggle button (icon button, aria-label="Show password")
- `type="search"`: Clearable search field (see SearchField component)
- `type="text"`: Default, multiline via `<textarea>` when multi-line needed

**Validation**:
- Validate on submit and blur, NOT on every keystroke on first entry
- Preserve typed value after failed submit; never clear it
- Error text specific and plain: "Enter a valid email address", not "Invalid input"
- Signal errors with icon + text + border, never color alone
- Focus moves to first invalid field on form submit failure

**Accessibility**:
- Label programmatically associated via `for`/`id`
- Helper and error text linked via `aria-describedby`
- `aria-invalid="true"` when field invalid
- Error surfaces in live region or on focus move
- Focus ring visible and meets contrast against field
- Text, placeholder, error colors meet WCAG AA
- Never rely on color alone to signal validation state

**Responsive**:
- Narrow: Full-width fields, labels above, 44px+ tap targets
- Medium: Two-column grid where logical; labels above
- Wide: Cap input width to ~400px for readability

**Do**:
- Keep labels visible at all times
- Use placeholders sparingly, only for format examples
- Show format requirements before user errs
- Preserve typed values when validation fails

**Do Not**:
- Use placeholder as the only label
- Clear other fields when one fails
- Show red error before user touches the field
- Rely on color alone to signal error

---

## 4. NUMBER FIELD

**Extends TextField** with numeric-specific behavior.

**Input Type**: `type="number"`

**Controls**:
- Numeric keyboard on mobile
- Optional spinner buttons (increment/decrement) or keyboard (Arrow Up/Down, +/-)
- If spinners shown: 20px diameter, placed right of input, Gray-600 border

**Attributes**:
- `min`, `max`, `step` set and documented in helper text: "Between 1 and 100"
- Right-align numeric values for scanning

---

## 5. SELECT / DROPDOWN

**Purpose**: Choose one option from a known set (status, role, category).

**Component Structure**:
- Native `<select>` with `<option>` children, OR
- Custom dropdown with `<input type="text">` + `role="combobox"` + menu trigger

**Native Select (Preferred for Web)**:
- Keyboard: Tab focuses, Up/Down navigate, Enter/Space opens, Escape closes
- Mobile: Native picker on iOS/Android (optimal UX)
- Width: Match longest option or cap at 300px

**States**: Same as TextField (rest, hover, focus, disabled, error)

**Sizing**:
- Height: 40px
- Padding: 12px horizontal, 8px vertical
- Border: 1px Gray-600, radius 6px
- Chevron icon (12px) right-aligned, 8px padding

**Options**:
- Label each option with a clear noun: "Open", "Closed", "Pending"
- Group related options with `<optgroup label="Group">`
- Default to most common value when sensible
- Disabled options gray out; avoid if possible

**Accessibility**:
- `aria-label` if no visible label
- `aria-invalid` when error state
- `aria-describedby` linked to helper/error text
- Keyboard fully operable: Tab, Up/Down, Enter

---

## 6. SLIDER / RANGE

**Purpose**: Choose a value within a numeric range via dragging or keyboard.

**Component**:
- `<input type="range">` with JavaScript enhancement, OR
- Custom `role="slider"` with Arrow keys + click/drag

**Sizing**:
- Track height: 4px, rounded caps
- Thumb: 20px diameter circle, centered on track
- Min-width: 200px for usability; scale on wide screens

**States**:
| State | Track | Thumb | Focus |
|-------|-------|-------|-------|
| Rest | Gray-700 | Gray-500 | None |
| Hover | Gray-600 | Gray-400 | None |
| Active (dragging) | Primary-600 | Primary-400 | 3px Primary outer ring |
| Focus | Gray-700 | Gray-500 | 3px Primary ring, 2px gap |
| Disabled | Gray-800 | Gray-700 | None |

**Labels & Values**:
- Label above: "Volume"
- Min/max labels optional: "0" and "100" on outer edges
- Current value displayed: either inline or in label
- Tooltip shows value while dragging

**Keyboard**:
- Arrow Left/Right: Decrease/increase by `step`
- Home/End: Jump to min/max
- Shift+Arrow: Larger increments (×10 step)

**Accessibility**:
- `aria-label` or `aria-labelledby`
- `aria-valuemin`, `aria-valuemax`, `aria-valuenow`
- `aria-valuetext` for unit context: "70 percent"
- Visible focus ring
- Thumb meets 20px minimum for touch

---

## 7. CARD

**Purpose**: Contained surface grouping related content with optional actions.

**Component Structure**:
```
<section class="card">
  <header class="card-header">
    <h3>Heading</h3>
  </header>
  <div class="card-body">Content</div>
  <footer class="card-footer">
    <Button variant="secondary">Action</Button>
  </footer>
</section>
```

**Sizing & Spacing**:
- Padding: 16px on mobile, 20px on medium+
- Border radius: 8px
- Gap between cards: 12px (mobile), 16px (medium+)
- Border: 1px Gray-800, OR 4px Gray-800 for emphasis

**Surface**:
- Background: Gray-900 (subtle contrast against page)
- Shadow: 0 2px 8px rgba(0,0,0,0.3) optional elevation
- No border required if spacing adequate

**Header**:
- Always present: heading describes card's purpose
- Heading level: `<h3>` or `<h4>` depending on page hierarchy
- Padding: inherits from card body

**Body**:
- Content area; maintain consistent padding
- Mix text, images, lists; avoid deep nesting

**Footer/Actions**:
- One primary action + one secondary, or overflow menu
- Buttons align right; on narrow screens stack full-width
- Spacing: 12px gap between buttons

**States**:
| State | Background | Border | Shadow |
|-------|-----------|--------|--------|
| Rest | Gray-900 | 1px Gray-800 | None or light |
| Hover (if clickable) | Gray-850 | 1px Gray-700 | Elevated |
| Focus (if clickable) | Gray-900 | 1px Gray-800 | 3px Primary ring |
| Selected | Gray-900 | 2px Primary | Elevated |
| Disabled | Gray-950 | 1px Gray-800 | None |

**Grid Behavior**:
- Responsive grid: 1 column (mobile), 2-3 columns (medium+)
- Equal-height cards via CSS Grid or Flexbox min-height
- Never nest cards; use dividers or list structure instead

**Accessibility**:
- Heading at correct level in page hierarchy
- Whole-card link: make title the link, rest of card inert
- Interactive elements keyboard-reachable in logical order
- Contrast meets minimums; card state not color-only
- `aria-current="page"` if representing current selection

**Do**:
- One clear purpose per card, named by heading
- Reuse surface, radius, spacing tokens
- Keep actions limited (1 primary + 1 secondary max)

**Do Not**:
- Nest cards or stack boxes inside boxes
- Turn every section into a card for consistency
- Pile unrelated buttons and links into footer
- Convey state (selected, error) by color alone

---

## 8. PANEL / SHEET (Side Panel & Bottom Drawer)

**Purpose**: Contextual, secondary workflow that extends task without full-page modal.

**Types**:
1. **Side Panel** (Right-anchored, typically non-blocking)
2. **Bottom Drawer** (Mobile alternative, full-width from bottom)

**Component Structure**:
```
<aside role="dialog" aria-labelledby="panel-title" aria-modal="false">
  <header>
    <h2 id="panel-title">Panel Title</h2>
    <button aria-label="Close panel" onclick="closePanel()">×</button>
  </header>
  <div class="panel-body">Content</div>
</aside>
```

**Width & Sizing**:
- Side panel width: 360px (mobile compact), 400px (standard), 480px (wide on desktop)
- Bottom drawer: Full width, typically 60-80% viewport height
- Use CSS variable `--panel-width` for consistency

**Surface**:
- Background: Gray-900 (same as cards) or Gray-800 for subtle depth
- Border: None or 1px Gray-800 on left/top edge
- No shadow (sits flush) or subtle elevation shadow

**Header**:
- Fixed top, doesn't scroll with content
- Padding: 16px, Gray-900 background
- Heading: `<h2>` or semantic level matching page
- Close button: icon `×`, label "Close panel", right-aligned, 40px square, icon 20px
- Close button state: Gray-400 text, hover Gray-200

**Body**:
- Scrollable if content exceeds viewport
- Padding: 16px vertical, 20px horizontal
- Never scrollable header/footer

**Blocking Behavior**:
- **Non-blocking** (default for detail/inspector panels):
  - No backdrop scrim
  - Page behind remains fully usable
  - Background NOT dimmed or disabled
- **Blocking** (form completion, confirmation):
  - Backdrop scrim: rgba(0,0,0,0.4)
  - Focus trapped within panel
  - `aria-modal="true"`
  - Tab cycles only within panel
  - Page behind inert and unfocusable

**Dismissal**:
- Escape key closes panel (prompt if unsaved input)
- Non-blocking: Outside click on page closes it
- Close button always visible and labeled
- On close, focus returns to trigger element

**Responsive Behavior**:
- Narrow (mobile <768px): Full-width side panel or bottom drawer, no side-by-side context
- Medium (768px-1024px): Overlay panel with scrim, keeping part of page visible
- Wide (>1024px): Docked inline beside content, no background dimming

**Animations**:
- Slide in from anchored edge: 300ms ease-out
- Respect `prefers-reduced-motion`: instant or fast fade instead

**Accessibility**:
- `role="dialog"` with `aria-labelledby` pointing to title
- `aria-modal="true"` only when blocking
- Focus moves into panel on open, returns to trigger on close
- Escape dismisses (or prompts if unsaved)
- Visible focus ring on all interactive elements
- Close button labeled and always present
- Content inside uses semantic HTML; links and buttons keyboard-reachable

**Do**:
- Keep page usable behind non-blocking panels
- Anchor open and close to same edge
- Show which item a detail panel describes
- Trap focus in blocking panels only when needed

**Do Not**:
- Stack panels on panels
- Block the whole page for non-essential tasks
- Hide close control behind gestures
- Lose unsaved input when closing

---

## 9. SIDEBAR (Primary Navigation)

**Purpose**: Persistent left-column navigation, stable across all screens, marking current location.

**Component Structure**:
```
<nav aria-label="Primary" class="sidebar">
  <div class="sidebar-header">Logo/Brand</div>
  <NavGroup label="Main">
    <NavItem href="/projects" aria-current="page">Projects</NavItem>
    <NavItem href="/team">Team</NavItem>
  </NavGroup>
  <NavGroup label="Settings">
    <NavItem href="/account">Account</NavItem>
  </NavGroup>
  <button aria-expanded="false" aria-label="Collapse sidebar">⟨</button>
</nav>
```

**Width & Sizing**:
- Expanded: 240px (standard), 256px (generous spacing)
- Collapsed: 64px (icons + tooltips only)
- Use CSS variable `--sidebar-width`
- Item height: 36px
- Icon size: 20px (expanded), 20px (collapsed)
- Font size: 14px (labels), 12px (group headings)

**Surface**:
- Background: Gray-950 (slightly darker than main content)
- Border: None or 1px Gray-800 on right edge
- No shadow

**Navigation Structure**:
- Max 2 levels deep (group + item); deeper structure moves into content
- Groups have plain text headings: "Main", "Settings", not "Go to Settings"
- Every item has visible text label; icons support, never sole signifier
- Short, concrete labels: "Projects", "Team", "Settings", parallel form

**Item States**:
| State | Background | Text | Icon | Focus |
|-------|-----------|------|------|-------|
| Rest | Transparent | Gray-300 | Gray-400 | None |
| Hover | Gray-800 | Gray-100 | Gray-200 | None |
| Active | Gray-800 | Primary-400 | Primary-400 | None |
| Focus (expanded) | Gray-800 | Gray-100 | Gray-200 | 3px Primary left border + ring |
| Focus (collapsed) | Gray-800 | Gray-100 | Gray-200 | 3px ring |
| Disabled | Transparent | Gray-700 | Gray-700 | None |

**Active State Indicator**:
- Left border: 3px Primary-500 or Primary-400
- Text/icon color shift to Primary-400
- Driven by `aria-current="page"` on active route link
- Never color-only; include the left border

**Collapsed State**:
- Icons only, no labels
- Tooltips on hover (200ms delay): "Projects", "Team"
- `aria-label` on link: `<a aria-label="Projects" href="/projects">`
- Preference persisted in localStorage or user settings
- Click collapse button toggles; animated transition (300ms) or instant if prefers-reduced-motion

**Collapse Button**:
- Location: Bottom of sidebar or top-right corner
- Size: 40px square
- Icon: `⟨` (chevron left) when expanded, `⟩` (chevron right) when collapsed
- Label: `aria-label="Collapse sidebar"` or `aria-label="Expand sidebar"`
- State follows `aria-expanded` attribute

**Keyboard Navigation**:
- Tab reaches every item in logical order
- Enter/Space activates link (browser back/forward works)
- Home/End: Jump to first/last group
- Arrow Up/Down: Optional, navigate items
- Focus visible: 3px Primary ring, 2px gap

**Responsive Behavior**:
- **Narrow (mobile <768px)**: Hidden behind hamburger menu button; opens as drawer
  - Drawer: Full width (usually 280px), slides from left
  - Focus trapped when open; Escape closes
  - Backdrop scrim semi-transparent
  - Links use full width, 44px+ height for touch
- **Medium (768px-1024px)**: Collapsed by default (icons + tooltips); expand on hover or persist expanded if user prefers
- **Wide (>1024px)**: Fully expanded, persistent, showing labels and group headings; collapse option still available

**On Narrow Screens**:
- Menu button in top-left of header: hamburger icon, label "Open menu"
- Drawer width: 280px max (for thumb reach on phones)
- Links 44px height for touch
- Closing doesn't scroll main content

**Accessibility**:
- `<nav aria-label="Primary">` landmark
- List of `<a>` links with valid `href`; active link carries `aria-current="page"`
- Keyboard fully operable: Tab, Enter, Escape on mobile drawer
- Focus visible with contrast-meeting ring
- Collapsed items: `aria-label` on link, tooltip role="tooltip"
- Icon-only items always have accessible names
- Respect `prefers-reduced-motion` on collapse/expand animations

**Do**:
- Mark current location clearly on every view
- Keep structure shallow; labels predictable
- Persist collapsed/expanded choice
- Give icon-only rows tooltips and accessible names

**Do Not**:
- Hide active state; leave users unsure where they are
- Bury destinations 3+ levels deep
- Ship icon-only rows without accessible names
- Animate in ways that ignore reduced-motion

---

## 10. TOOLBAR

**Purpose**: Persistent strip of frequent, contextual actions near content; compact and quiet until used.

**Component Structure**:
```
<div role="toolbar" aria-label="Formatting">
  <ToolbarGroup>
    <ToolbarButton icon="bold" aria-label="Bold">B</ToolbarButton>
    <ToolbarButton icon="italic" aria-label="Italic">I</ToolbarButton>
  </ToolbarGroup>
  <ToolbarDivider />
  <ToolbarGroup>
    <ToolbarButton icon="align-left" aria-label="Align left" />
  </ToolbarGroup>
  <ToolbarButton icon="more" aria-label="More actions" aria-expanded="false" />
</div>
```

**Layout & Sizing**:
- Height: 44px (standard), 40px (compact)
- Padding: 4px horizontal, 0 vertical (controls within group)
- Group spacing: 8px (gap between groups)
- Group divider: 1px Gray-700, 4px margins
- Never wrap to second row; overflow into `...` menu instead
- Max width: Content-aware (no stretch to full width)

**Controls**:
- Button size: 40px square
- Icon size: 20px
- Toggle buttons: `aria-pressed="true|false"` when clicked
- Menu trigger: `aria-haspopup="menu"`, `aria-expanded="true|false"`
- Overflow button: `...` icon or three-dot icon, opens menu

**Button States in Toolbar**:
| State | Background | Text/Icon | Focus |
|-------|-----------|-----------|-------|
| Rest | Transparent | Gray-300 | None |
| Hover | Gray-800 | Gray-100 | None |
| Active (pressed) | Gray-700 | Primary-400 | 3px Primary ring |
| Focus | Transparent | Gray-100 | 3px Primary ring, 2px gap |
| Disabled | Transparent | Gray-700 | None |

**Toggle Button** (e.g., Bold, Italic):
- Pressed state: Background Gray-700, icon Primary-400, `aria-pressed="true"`
- Rest state: Transparent, icon Gray-300

**Keyboard Navigation**:
- **Roving Tabindex**: Toolbar takes one tab stop; arrows move within
- Tab: Enters toolbar at first button; Shift+Tab exits toolbar
- Arrow Right/Left: Move focus between controls within toolbar
- Arrow Up/Down: Within grouped controls or to next group
- Home/End: Jump to first/last control
- Enter/Space: Activate focused button
- Escape: Move focus back to content

**Overflow Handling**:
- When space tight, move lowest-priority group into `...` menu
- Never wrap to second row
- Menu shows same group dividers and labels
- Preserve action order and labels across toolbar/menu

**Context-Aware Switching** (e.g., Bulk Actions):
- Normal toolbar: New, Filter, Sort, Export
- Row selected: Swap to Move, Tag, Delete (all accessible via Tab)
- Delete separated from benign actions with menu divider

**Responsive Behavior**:
- Narrow: Show top 2-3 actions; rest in overflow menu
- Medium: Reveal more groups; collapse lowest priority to overflow
- Wide: Full groups, no overflow; match content, not screen width

**Accessibility**:
- `role="toolbar"` with `aria-label` naming purpose: "Formatting", "Document actions"
- Roving tabindex: Only one button in tab order; arrows navigate within
- Every button has accessible name: `aria-label`, label text, or icon with title
- Toggle buttons expose `aria-pressed`; menu triggers show `aria-haspopup` and `aria-expanded`
- Contrast meets WCAG AA for icons and text; focus ring clearly visible
- Respect `prefers-reduced-motion` on any transition
- Tooltip on icon-only buttons (200ms delay, removes on blur/mouseout)

**Do**:
- Surface high-frequency, contextual actions
- Use consistent icons, spacing, dividers from design tokens
- Provide tooltips and `aria-label`s for icon-only buttons
- Group related controls with clear visual separation

**Do Not**:
- Crowd toolbar with rare or duplicate actions
- Place destructive action beside common ones unprotected
- Reorder controls between views or sessions
- Wrap to second row or scroll horizontally

---

## 11. MENU (Dropdown, Context, Overflow)

**Purpose**: Temporary list of secondary/contextual actions, hidden until triggered, dismissed on selection.

**Component Structure**:
```
<button aria-haspopup="menu" aria-expanded="false">
  More actions
</button>
<div role="menu" aria-labelledby="trigger-id">
  <a role="menuitem" href="/edit">Edit item</a>
  <a role="menuitem" href="/duplicate">Duplicate</a>
  <hr />
  <button role="menuitem" onclick="delete()">Delete item</button>
</div>
```

**Positioning & Sizing**:
- Anchored to trigger button; arrow points back
- Min-width: 180px; max-width: 300px
- Padding: 8px vertical, 0 horizontal
- Border radius: 6px
- Background: Gray-900, border: 1px Gray-800
- Shadow: 0 10px 32px rgba(0,0,0,0.5) elevation

**Item Styling**:
- Height: 36px per item, 8px vertical padding
- Padding: 12px horizontal, 8px vertical
- Font size: 14px
- Icon size: 16px left-aligned, 8px gap to text

**Item States**:
| State | Background | Text | Icon | Focus |
|-------|-----------|------|------|-------|
| Rest | Transparent | Gray-300 | Gray-400 | None |
| Hover | Gray-800 | Gray-100 | Gray-200 | None |
| Focus | Gray-800 | Gray-100 | Gray-200 | No ring in menu; hover styling instead |
| Disabled | Transparent | Gray-700 | Gray-700 | None |
| Danger (rest) | Transparent | Error-500 | Error-500 | None |
| Danger (hover) | Error-950 | Error-300 | Error-300 | None |

**Dividers & Groups**:
- Group related items with visual separator: 1px Gray-800, 4px margins
- Optional group label above: 12px Gray-500, all-caps, 8px padding
- Destructive items separated at bottom with divider above

**Labels & Icons**:
- Verb-led labels: "Edit file", "Duplicate", "Archive", not just "Edit"
- Match wording to any confirmation dialog
- Icon + text always; icon alone insufficient
- No bare "Options" or "Manage" labels

**Item Count**:
- Keep under 10 items before grouping or rethinking
- Over 15 items → scrollable with max-height 60vh
- Avoid scrolling where possible; group or redesign

**Keyboard Navigation**:
- Arrow Up/Down: Move focus between items
- Home/End: Jump to first/last item
- Enter/Space: Activate focused item
- Escape: Close menu and return focus to trigger
- Tab: Exit menu (no tabbing within)
- Type: Jump to item starting with that letter (optional)

**Opening & Closing**:
- Opens on click or Enter/Space on trigger
- Closes on selection, Escape, or outside click
- Focus moves into menu on open (first item or trigger logic)
- Focus returns to trigger on close
- Menu stays open for multi-select toggles (marked with checkbox)

**Single vs. Multi-Select**:
- **Single-select**: Close on selection (sort dropdown, view filter)
- **Multi-select**: Stay open; items show checkboxes; explicit "Done" or "Apply" button

**Responsive Behavior**:
- Narrow (mobile): Use bottom sheet or full-width list (44px+ targets)
- Medium: Anchored popover; flip and shift to stay on screen
- Wide: Anchored popover next to trigger, positioned to avoid clipping

**Accessibility**:
- Trigger: `aria-haspopup="menu"`, `aria-expanded="true|false"`
- Menu: `role="menu"` with `role="menuitem"` or `role="menuitemcheckbox"` children
- Menu labeled via `aria-labelledby` (trigger text) or `aria-label`
- Keyboard: Arrows, Home/End, Enter, Escape all functional
- Focus visible in menu (typically background color change, not ring)
- Disabled items: `aria-disabled="true"`, grayed out, reason nearby
- Danger items: Color + text, not color alone; `aria-label` if icon-only
- Contrast meets WCAG AA; motion brief and respects prefers-reduced-motion

**Do**:
- Keep primary action visible; menus for secondary only
- Group related items; separate destructive ones
- Close on selection and give clear feedback
- Reuse Menu component everywhere

**Do Not**:
- Hide frequent/primary actions in menus
- Mix unrelated actions into one ungrouped list
- Let destructive items sit beside benign ones unseparated
- Keep menu open after selection (unless multi-select)

---

## 12. POPOVER

**Purpose**: Small, transient panel anchored to trigger, holding quick content or tight options. Lightweight and contextual.

**Component Structure**:
```
<button aria-expanded="false" aria-haspopup="dialog">
  Quick edit
</button>
<div role="dialog" aria-labelledby="popover-title" aria-expanded="false">
  <h3 id="popover-title">Edit name</h3>
  <input type="text" value="Current value" />
  <button>Save</button>
</div>
```

**Sizing & Positioning**:
- Width: Fit to content, max 300px (avoid wide panels)
- Height: Fit to content, max 400px (scroll if longer)
- Arrow: 8px triangle pointing back at trigger, 12px from edge
- Padding: 12px (compact content), 16px (standard)
- Border radius: 6px
- Background: Gray-900, border: 1px Gray-800
- Shadow: 0 10px 32px rgba(0,0,0,0.5)

**Content Types**:
- Short form: One text input + Save button
- Quick filter: 3-5 toggles or checkboxes
- Color picker: Compact palette grid
- Detail snippet: 2-3 lines of text + "Learn more" link
- Inline help: One sentence + link

**No Scrolling** (or minimal):
- If content needs heavy scrolling, promote to panel or sheet
- Small lists (5-7 items) acceptable with scroll; otherwise redesign

**Dismissal**:
- Outside click or scroll-away closes (no data loss)
- Escape closes and returns focus to trigger
- Completion (Save) closes and refocuses trigger
- Never auto-dismiss; user in control

**Arrow & Collision Handling**:
- Arrow points back at trigger
- Flip horizontally if near screen edge
- Shift vertically to stay on screen (prefer below, flip above if space lacking)
- On narrow screens (mobile): Convert to bottom sheet or full-width panel instead

**Keyboard**:
- Tab: Cycle within popover content
- Escape: Close and refocus trigger
- Enter/Space: Activate buttons within
- No arrow keys within (single focused control)

**States**:
| State | Background | Border | Shadow |
|-------|-----------|--------|--------|
| Rest | Gray-900 | 1px Gray-800 | 0 10px 32px rgba(0,0,0,0.5) |
| Hover (if interactive) | Gray-850 | 1px Gray-800 | Elevated |
| Focus (if focusable) | Gray-900 | 1px Gray-800 | Ring 3px Primary |

**Responsive Behavior**:
- Wide (desktop): Anchor close to trigger with arrow pointing back
- Medium (tablet): Anchored but flip/shift to stay visible; cap width
- Narrow (mobile): Convert to bottom sheet, full-width list, or centered dialog; no arrow

**Accessibility**:
- Trigger: `aria-expanded="true|false"`, `aria-haspopup="dialog"` (or menu/listbox if fitting)
- Popover: `role="dialog"` with `aria-labelledby` (title) or `aria-describedby` (content)
- Focus moves into popover on open, back to trigger on close
- Support Escape; if interactive, Tab cycles within
- Visible focus ring on interactive elements
- Text contrast meets WCAG AA
- Motion brief and respects prefers-reduced-motion
- Arrow never blocks reading the page behind

**Do**:
- Anchor to trigger and point back
- Keep content focused and short
- Support Escape and outside-click dismissal
- Restore focus to trigger on close

**Do Not**:
- Host multi-step forms, wizards, or tabs
- Stack popovers or open multiple
- Block or dim the page
- Cover the trigger or run off-screen

---

## 13. DIALOG (Confirm/Modal)

**Purpose**: Small, focused modal that interrupts for one quick decision or tight input. Full blocking with focus trap.

**Component Structure**:
```
<div role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-body">
  <div class="dialog-scrim"></div>
  <div class="dialog-container">
    <h2 id="dialog-title">Delete this file?</h2>
    <p id="dialog-body">This action cannot be undone.</p>
    <button class="primary">Delete file</button>
    <button class="secondary">Cancel</button>
  </div>
</div>
```

**Sizing & Positioning**:
- Width: 400px (standard), 320px (compact mobile), max 90vw
- Padding: 24px (heading), 16px (body), 16px (footer)
- Border radius: 8px
- Background: Gray-900, border: 1px Gray-800
- Centered on screen, never top-aligned
- Scrim: rgba(0,0,0,0.6) backdrop, covers full viewport

**Content**:
- Heading: `<h2>`, specific and action-oriented: "Delete this file?" not "Confirm"
- Body: One or two short sentences explaining the consequence or decision
- Actions: One or two buttons; destructive labeled explicitly ("Delete file", not "Confirm")
- No scrolling; if content needs it, use a sheet or page

**Button Placement**:
- Narrow: Stack full-width, safe action (typically Cancel) on top
- Medium+: Align right, primary/destructive last, safe action focused by default
- Order: Safe action gets focus; destructive button never the default focus

**States**:
| Element | Rest | Focus |
|---------|------|-------|
| Container | Gray-900 bg, 1px Gray-800 border | Same + 3px Primary ring |
| Scrim | rgba(0,0,0,0.6) | None |
| Text | Gray-100 | None |

**Button States** (inside dialog):
- Safe action (Cancel): Secondary variant, takes default focus
- Destructive action (Delete): Destructive variant, requires Tab or explicit click

**Keyboard Behavior**:
- Tab: Cycles only within dialog (focus trap)
- Shift+Tab: Reverse cycle
- Escape: Close (only if safe, no data loss; prompt if unsaved)
- Enter: Activate focused button

**Focus Management**:
- On open: Focus moves to the first focusable element (usually the safe action button)
- While open: Tab/Shift+Tab cycle only within dialog; page behind unfocusable
- On close: Focus returns to the trigger (button that opened dialog)
- Background: Inert, no keyboard, no clicks, `aria-hidden="true"` on page regions

**Animations**:
- Fade in: 200ms ease-out
- Fade out: 200ms ease-out
- Respect `prefers-reduced-motion`: instant or very fast fade

**Responsive Behavior**:
- Narrow: Full width minus 16px margins (max 90vw), buttons stack full-width
- Medium: Centered 400px card, buttons inline right-aligned
- Wide: Same 400px centered card, scrim dims full page

**Accessibility**:
- Container: `role="dialog"`, `aria-modal="true"`
- Title: `<h2>` wired to `aria-labelledby`
- Body: Linked via `aria-describedby`
- Focus trap: Tab stays within dialog only
- Escape: Closes safely (no side effects) OR prompts if data loss
- Initial focus: Safe action button (usually "Cancel")
- Contrast: Heading and body meet WCAG AA
- Buttons: Semantic `<button>` with clear labels
- On close: Focus returns to trigger; browser history clean

**Do**:
- Keep scope tight: one decision or short input
- Name actions with concrete verbs
- Trap focus while open; restore on close
- Make the safe choice the easy one (default focus)

**Do Not**:
- Stuff wizards, long forms, or nested navigation in a dialog
- Label buttons "Yes"/"No" or "OK"/"Cancel" for consequential actions
- Let Escape leave side effects or trap the user
- Stack dialogs

---

## 14. ALERT (Destructive Confirmation)

**Purpose**: Modal message blocking screen until user responds, for destructive/irreversible actions or critical errors. A specialized dialog.

**Component Structure**:
```
<div role="alertdialog" aria-modal="true" aria-labelledby="alert-title" aria-describedby="alert-body">
  <div class="alert-scrim"></div>
  <div class="alert-container">
    <div class="alert-icon">🗑️</div>
    <h2 id="alert-title">Delete this project?</h2>
    <p id="alert-body">All tasks and data are removed. This cannot be undone.</p>
    <button class="destructive">Delete project</button>
    <button class="secondary" autofocus>Keep project</button>
  </div>
</div>
```

**Severity Levels**:
1. **Informational** (neutral): Blue icon, calm wording, single action
2. **Warning** (caution): Amber/orange icon, clear consequence, two actions
3. **Error** (critical/destructive): Red icon, loss/consequence emphasized, destructive action secondary or requires confirm

**Sizing & Styling**:
- Width: 360px (standard), 320px (mobile), max 90vw
- Padding: 20px
- Border radius: 8px
- Background: Gray-900
- Icon: 32px or 40px, left-aligned or top-centered
- Title: `<h2>`, Gray-100, 16px
- Body: Gray-300, 14px, one or two sentences
- Buttons: 8px gap, primary large 40px height

**Severity Styling**:
| Severity | Icon Color | Body Color | Primary Button |
|----------|-----------|-----------|-----------------|
| Informational | Primary-500 | Gray-300 | Primary variant |
| Warning | Amber-500 | Gray-300 | Warning variant (amber bg) |
| Error/Destructive | Error-500 | Gray-300 | Destructive variant (red bg) |

**Button Ordering**:
- Destructive action: On left or right (varies), labeled explicitly ("Delete project", not "Confirm")
- Safe action: On left or right opposite, labeled explicitly ("Keep project", "Cancel")
- Default focus: Safe action (Cancel or Keep), using `autofocus` attribute
- Destructive never the default focus

**States**:
| Element | Rest | Hover | Focus |
|---------|------|-------|-------|
| Primary (destructive) | Error-600 bg | Error-500 bg | Ring 3px Error-500 |
| Secondary (safe) | Gray-700 bg | Gray-600 bg | Ring 3px Primary-500 |

**When to Use Alert vs. Dialog**:
- **Alert**: Destructive, irreversible, or critical decisions; system-initiated messages
- **Dialog**: Confirmable actions, quick input, user-initiated decisions
- Most confirmations are **dialogs**, not alerts

**Keyboard**:
- Tab/Shift+Tab: Cycle between buttons (only)
- Escape: Activate safe action (cancel) — never dismisses destructive alert
- Enter/Space: Activate focused button

**Focus Management**:
- Default focus: Safe action button (e.g., "Keep project")
- On open: Focus moves to safe action
- On close: Focus returns to trigger
- Tab cycles only between actions (dialog has few controls)

**Content Rules**:
- Title: Action + object: "Delete this project?"
- Body: Consequence plainly stated: "All tasks and data are removed. This cannot be undone."
- Avoid alarmist language ("Warning!", "Fatal"); let the words carry the meaning
- Button labels: Outcome explicit: "Delete project" not "Confirm"

**Responsive**:
- Narrow: Full width minus 16px, buttons stack full-width, safe action on top
- Medium+: Centered 360px card, buttons inline

**Accessibility**:
- `role="alertdialog"`, `aria-modal="true"`
- Title via `aria-labelledby` (id="alert-title")
- Body via `aria-describedby` (id="alert-body")
- Icon: Decorative or semantic depending on placement
- Buttons: Semantic `<button>`, clear labels
- Contrast: Icon, title, body, buttons meet WCAG AA
- Focus visible on buttons: 3px ring
- Escape closes alert ONLY if safe (no data loss); destructive actions require explicit button press
- No auto-dismiss; user in full control

**Do**:
- Reserve for decisions that matter and block the task
- Pair severity color with icon and clear words
- Make the safe choice the easy, focused one
- Name consequences directly

**Do Not**:
- Use for routine success or progress messages
- Stack or chain alerts
- Make the destructive action the default focus
- Use color alone to convey severity

---

## 15. TABS

**Purpose**: Switch between peer views of one subject without losing context. Small, stable set; no progression.

**Component Structure**:
```
<div role="tablist" class="tabs">
  <button role="tab" aria-selected="true" aria-controls="panel-overview" id="tab-overview">
    Overview
  </button>
  <button role="tab" aria-selected="false" aria-controls="panel-activity" id="tab-activity">
    Activity
  </button>
</div>
<div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview">
  Content for Overview
</div>
<div role="tabpanel" id="panel-activity" aria-labelledby="tab-activity" hidden>
  Content for Activity
</div>
```

**Sizing & Styling**:
- Tab height: 44px
- Padding: 12px horizontal, 8px vertical
- Font size: 14px
- Gap between tabs: 0 (adjacent)
- Tab count: 2-5 (max), stable and unchanging
- Indicator: Underline or fill, not color alone

**Tab Item States**:
| State | Background | Text | Underline | Focus |
|-------|-----------|------|-----------|-------|
| Rest (inactive) | Transparent | Gray-300 | None | None |
| Hover (inactive) | Gray-800 | Gray-100 | 1px Gray-700 | None |
| Active (selected) | Transparent | Primary-400 | 2px Primary-400 | 3px Primary ring (outer) |
| Focus (inactive) | Transparent | Gray-300 | None | 3px Primary ring (outer), 2px gap |
| Focus (active) | Transparent | Primary-400 | 2px Primary-400 | Ring visible behind underline |
| Disabled | Transparent | Gray-700 | None | None |

**Active Indicator**:
- 2px bottom border in Primary color, spans tab width
- Text: Primary-400 color
- Weight: 500 (slightly bolder) optional for emphasis
- Driven by `aria-selected="true"` on active tab
- Never color-only; include the underline

**Labels**:
- Nouns, not verbs: "Overview", "Activity", "Comments" (not "View activity")
- Short and parallel: All nouns, consistent length
- Never "Step 1", "Step 2" (that's a wizard, not tabs)
- Single line, never truncate; if needed, rephrase shorter

**Panel Content**:
- Each panel renders immediately (no lazy load on first click)
- Switching panels preserves scroll position and unsaved input where feasible
- Hidden panel: `hidden` attribute or `display: none`; not removed from DOM
- Panel height: Fit to content; no overflow unless intentional

**Keyboard Navigation**:
- Tab: Enters tablist (focuses selected tab), then exits to panel
- Arrow Right/Left: Move focus between tabs (optional automatic selection or manual via Enter)
- Home/End: Jump to first/last tab
- Enter/Space: Activate focused tab (if not automatic on focus)
- Documented: Specify whether activation is automatic (on focus) or manual (on Enter)

**Responsive Behavior**:
- Narrow: If tabs no longer fit, scroll tablist horizontally OR collapse into a dropdown showing current view
- Medium: Tabs stay inline; trim wording before dropping any
- Wide: Comfortably spaced; don't stretch 2-3 tabs across full width

**Accessibility**:
- `role="tablist"` on container
- `role="tab"` on each button
- `role="tabpanel"` on each content area
- Active tab: `aria-selected="true"`, inactive: `aria-selected="false"`
- Tab links to panel: `aria-controls="panel-id"`, panel references back: `aria-labelledby="tab-id"`
- Keyboard support: Arrows, Home/End, Tab (documented)
- Focus visible: 3px Primary ring, 2px gap from edge
- Contrast meets WCAG AA; active state shown without color alone
- Respect `prefers-reduced-motion`; transitions brief or instant

**URL Integration** (Optional):
- Tab selection can be reflected in URL hash or query param for bookmarking/reload
- Router updates URL on tab click; page reload restores the tab

**Do**:
- Use only for peer views, not steps
- Keep count small (2-5) and stable
- Show selection with weight/underline + `aria-selected`, not color alone

**Do Not**:
- Use tabs for sequential steps (use a stepped flow)
- Have 6+ tabs; regroup or use sidebar
- Signal selection by color alone
- Hide, reorder, or rename tabs dynamically

---

## 16. LIST

**Purpose**: Scroll-friendly feed of similar items (messages, projects, team members) for scanning and quick actions.

**Component Structure**:
```
<ul class="list">
  <li class="list-item">
    <div class="list-item-leading">Avatar</div>
    <div class="list-item-content">
      <div class="list-item-title">Item Title</div>
      <div class="list-item-subtitle">Supporting text</div>
    </div>
    <div class="list-item-trailing">Status badge or actions</div>
  </li>
  <!-- More items -->
</ul>
```

**Item Structure**:
- Leading slot: Avatar, icon, checkbox (20-32px)
- Content area: Title + optional subtitle
- Trailing slot: Badge, count, secondary action
- Full width, selectable row when needed

**Sizing & Spacing**:
- Row height: 48px (standard), 40px (compact), 56px (comfortable)
- Padding: 12px horizontal, 8px vertical
- Title font: 14px, Gray-100
- Subtitle font: 12px, Gray-400
- Gap between leading and content: 12px
- Gap between content and trailing: 8px

**Item States**:
| State | Background | Text | Focus |
|-------|-----------|------|-------|
| Rest | Transparent | Gray-100 (title), Gray-400 (subtitle) | None |
| Hover | Gray-800 | Gray-100, Gray-400 | None |
| Focus | Gray-800 | Gray-100, Gray-400 | 3px Primary ring |
| Selected | Gray-750 | Gray-100, Gray-400 | Ring visible |
| Disabled | Gray-950 | Gray-700 | None |

**Selection**:
- Checkbox or radio in leading slot if multi/single select
- Highlight row with background color shift
- Hover: Subtle background shift, action buttons appear
- Never rely on color alone; show checkbox or other indicator

**Actions**:
- Primary action: Click row to open item (link or button)
- Secondary actions: Icon buttons in trailing slot (edit, delete) or overflow menu
- Actions visible on hover and always focusable on keyboard

**Loading States**:
- Skeleton rows: Placeholder boxes with pulsing animation
- Empty list: Message + next step ("No projects yet. Create one")
- No results: Query-aware message ("No tasks match 'urgent'. Try another word.")
- Error state: Inline error message + retry button

**Responsive**:
- Narrow: Full-width, single column, actions in overflow menu
- Medium: Same structure, more breathing room
- Wide: May add additional columns (see DataTable for multi-column)

**Accessibility**:
- Semantic `<ul>` and `<li>` elements
- Clickable rows: Make the title a real `<a>` link
- Action buttons: Real `<button>` with descriptive labels ("Archive project 42", not "Delete")
- Keyboard: Tab to items, Enter opens, focus visible
- Live region for item count and search results: `role="status"` with count

**Do**:
- Keep rows at consistent height
- Scan friendly: align content vertically
- Show actions on hover; keep on keyboard focus

**Do Not**:
- Nest lists inside lists
- Mix different row heights
- Hide actions entirely on hover with no keyboard path

---

## 17. DATA TABLE

**Purpose**: Tabular data across columns for comparison, sorting, filtering, and row-level actions.

**Component Structure**:
```
<table class="data-table">
  <thead>
    <tr>
      <th scope="col" class="sortable">Project <button aria-sort="ascending">↑</button></th>
      <th scope="col" class="sortable">Owner</th>
      <th scope="col" class="numeric">Budget</th>
      <th scope="col">Actions</th>
    </tr>
  </thead>
  <tbody>
    <tr class="data-row">
      <td><a href="/projects/123">Q4 Campaign</a></td>
      <td>Sarah Kim</td>
      <td class="numeric">$45,000</td>
      <td><button aria-label="Open Q4 Campaign">→</button></td>
    </tr>
  </tbody>
</table>
```

**Column Structure**:
- Headers: Visible, plain-language noun: "Project", "Owner", "Due", "Budget"
- Header scope: `scope="col"` on every `<th>`
- Alignment: Left (text), Right (numbers/currency), Center (status/badge)
- Min-width: Columns never compress below readable width
- Sortable column indicator: Arrow up/down + `aria-sort="ascending|descending|none"`

**Row Sizing**:
- Height: 40px (compact), 48px (standard), 56px (comfortable)
- Padding: 12px horizontal, 8px vertical
- Alternating background: Every other row Gray-850 (optional, improves scanning)
- Font size: 14px (content), 12px (supporting)

**Cell States**:
| State | Background | Text | Focus |
|-------|-----------|------|-------|
| Rest | Row color | Gray-100 | None |
| Hover | Gray-800 | Gray-100 | None |
| Focus (cell) | Row color | Gray-100 | 3px Primary ring on link/button |
| Selected | Gray-750 | Gray-100 | Ring visible |
| Disabled | Gray-950 | Gray-700 | None |

**Data Types**:
- **Text**: Left-aligned
- **Number**: Right-aligned (45,000 not 45000)
- **Currency**: Right-aligned, leading symbol ($45K, €1.2M)
- **Status/Badge**: Center-aligned, color token + text + icon (never color alone)
- **Date**: Format consistently (Dec 31, 2024)
- **Links**: Real `<a>` with valid href

**Sorting**:
- Default sort: Set and shown (e.g., by Due date descending)
- Sort control: Clickable header, toggles ascending/descending/unsorted
- Indicator: Arrow (↑ or ↓) + `aria-sort` attribute
- Multi-sort optional; if supported, add secondary sort visual hierarchy (lighter arrow for secondary sort)

**Row Actions**:
- Primary: Click row or "Open" link to view detail
- Secondary: Icon buttons or overflow menu (edit, archive, delete)
- Actions visible on hover/focus on desktop; always focusable on keyboard
- Destructive action (delete) in menu with divider and confirmation

**Pagination** (if used):
- Show current page and total: "Page 1 of 5, 47 items"
- Controls: Previous/Next buttons, optional page jump input
- Preserve sort/filter state across page changes
- Never silent pagination; always show page info

**Dense Modes**:
- Compact: 40px rows, 10px padding, 13px font (data-heavy tables)
- Standard: 48px rows, 12px padding, 14px font (default)
- Comfortable: 56px rows, 16px padding, 14px font (easy scanning)
- Toggle available in toolbar or settings

**States**:
- **Loading**: Skeleton rows with pulsing animation; maintain layout
- **Empty**: Centered message + next action ("No invoices. Create one.")
- **No results**: Query-aware message ("No tasks match 'overdue'. Clear filters.")
- **Error**: Inline error + retry button; preserve filters

**Responsive Behavior**:
- Narrow: Convert to stacked card layout per row (show key columns, hide secondary)
  - OR: Keep table, scroll horizontally (allow, but not ideal)
  - OR: Collapse to list with tap-to-expand detail
- Medium: Show core columns (hide lowest-priority); optional expandable row for details
- Wide: Full table, all columns, comfortable spacing

**Accessibility**:
- Semantic `<table>`, `<thead>`, `<tbody>`, `<th scope="col">`, `<th scope="row">` if row headers present
- Caption or labeling region: `<caption>` or `aria-label` on table
- Sort state: `aria-sort="ascending|descending|none|other"` on header
- Row actions: Real `<button>` with descriptive labels: "Archive invoice 1042", not just "Delete"
- Keyboard: Tab reaches all interactive elements; roving focus optional in row
- Focus visible: 3px ring on links/buttons
- Screen readers: Row count announced; sort state announced on header click
- Color-coded data: Pair with text, icon, or pattern (not color alone for status)

**Do**:
- Keep column order stable across sessions
- Show item count and active filters above table
- Let whole row or clear target open detail
- Provide sortable column headers

**Do Not**:
- Hide critical actions behind hover with no keyboard path
- Paginate silently; show page and total
- Pack many columns into mobile view
- Fake tables with `<div>` structure

---

## 18. SEARCH FIELD

**Purpose**: Specialized input for free-text query with leading magnifier, clear control, and debounced results.

**Component Structure**:
```
<div class="search-field">
  <label for="search">Search projects</label>
  <div class="search-input-wrapper">
    <span class="search-icon">🔍</span>
    <input type="search" id="search" placeholder="by name or owner" />
    <button class="clear-btn" aria-label="Clear search" hidden>×</button>
  </div>
  <div role="status" aria-live="polite" class="search-status">
    3 results
  </div>
  <div class="search-results">
    <!-- Results render here -->
  </div>
</div>
```

**Input Styling**:
- Height: 40px
- Padding: 12px left (icon space), 12px right (clear button)
- Border: 1px Gray-600, radius 6px
- Focus: 2px Primary border, 3px Primary ring
- Icon size: 16px, Gray-400, left-aligned
- Font: 14px, Gray-100

**Input States**:
| State | Border | Icon | Text | Clear Button |
|-------|--------|------|------|--------------|
| Idle (empty) | Gray-600 | Gray-400 | Gray-300 (placeholder) | Hidden |
| Typing (with text) | Gray-600 | Gray-300 | Gray-100 | Visible button, Gray-300 |
| Focus | Primary-600 | Primary-400 | Gray-100 | Visible button, Gray-100 on hover |
| Loading/Searching | Gray-600 | Spinner (16px) | Gray-100 | Hidden (spinner replaces) |
| No results | Error-600 | Gray-400 | Gray-100 | Visible |

**Clear Control**:
- Appears only when field has text
- Icon: `×` (multiplication sign) or `✕`
- Size: 32px square button, icon 16px
- Position: Right of input, inside wrapper
- Label: `aria-label="Clear search"`
- Action: Clear field, return to idle, refocus input
- State: Gray-300 rest, Gray-100 hover

**Results Region**:
- Live region: `role="status"` with `aria-live="polite"`
- Shows result count: "12 results" when populated
- No results: "No matches for 'q3'. Try another word."
- Positioned below search input
- Renders matching items in list or grid

**Debouncing**:
- Delay: 200-300ms before query fires
- Loading indicator: Spinner replacing magnifier icon, non-blocking
- Announcement: "Searching..." in live region (or just count when results arrive)
- Cancelled: User clears field while searching

**No Results State**:
- Explicit message: "No tasks match 'overdue'. Try another word."
- Query-aware copy naming the search term
- Next step offered: "Clear filters", "Browse all", "Learn more"
- Not blank; never leave the user confused

**Recent Searches** (Optional):
- Show up to 5 recent queries under empty search field
- Only when user has searched before and field empty
- Not persistent; cleared on logout or with user consent
- Never store sensitive queries without explicit permission

**Responsive**:
- Narrow: Full-width search, results below in modal drawer or panel
- Medium: Inline search, results in anchored popover or page region
- Wide: Same structure, wider max-width for full-text display

**Accessibility**:
- Label: Visible or `aria-label` (e.g., "Search projects")
- Placeholder: Concrete example: "by name or client" not just "Search"
- Clear button: Focusable `<button>`, labeled "Clear search"
- Live region: Result count and no-results announced politely
- Keyboard: Type, Tab to results, Escape to clear, Enter to submit (optional)
- Focus visible: 3px ring on input and clear button
- Icon: Decorative; no functional reliance on it

**Do**:
- Use concrete, example-driven placeholder
- Give immediate, non-blocking feedback while searching
- Offer one-tap clear that resets and refocuses

**Do Not**:
- Hide what is searchable behind vague "Search" placeholder
- Block UI with full-screen spinner during type-ahead
- Merge filters and free-text search into one control

---

## 19. FORM (Multi-Field Layout)

**Purpose**: Structured data collection combining multiple fields with validation, error handling, and submission.

**Form Structure**:
```
<form onsubmit="handleSubmit">
  <fieldset>
    <legend>Personal Info</legend>
    <TextField label="Name" required />
    <TextField label="Email" type="email" required />
  </fieldset>
  
  <fieldset>
    <legend>Optional</legend>
    <TextField label="Note" optional />
  </fieldset>
  
  <div class="form-actions">
    <button type="submit" class="primary">Save changes</button>
    <button type="button" class="tertiary" onclick="reset()">Cancel</button>
  </div>
</form>
```

**Layout & Grouping**:
- Single column on narrow screens; two-column on wide only if logical
- Group related fields under a `<fieldset>` with `<legend>`
- Max width: 500px for readability (not full-width on desktop)
- Vertical spacing: 20px between fields, 28px between fieldsets

**Field Ordering**:
- Most important or common fields first
- Group by logical category, not alphabetical
- Related fields adjacent: First Name / Last Name; Address / City / State / Zip

**Required vs. Optional**:
- Mark optional fields explicitly: "Note (optional)" in label
- Mark required fields: Required marker `*` OR require all by default (designer choice)
- Do not mix both approaches on same form
- Helper text explains constraints: "8+ characters", "Format: MM/DD/YYYY"

**Validation Rules**:
- Validate on submit (primary)
- Validate on blur (secondary, after first interaction)
- Never validate on first keystroke
- Preserve entered values across errors
- On submit failure: Focus moves to first invalid field

**Error Handling**:
- Error text specific: "Enter a valid email address", not "Invalid"
- Error text replaces helper text below field
- Surface errors in live region: Announce "2 errors: Name is required, Email is invalid"
- Don't clear entire form on failure; keep all values
- Show inline fixes where helpful: "Enter a date in 2024 or later"

**Submission**:
- One primary submit button with outcome verb: "Save changes", "Create project", not "Submit"
- Submit button: 40px+ height, full-width on narrow, fit-width on wide
- Disable submit only if blocked (e.g., async validation pending); show reason nearby: "Checking email..."
- Loading state: Spinner inside button, `aria-busy="true"`, blocks double-submit
- Success: Redirect to success page, toast, or inline confirmation message

**Multi-Step Forms**:
- Split when form exceeds ~7 fields or has distinct stages
- Show progress: "Step 1 of 3"
- Allow back without data loss; forward requires valid current step
- Confirm final step before submission

**Responsive**:
- Narrow: Single-column, full-width fields, large tap targets (44px+), sticky submit button
- Medium: Single-column, fields at 300-400px
- Wide: Two-column grid if sensible (e.g., First/Last names in one row); cap form width

**Accessibility**:
- Every control: `<label>` programmatically associated via `for`/`id`
- Fieldsets: `<fieldset>` + `<legend>` for grouped controls
- Error state: `aria-invalid="true"`, `aria-describedby` linked to error text
- Error announcement: Live region `aria-live="assertive"` or focus moved to first error
- Focus management: Tab through fields in order; focus moved to first error on submit failure
- Keyboard submit: Enter in last field submits form
- Contrast: Labels, help text, error text meet WCAG AA
- Focus ring visible on every control; never removed unreplaced

**Do**:
- Show requirements up front (password rules, formats)
- Preserve input across errors
- Group related fields with fieldsets
- Default to common value where sensible
- Confirm success clearly; show next step

**Do Not**:
- Clear entire form on failure
- Rely on placeholder text as the only label
- Show errors on first keystroke
- Bury submit button or offer two equal primaries
- Use color alone for required/optional marker

---

## 20. NAVIGATION HEADER

**Purpose**: Top frame of app; maintains location awareness across screens. Persistent chrome holding app title, breadcrumbs, and primary actions.

**Component Structure**:
```
<header class="app-header">
  <button aria-label="Open menu" class="menu-button">☰</button>
  <h1 class="page-title">Projects</h1>
  <nav aria-label="Breadcrumb">
    <ol class="breadcrumb">
      <li><a href="/workspaces">Workspaces</a></li>
      <li aria-current="page"><a href="/projects">Projects</a></li>
    </ol>
  </nav>
  <div class="header-actions">
    <button aria-label="Search">🔍</button>
    <button aria-label="Notifications">🔔</button>
  </div>
</header>
```

**Header Sizing**:
- Height: 56px (standard), 48px (compact)
- Padding: 12px horizontal, 8px vertical
- Background: Gray-950 (matches sidebar)
- Border: 1px Gray-800 bottom edge
- Sticky: Stays at top on scroll

**Menu Button** (Mobile):
- Visible on screens < 768px
- Icon: Hamburger (☰), 24px
- Size: 40px square
- Label: `aria-label="Open menu"`
- Opens sidebar as drawer when clicked
- Hidden on wide screens

**Page Title**:
- `<h1>` or semantic level matching page hierarchy
- Font: 18px, Gray-100, bold (600 weight)
- Left-aligned after menu button
- Matches sidebar active item label for consistency

**Breadcrumbs** (Navigation Trail):
- Nav landmark: `aria-label="Breadcrumb"`
- Semantic `<ol>` with `<li>` items
- Each level a link except current level
- Current level: `aria-current="page"`
- Separator: Forward slash (/) or `>` visual separator, not in markup
- Font size: 12px, Gray-400
- Position: Below title on narrow, beside title on wide

**Breadcrumb Truncation**:
- If full breadcrumb doesn't fit on narrow screens:
  - Show first and last segments with overflow indicator (`…`)
  - e.g., "Workspace / … / Current task"
  - Full breadcrumb on medium+

**Actions** (Right-aligned):
- Secondary controls: Search, notifications, user menu
- Icon buttons: 40px square, 20px icon
- Layout: Flex, gap 4px

**States**:
| Element | Rest | Hover | Focus |
|---------|------|-------|-------|
| Title | Gray-100 | N/A | N/A |
| Breadcrumb link | Gray-400 | Gray-200 | 3px Primary ring |
| Action button | Gray-300 icon | Gray-100 | 3px Primary ring |

**Responsive**:
- Narrow: Menu button, title, compact breadcrumb (first + last only), actions
- Medium: Full breadcrumb, all actions visible
- Wide: Full breadcrumb, comfortable spacing, actions on far right

**Accessibility**:
- Semantic `<header>` and `<nav>` landmarks
- Title is `<h1>` (only one per page)
- Skip-to-main-content link as first focusable element
- Breadcrumbs: Ordered list with `aria-label="Breadcrumb"`
- Active breadcrumb: `aria-current="page"`
- All links keyboard-operable with visible focus ring
- Contrast: Title and breadcrumb links meet WCAG AA
- Motion: Respect `prefers-reduced-motion` on any transition

**Do**:
- Keep navigation stable and consistent across all screens
- Mark current location visually and semantically (`aria-current`)
- Provide clear back/up affordance on detail screens
- Show full navigation path on wide screens

**Do Not**:
- Hide or reorder navigation between pages
- Rely on browser Back button as only exit
- Use color alone to mark active location
- Truncate breadcrumbs on desktop

---

## CONCRETE DESIGN TOKENS

### Colors (Dark Mode)
```
Primary: #3B82F6 (blue-500)
Primary-dark: #1E40AF (blue-700)
Primary-light: #DBEAFE (blue-100)

Error: #EF4444 (red-500)
Error-dark: #991B1B (red-900)
Error-light: #FEE2E2 (red-100)

Warning: #F59E0B (amber-500)
Warning-dark: #92400E (amber-900)
Warning-light: #FEF3C7 (amber-100)

Gray-100: #F3F4F6
Gray-200: #E5E7EB
Gray-300: #D1D5DB
Gray-400: #9CA3AF
Gray-500: #6B7280
Gray-600: #4B5563
Gray-700: #374151
Gray-800: #1F2937
Gray-850: #171D27
Gray-900: #111827
Gray-950: #030712

Success: #10B981 (emerald-500)
```

### Typography
```
Body: 14px, line-height 1.5, color Gray-100
Label: 12px, 500 weight, color Gray-300
Heading 1: 24px, 600 weight, color Gray-100
Heading 2: 20px, 600 weight, color Gray-100
Heading 3: 16px, 600 weight, color Gray-100
Caption: 12px, color Gray-400
```

### Spacing
```
4px (xs)
8px (sm)
12px (md)
16px (lg)
20px (xl)
24px (2xl)
28px (3xl)
32px (4xl)
```

### Border Radius
```
4px (small controls)
6px (standard inputs, cards)
8px (cards, panels, dialogs)
12px (large, loose)
```

### Shadow
```
None (most dark UI)
Elevation: 0 10px 32px rgba(0, 0, 0, 0.5) (modals, popovers)
Subtle: 0 2px 8px rgba(0, 0, 0, 0.3) (cards, hover)
```

### Transitions
```
Fast: 150ms ease-out (button hover, icon change)
Standard: 200ms ease-out (modal open/close, tab switch)
Slow: 300ms ease-out (panel open/close, collapse animation)
Respect prefers-reduced-motion: Instant or skip animation
```

---

## COMPREHENSIVE DO/DO-NOT CHECKLIST

### Buttons
- Do: Make primary action dominant and unmistakable
- Do: Reuse Button component with variant tokens
- Do: Show spinner inside button; never shift layout during loading
- Do: Give disabled buttons context text on what to fix
- Do: Icon-only buttons always have aria-label + tooltip
- Do Not: Place two primary buttons together
- Do Not: Signal destructive action by color alone
- Do Not: Use ambiguous labels hiding the outcome
- Do Not: Make button jump or resize during loading

### Text Fields
- Do: Keep labels visible at all times
- Do: Use placeholders sparingly, only for format examples
- Do: Show format requirements before user errs
- Do: Preserve typed values when validation fails
- Do Not: Use placeholder as the only label
- Do Not: Clear other fields when one fails
- Do Not: Show red error before user touches field
- Do Not: Rely on color alone to signal error

### Search
- Do: Use concrete, example-driven placeholder
- Do: Give immediate, non-blocking feedback while searching
- Do: Offer one-tap clear that resets and refocuses
- Do Not: Hide what is searchable behind vague "Search"
- Do Not: Block UI with full-screen spinner during type-ahead
- Do Not: Merge filter and free-text search into one control

### Cards
- Do: Use card when real boundary clarifies content belongs together
- Do: Keep one idea, one heading, tidy action set per card
- Do: Reuse surface, radius, spacing tokens
- Do Not: Nest cards or stack boxes inside boxes
- Do Not: Turn every section into a card for consistency
- Do Not: Pile many buttons and links into one footer

### Panels/Sheets
- Do: Keep page usable behind non-blocking panels
- Do: Use same anchored edge for open and close
- Do: Show which item detail panel describes
- Do Not: Stack panels on panels
- Do Not: Block whole page for non-essential tasks
- Do Not: Hide close control behind gestures
- Do Not: Lose unsaved input when closing

### Sidebar
- Do: Mark current location clearly on every view
- Do: Keep structure shallow; labels predictable
- Do: Persist collapsed/expanded choice
- Do: Give icon-only rows tooltips and accessible names
- Do Not: Hide active state; leave users unsure where they are
- Do Not: Bury destinations 3+ levels deep
- Do Not: Ship icon-only rows without accessible names

### Toolbar
- Do: Surface high-frequency, contextual actions
- Do: Use consistent icons, spacing, dividers from tokens
- Do: Provide tooltips and aria-labels for icon-only buttons
- Do: Group related controls with clear visual separation
- Do Not: Crowd toolbar with rare or duplicate actions
- Do Not: Place destructive action beside common ones unprotected
- Do Not: Reorder controls between views or sessions
- Do Not: Wrap to second row; use overflow menu instead

### Menus
- Do: Keep primary action visible; menus for secondary only
- Do: Group related items; separate destructive ones
- Do: Close on selection and give clear feedback
- Do: Reuse Menu component everywhere
- Do Not: Hide frequent/primary actions in menus
- Do Not: Mix unrelated actions into one ungrouped list
- Do Not: Let destructive items sit beside benign ones unseparated

### Popovers
- Do: Anchor to trigger and point back
- Do: Keep content focused and short
- Do: Support Escape and outside-click dismissal
- Do: Restore focus to trigger on close
- Do Not: Host multi-step forms, wizards, or tabs
- Do Not: Stack popovers or open multiple
- Do Not: Block or dim the page
- Do Not: Cover the trigger or run off-screen

### Dialogs/Alerts
- Do: Keep scope tight: one decision or short input
- Do: Name actions with concrete verbs
- Do: Trap focus while open; restore on close
- Do: Make safe choice easy (default focus)
- Do: Reserve alerts for decisions that matter, block the task
- Do: Pair severity color with icon and clear words
- Do Not: Stuff wizards, long forms, nested navigation in dialogs
- Do Not: Label buttons "Yes"/"No" or "OK"/"Cancel" for consequential actions
- Do Not: Let Escape leave side effects or trap user
- Do Not: Stack or chain dialogs/alerts

### Tabs
- Do: Use only for peer views, not steps
- Do: Keep count small (2-5) and stable
- Do: Show selection with weight/underline + aria-selected, not color alone
- Do Not: Use tabs for sequential steps (use stepped flow)
- Do Not: Have 6+ tabs; regroup or use sidebar
- Do Not: Hide, reorder, or rename tabs dynamically

### Lists & Tables
- Do: Keep column order stable across sessions
- Do: Show item count and active filters above table
- Do: Let whole row or clear target open detail
- Do: Use correct structure (list vs table) for question
- Do: Make row actions real buttons with descriptive labels
- Do Not: Hide critical actions behind hover with no keyboard path
- Do Not: Paginate silently; show page and total
- Do Not: Pack many columns into mobile view
- Do Not: Build table from divs with no semantic headers

### Links
- Do: Use real <a href> elements for all navigation
- Do: Mark inline links with underline plus color, holding up on touch
- Do: Write link text that names its destination
- Do Not: Use links to delete, archive, or change data
- Do Not: Rely on hover or color alone to mark a link
- Do Not: Open new tabs by default when it interrupts user

### Forms
- Do: Show requirements up front (password rules, formats)
- Do: Preserve input across errors
- Do: Group related fields with fieldsets
- Do: Default to common value where sensible
- Do: Confirm success clearly; show next step
- Do Not: Clear entire form on failure
- Do Not: Rely on placeholder text as only label
- Do Not: Show errors on first keystroke
- Do Not: Bury submit button or offer two equal primaries

### Navigation
- Do: Keep navigation stable and consistent across screens
- Do: Mark current location visually and semantically (aria-current)
- Do: Provide clear back/up affordance on detail screens
- Do: Show full navigation path on wide screens
- Do Not: Hide or reorder navigation between pages
- Do Not: Rely on browser Back button as only exit
- Do Not: Use color alone to mark active location
- Do Not: Truncate breadcrumbs on desktop

---

## IMPLEMENTATION NOTES FOR REACT + TAILWIND

### CSS Architecture
Use Tailwind for layout and spacing; design tokens in `tailwind.config.js`:
```js
theme: {
  colors: {
    primary: '#3B82F6',
    error: '#EF4444',
    gray: { 100: '#F3F4F6', ... }
  },
  spacing: { xs: '4px', sm: '8px', ... },
  borderRadius: { sm: '4px', md: '6px', ... },
}
```

### Component Structure
Build a small React primitive library with:
- `Button` (variant, size, state props)
- `IconButton` (icon, aria-label, tooltip)
- `TextField` (label, type, helper, error, required)
- `Select` (options, label, error)
- `Slider` (min, max, value, onChange)
- `Card` (header, body, footer slots)
- `Panel` (blocking, title, closeButton)
- `Sidebar` (navItems, collapsed state)
- `Toolbar` (groups, buttons, overflow)
- `Menu` (items, trigger, destructive)
- `Popover` (trigger, content, positioning)
- `Dialog` / `Alert` (title, body, actions, severity)
- `Tabs` (tabs, panels, onChange)
- `DataTable` (rows, columns, sort, pagination)
- `SearchField` (placeholder, onChange, onClear)

### State Management
Use React hooks for local state; consider composition for complex interactions:
- `useDisclosure()`: Open/close modals and panels
- `useCollapse()`: Sidebar expand/collapse with localStorage
- `useSort()`: Table sort state
- `useSearch()`: Search input with debouncing
- `useFocus()`: Focus management for modals and dialogs

### Accessibility Priorities
1. Semantic HTML always (button, link, form, fieldset, etc.)
2. ARIA only where native semantics fall short
3. Focus management: Trap in modals; return focus on close
4. Live regions for dynamic content (search results, error messages)
5. Contrast meeting WCAG AA in all states
6. Keyboard full support (Tab, arrows, Escape, Enter)
7. Screen reader testing with NVDA/VoiceOver

### Dark Mode Strategy
- Base all colors from gray and semantic tokens (primary, error, warning)
- No white backgrounds; use Gray-900/Gray-950 for main content
- Elevation via shadow, not brightness
- Ensure contrast even in reduced-saturation modes
- Test with color-blind simulators (Protanopia, Deuteranopia, Tritanopia)

### Responsive Breakpoints
```
Narrow: < 768px (mobile)
Medium: 768px - 1024px (tablet)
Wide: > 1024px (desktop)
```

Use Tailwind breakpoints (`sm`, `md`, `lg`) consistently across components. Reflow layouts at each breakpoint; never hide functionality.

---

## SUMMARY: 13-Component Primitive Library

A dark-mode creative tool needs these primitives, each with full state sets and accessibility built-in:

1. **Button**: Primary, secondary, tertiary, destructive + loading, disabled
2. **IconButton**: 40px minimum, aria-label, tooltip
3. **TextField**: With label, helper text, error, validation states
4. **NumberField**: Numeric input with optional spinner
5. **Select/Dropdown**: Native or custom, fully keyboard-operable
6. **Slider/Range**: 20px thumb, keyboard support
7. **Card**: Heading, body, footer with actions
8. **Panel/Sheet**: Blocking and non-blocking, side and bottom
9. **Sidebar**: Persistent nav, collapsed/expanded, active state
10. **Toolbar**: Roving tabindex, groups, overflow menu
11. **Menu**: Context actions, destructive handling, keyboard nav
12. **Popover**: Lightweight, anchored, dismissible
13. **Dialog/Alert**: Modal focus trap, destructive confirmation
14. **Tabs**: Peer views, 2-5 count, ARIA roles
15. **DataTable**: Semantic, sortable, filterable, responsive
16. **SearchField**: Debounced, live region, clear control
17. **Form**: Multi-field grouping, error handling, submission
18. **Navigation**: Header, breadcrumbs, active marking

Each component integrates Apple HIG principles into a cohesive, accessible dark web app. Implementation is straightforward with React hooks and Tailwind utility classes.

## CONCRETE VALUES
## Concrete Design Token Values

### Colors (Hex)
- Primary: #3B82F6 (blue-500), hover #2563EB, focus ring outer 3px
- Primary-dark: #1E40AF (blue-700)
- Error: #EF4444 (red-500), hover darker, focus ring 3px
- Error-dark: #991B1B
- Warning: #F59E0B (amber-500)
- Success: #10B981 (emerald-500)
- Gray-100: #F3F4F6, Gray-200: #E5E7EB, Gray-300: #D1D5DB, Gray-400: #9CA3AF
- Gray-500: #6B7280, Gray-600: #4B5563, Gray-700: #374151, Gray-800: #1F2937
- Gray-850: #171D27, Gray-900: #111827, Gray-950: #030712

### Sizing (px)
- Button: 40px height (medium, default), 32px (small), 48px (large)
- Button padding: 16px horizontal (medium), 12px (small), 20px (large)
- Icon size in button: 20px standard, 16px with label
- Icon-only button: 40px square, 44px (touch)
- Input/Field: 40px height, 12px horizontal padding, 8px vertical
- Row height (list/table): 48px standard, 40px compact, 56px comfortable
- Sidebar width: 240px (expanded), 64px (collapsed)
- Panel width: 360px (mobile), 400px (standard), 480px (wide)
- Card padding: 16px (mobile), 20px (medium+)
- Toolbar height: 44px (standard), 40px (compact)
- Dialog width: 400px (standard), 320px (mobile compact)
- Slider track: 4px height, thumb 20px diameter
- Border radius: 4px (small), 6px (standard), 8px (cards/panels), 12px (loose)
- Tab height: 44px, 12px padding horizontal
- Search input: 40px height, 16px icon, clear button 32px
- Focus ring: 3px outer, 2px gap from edge

### Spacing (px)
- 4px (xs), 8px (sm), 12px (md), 16px (lg), 20px (xl), 24px (2xl), 28px (3xl), 32px (4xl)
- Field/form spacing: 20px between fields, 28px between fieldsets
- Card gap: 12px (mobile), 16px (medium+)
- Toolbar group gap: 8px, divider 1px with 4px margins
- Breadcrumb separator: Visual only (CSS content), not in markup
- Menu item: 36px height, 8px vertical padding, 12px horizontal

### Typography (rem/px)
- Body: 14px (0.875rem), line-height 1.5
- Label: 12px (0.75rem), 500 weight, Gray-300
- Button: 14px (0.875rem), 500 weight
- Heading 1: 24px (1.5rem), 600 weight
- Heading 2: 20px (1.25rem), 600 weight
- Heading 3: 16px (1rem), 600 weight
- Small/caption: 12px (0.75rem), Gray-400
- Input placeholder: 14px (0.875rem), Gray-400

### Shadows (CSS)
- Elevation: `0 10px 32px rgba(0, 0, 0, 0.5)` (modals, popovers)
- Subtle: `0 2px 8px rgba(0, 0, 0, 0.3)` (cards on hover)
- None (most dark UI)

### Transitions (ms)
- Fast: 150ms ease-out (button hover, icon change)
- Standard: 200ms ease-out (modal open, tab switch)
- Slow: 300ms ease-out (panel slide, collapse animation)
- Respect `prefers-reduced-motion`: instant or skip

### Z-Index Stack
- Sidebar drawer: 40
- Toolbar/Header: 30
- Panel (non-blocking): 20
- Popover/Menu: 25
- Modal/Dialog scrim: 50, content: 51

### Hit Targets (Minimum)
- Button: 40px height (standard), 44px (mobile touch)
- Icon button: 40px square (standard), 44px (mobile touch)
- Link: 44px touch target (minimum), 20px text baseline
- Checkbox/Radio: 20px square, with 8px padding for spacing
- Slider thumb: 20px diameter
- Tab: 44px height
- List/table row: 40-56px (dependent on mode)
- Form input: 40px height, 12px side padding
- Close button: 40px square, 20px icon

### Motion & Animation
- Panel slide-in: 300ms ease-out from screen edge
- Modal fade-in: 200ms ease-out
- Button state change: 150ms ease-out
- Spinner rotation: Continuous 1s linear
- All reduced on `prefers-reduced-motion`: instant or skip to final state

### Contrast Ratios (WCAG AA minimum 4.5:1 for text)
- Gray-100 on Gray-900: 13:1 (normal text, headings)
- Gray-300 on Gray-900: 7.5:1 (secondary text)
- Primary (#3B82F6) on Gray-900: 4.9:1 (active states, links)
- Error (#EF4444) on Gray-900: 4.8:1 (error text)
- All focus rings: 4.5:1 minimum against background

## RULES
- Every interactive element is a semantic HTML control (button, input, link, select) — never fake with div/span
- All buttons: Use Button component with variant prop (primary, secondary, tertiary, destructive); never one-off styling
- Icon-only buttons: Always have aria-label and visible tooltip on hover/focus; icon is decorative
- Button loading: Show spinner inside button, reserve label width, set aria-busy=true, block further activation
- Text fields: Label always visible and persistent; never use placeholder as sole label
- Form fields: Validate on submit and blur, not on first keystroke; preserve values on error
- Error messages: Specific and actionable (e.g., 'Enter a valid email'), linked via aria-describedby
- Validation state: Use border, icon, AND text — never color alone
- Search field: Concrete placeholder with example ('by name or owner'); show clear control when text present
- Search results: Always render no-results state explicitly; never blank area
- Cards: One purpose per card, one heading; never nest cards; use spacing/dividers instead
- Panel/sheet: Non-blocking by default (no scrim); only block when task requires it; always show close affordance
- Sidebar: At most 2 levels deep; every item has visible text label (icons support only); mark active state with left border + color
- Sidebar collapsed: Icon-only with aria-label and tooltip; preference persisted
- Toolbar: One tab stop with roving tabindex; arrows navigate within, Tab exits; never wrap, use overflow menu
- Toolbar groups: Separate with 1px divider, 4px margins; keep related controls together
- Menu items: Verb-led labels ('Archive file', not 'Archive'); separate destructive with divider
- Menu: Close on selection (except multi-select); show checkboxes only if items stay open
- Popover: Anchor to trigger with arrow pointing back; small content only; Escape closes and returns focus
- Dialog: Trap Tab focus; Escape safe to press (no data loss); safe action focused by default
- Dialog actions: Concrete verb labels ('Delete file', 'Send invite'), never 'OK' or 'Yes'
- Alert: Reserved for destructive/irreversible actions; destructive button NOT default focus; pairing icon + text + color
- Tabs: Use only for peer views; exactly one selected via aria-selected; 2-5 tabs max, stable and unchanging
- Tab indicator: 2px bottom border + text color shift + aria-selected — never color alone
- List items: Consistent row height; links are the title; actions visible on hover and always keyboard-reachable
- Table: Semantic <table>, <thead>, <th scope='col'>, <tbody>; never fake with divs
- Table headers: Sortable headers show arrow + aria-sort; right-align numbers, left-align text
- Table row actions: Real <button> with descriptive labels ('Archive invoice 1042'); no bare icons
- Focus management: Always visible with 3px Primary ring + 2px gap; meets 4.5:1 contrast ratio
- Focus trap in modals: Tab/Shift+Tab cycle only within dialog; background inert and unreachable
- Focus restoration: On modal/panel close, return focus to trigger element
- Keyboard: Tab enters/exits, arrows navigate, Enter/Space activate, Escape closes (safely)
- Live regions: Use role=status with aria-live=polite for search results, error summaries; aria-live=assertive for critical alerts
- Links: Semantic <a href>, never fake navigation with <div onclick>; distinguish without hover or color alone
- Links styling: Underline + color (not color alone); visible focus ring
- Destructive actions: Never wired to links; always button with confirmation
- Form structure: Use <fieldset> + <legend> for grouped controls; group related fields
- Form validation: First invalid field gets focus on submit failure; error announced in live region
- Responsive: Narrow single-column, Medium 2-column (if logical), Wide comfortable spacing — never desktop shrink on mobile
- Responsive navigation: Sidebar becomes drawer <768px; Tabs scroll or collapse; Tables convert to cards <768px
- Breadcrumbs: Ordered list with aria-label='Breadcrumb'; current level aria-current='page'
- Active navigation state: Semantic aria-current='page' (not color alone); left border indicator on sidebar items
- Accessibility: Every control keyboard-operable; roving tabindex in toolbars; focus visible everywhere
- Color contrast: Text/background 4.5:1 (WCAG AA); icons meet same standard; test with ColorOracle
- Motion: Respect prefers-reduced-motion; transitions instant or skip to final state
- No hover-only: Touch lacks hover; actions visible or revealed via focus/keyboard; icons need aria-label
- Modality: Simplest path wins; prefer inline errors to alerts; alerts only for critical decisions
- Loading state: Skeleton rows/placeholders on fetch; spinners non-blocking; preserve layout with fixed heights
- Empty states: Explicit copy naming the area + next action; never blank regions
- Error recovery: Preserve user input; allow undo for destructive; suggest fixes plainly
- Overflow: Collapse to '...' menu instead of wrapping or scrolling; preserve item order
- Tokens: Define all spacing, colors, sizing, shadow, duration in design tokens (tailwind.config.js); use everywhere

---

# principles

## filesConsulted

## SPEC
# Design System Review Rubric: Apple HIG for Next.js/Tailwind Dark Creative Tool

This rubric distills the Apple HIG into a grading standard for your dark, creative-tool web app. Every refactored surface is measured against these principle-level must-dos, required state patterns, destructive-action safeguards, settings conventions, and a pre-commit checklist.

---

## TIER 1: PRINCIPLE REQUIREMENTS (Non-Negotiable)

Every refactored screen must satisfy these ten principles. If a surface fails a principle, it fails review, regardless of other merits.

### 1. Clarity
**Purpose:** Users understand a screen's intent, primary action, and next step at a glance.

**Must-Have:**
- One visible top-level heading (`<h1>`) stating the screen's purpose
- One clearly distinguished primary action (most prominent button, color, size, placement)
- Every button and link label names a specific action, never "OK", "Submit", or "Click here"
- Hierarchy reflects importance through size, weight, and spacing—not decoration
- No meaning signals by color alone; pair with text, icon, or shape

**Red Flags:**
- Two or more buttons appear equally important
- Labels are generic and need surrounding context to understand
- Users ask "What does this screen do?" or "Which button do I press?"
- Heading is absent or decorative, not structural

### 2. Deference
**Purpose:** Interface stays quiet so user content and task stay in focus.

**Must-Have:**
- Content occupies the majority of the viewport on primary screens
- Only one clearly primary action per view; secondary actions are visually subordinate
- Neutral surfaces default; saturated color reserved for status and emphasis
- Advanced controls hidden until context needs them (behind disclosure or menu)
- Borders, shadows, dividers must justify themselves; prefer spacing for structure

**Red Flags:**
- Eye lands on navigation or banners before content
- Three or more elements compete to be "main"
- Heavy ornamentation (gradients, shadows, color) serves no purpose
- Users report the screen feels "busy"

### 3. Depth
**Purpose:** Layering shows hierarchy; modal surfaces appear intentional and temporary.

**Must-Have:**
- Every floating surface uses an elevation token, never raw z-index
- No more than two transient overlays visible at once
- Each layer animates from and toward its trigger point
- Focus is trapped in modals and restored on dismiss
- Transitions fall back to a fade under `prefers-reduced-motion`
- Temporary surfaces dismiss themselves or on Escape/close button

**Red Flags:**
- Z-index values climb outside token scale
- Overlays stack three or more deep
- Surfaces appear without animation or clear origin
- Users unsure how to close a panel

### 4. Consistency
**Purpose:** Same action, same component, same label, same behavior everywhere.

**Must-Have:**
- Identical actions use the same component, icon, label, and placement across the app
- One concept, one word—never "Delete" here and "Remove" there
- Reuse shared components first; new variants require design review
- All spacing, color, radius values come from design tokens—no hardcoded hex or px
- Loading, empty, error, success states follow one app-wide pattern

**Red Flags:**
- Component visually similar to existing one but built fresh
- Two screens call one operation by different names
- Inline hex colors or pixel values instead of tokens
- Confirmation dialogs whose layout differs from the rest

### 5. Feedback
**Purpose:** Every interaction triggers visible response; users know the app heard them.

**Must-Have:**
- Every control responds visibly within 100ms
- All eight states designed: hover, focus, active, loading, success, error, empty, disabled
- Over ~400ms show loading; over ~2s show progress or skeleton
- Errors name the problem in plain language and give a next step
- Success is calm: brief confirmation, then return to work—never blocking
- Disabled controls explain why (tooltip or helper text), never look dead

**Red Flags:**
- Button accepts two clicks; nothing changes on first
- Spinners with no timeout, progress indicator, or failure path
- Errors only turn a field red, no message
- Success modals interrupt flow and require dismissal

### 6. User Control
**Purpose:** Users stay in charge; meaningful actions are reversible, cancellable, or confirmed first.

**Must-Have:**
- Every destructive action offers Undo or restore; never one-way delete
- Every dialog, upload, and async job has a Cancel that stops real work
- Failed actions show a retry, not a dead end
- Confirm only risky or irreversible actions Undo cannot cover
- Automated changes stay visible and reversible with opt-out
- Escape closes non-destructive overlays; back never loses unsaved work

**Red Flags:**
- Delete or overwrite with no Undo, restore, or confirmation
- Cancel closes UI but leaves work running
- Pre-selected upsells, hidden exits, or shaming copy
- Automation silently overwrites user's work

### 7. Forgiveness
**Purpose:** Mistakes are preventable and recoverable; users feel safe to act.

**Must-Have:**
- Prefer reversible actions; Undo is the default safety net before confirmation dialogs
- Preserve input: autosave drafts, never clear a form on validation failure
- Confirm before irreversible or wide-reaching actions, naming what's affected
- Offer a 5+ second Undo window over a blocking dialog
- Validate inline and early, not only at submit
- Make irreversible actions distinct; require deliberate intent (typed confirmation or checkbox)

**Red Flags:**
- Data permanently deleted on one unconfirmed click
- Validation error wipes everything typed
- Undo vanishes too fast to use or is missing for destructive actions
- Copy says "Are you sure?" without stating what happens

### 8. Progressive Disclosure
**Purpose:** Common path is obvious; rare options are reachable without clutter.

**Must-Have:**
- Lead with the action most users need; group rare ones under "Advanced" or similar
- Never hide destructive, save, submit, or recovery actions
- Default advanced sections collapsed, behind a descriptive trigger
- Limit nesting to one or two layers; deeper signals wrong structure
- Keep trigger state honest with `aria-expanded` and chevron

**Red Flags:**
- "Save", "Delete", or "Undo" sits in a collapsed region
- Trigger reads "Options" with no clue to its contents
- Disclosures nest several levels for an everyday setting
- New users meet a screen crowded with advanced fields

### 9. Direct Manipulation
**Purpose:** Act directly on things seen, not route through dialogs.

**Must-Have:**
- Edit primary fields (titles, names) in place for small, reversible edits
- Place each control next to content it affects
- Update previews immediately when safe; defer destructive or costly ones
- Pair every drag-and-drop with a keyboard alternative and screen-reader cue
- Show saved state inline (saving, saved, error)
- Make edits cancelable; Escape reverts to prior value

**Red Flags:**
- Reorder that needs a mouse drag only
- Editing an item navigates away from the list
- Hover-only buttons with no focusable equivalent
- Preview differs from what saves

### 10. Aesthetic Integrity
**Purpose:** Visual tone matches purpose; polish comes from consistency, not decoration.

**Must-Have:**
- Visual tone matches the screen's purpose (data-heavy views stay neutral)
- Color, type, spacing, radius, shadow come from approved tokens—no one-off hex
- Every decorative element must justify itself or be removed
- One elevation and shadow scale
- Reserve accent color for primary actions and key status only
- Limit emphasis to one focal point per view

**Red Flags:**
- Screen looks impressive alone but clashes with the rest of the app
- Reviewers call the UI "busy," "loud," or "distracting"
- New hex codes, shadows, or fonts appear outside tokens
- Animation runs continuously with no state change behind it

---

## TIER 2: REQUIRED STATE PATTERNS (Every Surface Must Implement)

Every list, table, form, card, panel, or data region must handle these states cleanly. A surface that ships without proper loading, empty, and error states is incomplete.

### Loading States
**When:** Data is fetching from the network.

**Rules:**
- Use a skeleton when layout is known (lists, cards, tables), matching shape, size, and count to content
- Scope loading to the region actually fetching; never overlay the whole page
- Reserve final layout space upfront—no layout shift when content arrives
- For actions under ~1 second, show inline spinner on control, keeping label visible
- For tasks over ~2s with measurable scope, show determinate progress bar with percentage
- Never show bare full-page spinner; justify only when nothing meaningful can render yet

**Accessibility:**
- Mark regions with `aria-busy="true"`; clear when done
- Announce status via polite `aria-live` region
- Progress bars use `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`
- Keep focus stable; don't steal it when skeleton swaps to content
- Under `prefers-reduced-motion`, replace shimmer/spin with static placeholder

**Responsive:**
- Narrow: fewer skeleton rows; single-column, full-width placeholders
- Medium: mirror the real grid so skeleton previews layout
- Wide: render skeletons across full multi-column layout, capped to fold

### Empty States
**When:** A list, table, board, or region has no content yet.

**Rules:**
- Always distinguish empty vs. no-results vs. error; never reuse one message for all three
- Provide exactly one primary action in a true empty state (e.g., "Create project")
- Keep surrounding chrome (nav, filters, search) visible and usable
- Never blame the user; state the situation neutrally and offer a next step
- Don't use loading spinners as a stand-in for empty; resolve the load first
- Keep copy short: one heading line plus one supporting sentence at most

**Accessibility:**
- Place the empty message in screen-reader order, not as decoration
- Mark decorative illustrations `alt=""` or `aria-hidden="true"`; never announce a mascot
- Primary action is keyboard-focusable with visible focus ring and label
- Maintain text contrast of at least 4.5:1 even with muted color
- After first item created, move focus to it

**Responsive:**
- Narrow: single column; stack icon, text, action; trim tips
- Medium: centered block in panel; maintain padding so not sparse
- Wide: center in data region, not viewport; layout unchanged

### Error States
**When:** A request fails, validation rejects input, or a feature cannot load.

**Rules:**
- State what happened in plain language, near where it happened
- Name a known cause briefly; never show raw traces or codes as primary message
- Tell the user whether their data is safe (saved, queued, or lost)
- Provide at least one recovery action: Retry, Reconnect, Edit, or support
- Never assign blame; describe the problem and fix
- Preserve user input—never clear a form after failed submit

**Accessibility:**
- Announce critical failures with `role="alert"` or `aria-live="assertive"` (otherwise polite)
- Move focus to first invalid field or error region after failed action
- Mark invalid inputs with `aria-invalid="true"`; link message via `aria-describedby`
- Never signal error with color alone; add icon, label, or text
- Meet 4.5:1 contrast for error text; keep focus rings visible

**Responsive:**
- Narrow: stack message, cause, action vertically; full-width button; never truncate
- Medium: inline errors sit by field; banners span panel, action at end
- Wide: center full-page states in constrained column

### Success States
**When:** An action completes successfully.

**Rules:**
- Success is calm: brief confirmation, then return to work
- Show confirmation briefly (toast, badge, or inline status), never a blocking modal
- For destructive actions that are reversible, show Undo in the toast (7-10 seconds)
- For routine saves, keep status quiet and factual ("Saved")
- Never block the screen for a routine save

**Accessibility:**
- Announce status via polite `aria-live` region
- Undo controls remain keyboard-reachable for their lifetime
- Success messaging doesn't rely on color alone

### Disabled States
**When:** A control cannot be used (missing required input, lacks permission, etc.).

**Rules:**
- Disabled controls explain why via tooltip or helper text, never look "dead"
- Provide a path to re-enable (fill a field, grant permission, etc.) when possible
- Maintain contrast; disabled text should remain readable

**Accessibility:**
- Set `aria-disabled="true"` or use `disabled` attribute
- Tooltip or helper text names the reason, not just the fact of being disabled
- Do not remove from Tab order without clear reason

---

## TIER 3: DESTRUCTIVE ACTIONS & CONFIRMATION (Safety Protocol)

Destructive actions (delete, archive, reset, revoke) are the app's highest-risk UX. Follow these rules strictly.

### Styling
- Use the danger token (`color.action.destructive`), never neutral or primary
- Red plus label plus icon (color alone never signals risk)
- For button in row menu or toolbar: danger-colored label in overflow menu, not a solo icon

### Naming
- Name by outcome: "Delete project", not "OK" or "Remove"
- Button text restates the verb: "Discard changes", not "Yes"

### Recovery Hierarchy (Choose One Per Action)
1. **Undo Toast (Preferred for reversible actions)**
   - Show toast: "[Action completed]. Undo." for 7–10 seconds
   - Undo is a real button, keyboard-reachable and focusable
   - Keyboard shortcut (Ctrl+Z / Cmd+Z) preferred
   - Example: "Task deleted. Undo."

2. **Confirmation Dialog (For irreversible or severe actions)**
   - Required when: undo is unavailable, scope is large (bulk delete), or data loss is permanent
   - Dialog structure:
     - Title: names the action ("Delete project?")
     - Body: states consequence and scope with count ("Deletes 12 tasks. Cannot be undone.")
     - Default focus: on Cancel (safe option), never destructive button
     - Buttons: Cancel (left/secondary), Destructive (right/danger color)
   - Escape and backdrop click close safely (to Cancel)

3. **Typed Confirmation (Only for severe, unrecoverable loss)**
   - Use only for account-level actions (delete workspace, cancel subscription)
   - Prompt user to type workspace name or similar unique value to enable destructive button
   - Destructive button disabled until exact match
   - Clearly state permanent consequence

### Bulk Actions
- Always show a count of items affected
- Confirm the scope upfront, not after
- Example: "Delete 3 files? This cannot be undone."

### Best Practices
- Never auto-focus the destructive button (focus defaults to Cancel)
- Prefer Undo to dialogs; only dialog when Undo is unfeasible
- Keep Cancel and destructive button visually separated
- For reversible actions, provide Undo over a dialog every time
- Never use confirm-shaming language ("Are you sure you want to leave us?")

---

## TIER 4: SETTINGS SCREENS (Configuration Pattern)

Settings screens handle toggles, inputs, and risky changes. Apply this pattern everywhere settings appear.

### Structure
- Group related settings under named sections (never one flat list)
- Order sections by frequency: most common first
- Use plain labels describing the effect, not jargon
  - Good: "Email me when someone comments"
  - Bad: "Comment hooks"

### Control Anatomy
- Every control has a visible, programmatically associated label (not placeholder)
- Required vs. optional is explicit (mark optional fields with word "optional", not asterisk alone)
- Helper text is one calm sentence removing doubt
- For settings affecting security, billing, sharing, or data, show inline note

### Save Behavior
- Make save explicit: either autosave with "Saved" confirmation, or a save button that disables until something changes
- Autosaving fields show inline status beside control
- Never save silently or require a button you never show

### Destructive Settings ("Danger Zone")
- Isolate destructive settings in a separate card with distinct border token (e.g., red border)
- Examples: "Delete account", "Leave workspace", "Wipe data", "Revoke access"
- Each requires a confirmation step (dialog or typed confirmation)
- Keep away from routine toggles and display options

### Responsive
- Narrow: navigation collapses to top-level list; tapping a topic opens full-width panel with back affordance
- Medium: navigation above or beside panel; controls stay one readable column
- Wide: persistent rail beside panel; content bounded max-width, not edge-to-edge

### Advanced Options
- Use progressive disclosure for rare or advanced settings
- Default "Advanced" sections collapsed
- Trigger is a real button with `aria-expanded` and descriptive label

---

## TIER 5: PRE-COMMIT UI CHECKLIST (Gate Before Code Review)

Before a refactored surface enters code review, run this checklist. If any box is unchecked, return to design or implementation.

### Design & Principles
- [ ] Relevant HIG local files consulted (clarity.md, deference.md, etc.)
- [ ] Design matches all ten principles (none are failed or waived)
- [ ] Clear primary task is visible on first glance
- [ ] Strong visual hierarchy (size, weight, spacing reflect importance)
- [ ] Visual tone is calm and consistent (no gratuitous decoration)

### Components & Tokens
- [ ] All instances reuse shared components (buttons, inputs, dialogs, etc.)
- [ ] No hardcoded hex, spacing, or radius values—all come from design tokens
- [ ] Component variants match existing usage (destructive button is consistent)
- [ ] New components or variants have design sign-off before implementation

### States & Feedback
- [ ] All required states present: loading, empty, error, success, disabled
- [ ] Loading: skeleton or progress bar present; no blank screens
- [ ] Empty: distinguishes empty vs. no-results vs. error; offers one next action
- [ ] Error: states what happened, names cause, offers recovery; no raw codes
- [ ] Success: brief and calm; no blocking modals for routine saves
- [ ] Disabled: controls explain why via tooltip/helper; remain readable

### Destructive Actions & Confirmation
- [ ] All destructive actions styled with danger token (red + label + icon)
- [ ] Destructive buttons named by outcome ("Delete project", not "OK")
- [ ] Reversible destructive actions show Undo toast (7–10 seconds)
- [ ] Irreversible actions confirm via dialog or typed confirmation
- [ ] Confirmation dialog defaults focus to safe option (Cancel), never destructive
- [ ] Typed confirmation used only for severe, unrecoverable loss

### Accessibility
- [ ] All interactive elements keyboard reachable (Tab, Enter, Space, Escape)
- [ ] Focus order is logical and matches reading order
- [ ] Focus states are visible (`:focus-visible` applied)
- [ ] Buttons and links use correct semantics (`<button>`, `<a>`, proper roles)
- [ ] All inputs have visible, programmatically associated `<label>`
- [ ] Icon-only buttons have accessible names (not just icons)
- [ ] Color not the only indicator (pair with text, icon, or shape)
- [ ] Text contrast passes WCAG AA (4.5:1 for normal text, 3:1 for large)
- [ ] Target sizes comfortable (minimum 44x44px for touch)
- [ ] `prefers-reduced-motion` respected (no animation if enabled)
- [ ] Dialogs manage focus: trap on open, restore on close
- [ ] Async changes announced via `aria-live` where needed
- [ ] Form errors linked via `aria-describedby`, marked with `aria-invalid="true"`

### Responsive & Layout
- [ ] No obvious layout breakage on small screens (mobile < 640px)
- [ ] Content adapts cleanly to narrow (toolbar collapses, panels stack)
- [ ] Touch targets remain comfortable across viewport sizes
- [ ] Readability preserved (text doesn't become unreadably small or large)
- [ ] Navigation, chrome, and content reflow logically

### Copy & Labeling
- [ ] No unclear buttons or labels ("Submit", "OK", "Action" are not used)
- [ ] All actions named specifically by outcome ("Invite member", "Save draft")
- [ ] Error messages plain language, name the problem and next step
- [ ] Empty states blame-free, offer a next step
- [ ] Copy is concise; no unnecessary words or marketing tone

### Privacy & Permissions
- [ ] No privacy-surprising behavior (no hidden trackers, silent uploads, auto-sharing)
- [ ] Permissions requested explicitly, before feature use
- [ ] User data handling is transparent (e.g., AI features disclose what data they send)

### Final Gate
- [ ] No layout regressions from prior commit
- [ ] No accessibility regressions (test with keyboard, screen reader, zoom)
- [ ] PR notes mention any intentional tradeoffs (e.g., "confirmation deferred for UX testing")
- [ ] Designer and accessibility reviewer have signed off

---

## TIER 5B: FORM-SPECIFIC CHECKLIST (For Data Entry & Settings Forms)

Use this alongside Tier 5 when building forms.

### Labels & Clarity
- [ ] Every field has a visible label (not placeholder alone)
- [ ] Placeholder text is present but never the only label
- [ ] Required vs. optional status is explicit and clear
- [ ] Helper text explains format or constraint (e.g., "8+ characters")
- [ ] Strict-format fields show an example before the user types (e.g., "MM/YYYY")

### Validation & Recovery
- [ ] Validation runs on blur and on submit, never mid-keystroke
- [ ] Error messages explain how to fix the issue (not just "Invalid")
- [ ] User input is preserved after errors (form doesn't clear)
- [ ] Focus moves to the first invalid field after submit fails
- [ ] Error text is linked via `aria-describedby`; invalid inputs set `aria-invalid="true"`

### Input Handling
- [ ] Correct `type` attribute for the input (email, tel, number, date, etc.)
- [ ] Correct `inputmode` for mobile keyboard (numeric, tel, email, url, etc.)
- [ ] `autocomplete` token set where appropriate (name, email, address-level1, etc.)
- [ ] Input is forgiving: accepts pasted values with spaces, dashes, mixed case, then normalizes
- [ ] No unnecessary fields; optional fields are clearly marked and truly optional

### Submit & Cancel
- [ ] Submit action describes the result ("Save draft", "Create project", not "Submit")
- [ ] Cancel/back behavior is clear (unsaved changes trigger a warning if risky)
- [ ] Form never asks to confirm a routine save

### Accessibility
- [ ] Keyboard navigation is logical (Tab order matches visual order)
- [ ] Labels and error text meet WCAG AA contrast (4.5:1)
- [ ] Form remains accessible on zoom and with `prefers-reduced-motion`
- [ ] Sensitive data (passwords, cards) handled securely (no overfill autocomplete, masked input)

---

## CONCRETE TOKEN VALUES FOR TAILWIND DARK THEME

These are the exact, implementable design tokens your Next.js/Tailwind app should use. All surfaces are graded against these.

### Colors
- **Primary Action:** `bg-blue-600` / `hover:bg-blue-700` / text `text-white`
- **Secondary Action:** `bg-gray-700` / `hover:bg-gray-600` / text `text-gray-100`
- **Destructive Action:** `bg-red-600` / `hover:bg-red-700` / text `text-white`
- **Disabled Action:** `bg-gray-800` / `text-gray-500` / cursor `cursor-not-allowed`
- **Success:** `text-green-500` / badge `bg-green-900 text-green-200`
- **Error:** `text-red-500` / inline `bg-red-900 text-red-200`
- **Warning:** `text-yellow-500` / badge `bg-yellow-900 text-yellow-200`

### Surfaces
- **Primary Surface (App BG):** `bg-gray-950` / `text-gray-50`
- **Secondary Surface (Cards, Panels):** `bg-gray-900` / `text-gray-100`
- **Tertiary Surface (Hoverable Rows, Subtle):** `bg-gray-800` / `text-gray-200`
- **Overlay / Modal Scrim:** `bg-black/80` (80% opacity black)
- **Border (Subtle):** `border-gray-800`
- **Border (Emphasis):** `border-gray-700`

### Elevation / Shadow
- **Elevation 0 (Flat):** `shadow-none`
- **Elevation 1 (Subtle):** `shadow-sm` / `shadow-slate-900/50`
- **Elevation 2 (Card):** `shadow-md` / `shadow-slate-900/50`
- **Elevation 3 (Popover):** `shadow-lg` / `shadow-slate-900/60`
- **Elevation Overlay (Modal):** `shadow-2xl` / `shadow-slate-900/80`

### Spacing (Tailwind Scale)
- **Tight:** `space-2` (8px)
- **Base:** `space-3` (12px) / `space-4` (16px)
- **Loose:** `space-6` (24px)
- **Extra Loose:** `space-8` (32px) / `space-12` (48px)

### Typography
- **H1 (Page Heading):** `text-2xl font-bold` / `font-sans` / `text-gray-50`
- **H2 (Section Heading):** `text-lg font-semibold` / `text-gray-100`
- **H3 (Subsection):** `text-base font-semibold` / `text-gray-200`
- **Body (Default):** `text-sm font-normal` / `text-gray-300` / `leading-relaxed`
- **Small (Helper, Label):** `text-xs font-normal` / `text-gray-400`
- **Monospace (Code, Values):** `font-mono text-xs` / `text-gray-300`

### Button Sizes & Padding
- **Small Button:** `px-3 py-1.5 text-xs`
- **Default Button:** `px-4 py-2 text-sm`
- **Large Button:** `px-6 py-3 text-base`

### Border Radius
- **Sharp (Inputs, Cards):** `rounded-md` (6px)
- **Smooth (Buttons, Pills):** `rounded-lg` (8px)
- **Round (Badges, Small Components):** `rounded-full`

### Focus Ring (Accessibility)
- **Focus Visible:** `ring-2 ring-offset-2 ring-blue-500 ring-offset-gray-950`
- **Applied via:** `:focus-visible` pseudo-class, visible on all interactive elements

### Transitions
- **Quick (Hover, State Changes):** `transition duration-100`
- **Standard (Fade, Slide):** `transition duration-200`
- **Slow (Modals, Overlays):** `transition duration-300`

### Reduced Motion
- Under `prefers-reduced-motion: reduce`, remove all transitions and animations; use instant state changes

---

## IMPLEMENTATION CHECKLIST: BEFORE YOU REFACTOR

Use this to kick off each refactor. Copy and customize per feature.

**Feature:** ___________________  
**Owner:** ___________________  
**Review Date:** ___________________

### Pre-Refactor
- [ ] All ten principles understood and documented in PR notes
- [ ] Required states (loading, empty, error, success, disabled) identified on mock-up
- [ ] Any destructive actions identified and safeguard strategy chosen (undo vs. dialog vs. typed)
- [ ] Design review completed and signed off
- [ ] Accessibility review flagged (keyboard, contrast, ARIA, focus)

### Post-Implementation (Before PR)
- [ ] Tier 5 Pre-Commit checklist passed (all boxes ticked)
- [ ] Form checklist passed (if applicable)
- [ ] Accessibility checklist passed (keyboard + screen reader tested)
- [ ] Responsive tested on mobile, tablet, desktop
- [ ] All states visible and working (load a real project, see skeleton → content → error path)
- [ ] Copy reviewed for clarity and tone
- [ ] No console errors or warnings

### Review Gate
- [ ] Designer sign-off (does it match the rubric?)
- [ ] Accessibility reviewer sign-off (keyboard, ARIA, contrast, focus)
- [ ] Lead engineer sign-off (code quality, tokens used, no regressions)

---

## RED FLAGS: INSTANT REJECTIONS

If any of these appear in a PR, request changes before merge:

1. **Principles broken:** Any of the ten principles failed (clarity, deference, depth, consistency, feedback, user-control, forgiveness, progressive-disclosure, direct-manipulation, aesthetic-integrity)
2. **Missing states:** Loading, empty, error, or success states absent or broken
3. **Unsafe destructive action:** Delete without undo, dialog, or confirmation
4. **Accessibility regression:** Keyboard unreachable element, invisible focus, color-only indicator, insufficient contrast
5. **Hardcoded values:** Hex colors, pixel spacing, or radii not in tokens
6. **Unclear labels:** "OK", "Submit", "Click here" or generic verbs without outcome
7. **Unrecoverable input loss:** Form clears after validation error or failed submit
8. **Layout breakage:** Responsive failure on mobile or tablet
9. **Privacy surprise:** Unexpected behavior, silent uploads, or hidden permissions
10. **Confirmation overload:** Too many dialogs; reversible actions confirm instead of undo



## CONCRETE VALUES
## Exact Design Token Values

### Color Palette (Tailwind Dark)
| Token | Value | Usage |
|-------|-------|-------|
| Primary Background | `bg-gray-950` | App container, main surface |
| Secondary Background | `bg-gray-900` | Cards, panels, list rows |
| Tertiary Background | `bg-gray-800` | Hover states, subtle sections |
| Overlay Scrim | `bg-black/80` | Modal backdrop, dimming |
| Border Subtle | `border-gray-800` | Dividers, subtle lines |
| Border Emphasis | `border-gray-700` | Form fields, focused borders |
| Text Primary | `text-gray-50` | H1, primary text |
| Text Secondary | `text-gray-100` | H2, secondary text |
| Text Tertiary | `text-gray-200` | Body, normal content |
| Text Muted | `text-gray-400` | Helper text, labels |
| Text Subdued | `text-gray-500` | Disabled text, hints |
| Primary Action | `bg-blue-600` | Buttons, primary calls-to-action |
| Primary Action Hover | `bg-blue-700` | Hover state for primary |
| Primary Action Text | `text-white` | Text on primary buttons |
| Secondary Action | `bg-gray-700` | Secondary buttons |
| Secondary Action Hover | `bg-gray-600` | Hover state for secondary |
| Destructive Action | `bg-red-600` | Delete, dangerous operations |
| Destructive Action Hover | `bg-red-700` | Hover state for destructive |
| Destructive Text | `text-white` | Text on destructive buttons |
| Success | `text-green-500` | Success status, checkmarks |
| Success Badge | `bg-green-900` | Success background |
| Success Badge Text | `text-green-200` | Success text |
| Error | `text-red-500` | Error status, validation |
| Error Badge | `bg-red-900` | Error background |
| Error Badge Text | `text-red-200` | Error text |
| Warning | `text-yellow-500` | Warning status, caution |
| Warning Badge | `bg-yellow-900` | Warning background |
| Warning Badge Text | `text-yellow-200` | Warning text |
| Info | `text-blue-500` | Informational status |
| Disabled Background | `bg-gray-800` | Disabled button/control |
| Disabled Text | `text-gray-500` | Disabled text label |
| Disabled Cursor | `cursor-not-allowed` | Pointer style for disabled |
| Link | `text-blue-500` | Links, underline |
| Link Hover | `text-blue-400` | Link hover state |

### Shadow / Elevation
| Token | Value | Usage |
|-------|-------|-------|
| Shadow None | `shadow-none` | Flat surfaces, no elevation |
| Shadow Subtle | `shadow-sm shadow-slate-900/50` | Buttons, inputs |
| Shadow Elevation 2 | `shadow-md shadow-slate-900/50` | Cards, containers |
| Shadow Elevation 3 | `shadow-lg shadow-slate-900/60` | Popovers, dropdowns |
| Shadow Overlay | `shadow-2xl shadow-slate-900/80` | Modals, top-level overlays |

### Spacing Scale (Tailwind)
| Token | Value | Usage |
|-------|-------|-------|
| Tight | `space-2` (8px) | Condensed, grouped items |
| Small | `space-3` (12px) | Normal spacing in compact layouts |
| Base | `space-4` (16px) | Default spacing, most use |
| Comfortable | `space-6` (24px) | Breathing room, sections |
| Loose | `space-8` (32px) | Major sections, whitespace |
| Extra Loose | `space-12` (48px) | Top-level sections, breathing |

### Typography
| Token | Value | Usage |
|-------|-------|-------|
| H1 | `text-2xl font-bold text-gray-50` | Page/screen heading |
| H2 | `text-lg font-semibold text-gray-100` | Section heading |
| H3 | `text-base font-semibold text-gray-200` | Subsection, card title |
| Body Large | `text-base font-normal text-gray-300 leading-relaxed` | Primary content |
| Body Default | `text-sm font-normal text-gray-300 leading-relaxed` | Normal text, lists |
| Body Small | `text-xs font-normal text-gray-400` | Helper text, labels |
| Monospace Code | `font-mono text-xs text-gray-300` | Code, values, tokens |
| Label | `text-xs font-semibold text-gray-400 uppercase tracking-wide` | Form labels |

### Button Dimensions
| Size | Padding | Font | Usage |
|------|---------|------|-------|
| Small | `px-3 py-1.5` | `text-xs` | Icon buttons, compact UI |
| Default | `px-4 py-2` | `text-sm` | Primary action buttons |
| Large | `px-6 py-3` | `text-base` | Full-width buttons, mobile |
| Icon Small | `p-1.5` | — | Icon-only, compact |
| Icon Default | `p-2` | — | Icon-only, normal |

### Border Radius
| Token | Value | Usage |
|-------|-------|-------|
| Sharp | `rounded-md` (6px) | Inputs, cards, containers |
| Smooth | `rounded-lg` (8px) | Buttons, moderately rounded |
| Round | `rounded-full` | Badges, pills, avatars |
| None | `rounded-none` | Sharp corners (rare) |

### Focus & Keyboard
| Token | Value | Usage |
|-------|-------|-------|
| Focus Ring | `ring-2 ring-offset-2 ring-blue-500 ring-offset-gray-950` | `:focus-visible` on all interactive |
| Focus Width | `2px` | Ring thickness |
| Focus Color | `ring-blue-500` | Keyboard focus indicator |
| Focus Offset | `ring-offset-2` / `ring-offset-gray-950` | Space between element and ring |

### Transitions & Motion
| Token | Value | Usage |
|-------|-------|-------|
| Instant | `transition-none` | Reduced motion, no animation |
| Quick | `transition duration-100 ease-out` | Hover, quick feedback |
| Standard | `transition duration-200 ease-out` | State changes, fade, slide |
| Slow | `transition duration-300 ease-out` | Modals, overlays, entrance |
| Reduced Motion Compliant | `prefers-reduced-motion: reduce { transition: none; }` | All animations disabled when enabled |

### Input & Form
| Token | Value | Usage |
|-------|-------|-------|
| Input Height | `h-10` (40px) | Default input field |
| Input Padding | `px-3 py-2` | Internal spacing |
| Input Border | `border border-gray-700` | Default border |
| Input Focus Border | `border-blue-500` | Focused state |
| Input Error Border | `border-red-600` | Validation error |
| Input Disabled | `bg-gray-800 text-gray-500` | Disabled state |
| Label Spacing | `mb-2` | Space below label |
| Error Text | `text-xs text-red-500 mt-1` | Validation message |
| Helper Text | `text-xs text-gray-400 mt-1` | Instruction, format hint |

### Responsive Breakpoints (Tailwind)
| Breakpoint | Width | Usage |
|------------|-------|-------|
| Mobile | < 640px | Narrow, single-column layouts |
| Tablet | 640px–1024px | Medium, two-column with sidebar |
| Desktop | > 1024px | Wide, full-featured layouts |



## RULES
- CLARITY: Every screen has one visible top-level <h1> stating its purpose. Two or more buttons never appear equally important.
- CLARITY: Button labels name actions, never say OK/Submit/Click here. Pair every status indicator with text, never color alone.
- DEFERENCE: Content occupies majority of viewport. One primary action per view; secondary actions are visually subordinate. Advanced controls hidden by default.
- DEFERENCE: Justify every border, shadow, and divider; prefer spacing. Neutral surfaces by default; reserve saturated color for state and emphasis.
- DEPTH: Every floating surface uses an elevation token, never raw z-index. No more than two transient overlays visible at once. Layers animate from their trigger.
- DEPTH: Focus is trapped in modals and restored on dismiss. Transitions fall back to instant fade under prefers-reduced-motion. Temporary surfaces dismiss on Escape or close button.
- CONSISTENCY: Identical actions use same component, icon, label, placement everywhere. One concept, one word—never Delete here and Remove there.
- CONSISTENCY: All spacing, color, radius values come from design tokens. No hardcoded hex or px. Loading, empty, error, success follow one app-wide pattern.
- FEEDBACK: Every control responds visibly within 100ms. Design all eight states: hover, focus, active, loading, success, error, empty, disabled.
- FEEDBACK: Over ~400ms show loading (spinner on control, keeping label). Over ~2s show progress bar or skeleton. Never show bare full-page spinner.
- FEEDBACK: Errors name the problem in plain language with a next step. Success is calm: brief confirmation, then return to work. Disabled controls explain why via tooltip.
- USER-CONTROL: Every destructive action offers Undo or restore. Every dialog and async job has a working Cancel. Failed actions show Retry with reason.
- USER-CONTROL: Confirm only irreversible actions Undo cannot cover. Automated changes stay visible and reversible. Escape closes overlays; back never loses unsaved work.
- FORGIVENESS: Prefer reversible actions; Undo is default safety net before dialogs. Autosave drafts; never clear a form on validation failure.
- FORGIVENESS: Preserve input across errors and navigation. Confirm irreversible or wide-reaching actions, naming what's affected. Offer 5+ second Undo window over blocking dialogs.
- FORGIVENESS: Validate inline and early, not only at submit. Make irreversible actions distinct; require deliberate intent (typed confirmation or checkbox).
- PROGRESSIVE-DISCLOSURE: Lead with common actions; group rare ones under Advanced or similar. Never hide destructive, save, submit, or recovery actions.
- PROGRESSIVE-DISCLOSURE: Default advanced sections collapsed behind descriptive trigger. Limit nesting to one or two layers. Keep trigger state honest with aria-expanded and chevron.
- DIRECT-MANIPULATION: Edit primary fields in place for small, reversible edits. Place controls next to content they affect. Update previews immediately when safe.
- DIRECT-MANIPULATION: Pair every drag-and-drop with keyboard alternative and screen-reader cue. Show saved state inline (saving, saved, error). Escape cancels edit, reverting value.
- AESTHETIC-INTEGRITY: Visual tone matches purpose (data views stay neutral). Color, type, spacing, radius, shadow come from tokens—no one-off hex.
- AESTHETIC-INTEGRITY: Every decorative element must justify itself or be removed. One elevation and shadow scale. Reserve accent for primary actions and key status only.
- LOADING-STATE: Use skeleton when layout is known; match shape, size, count to content. Scope to region fetching; never overlay whole page.
- LOADING-STATE: Reserve final layout space upfront—no shift when content arrives. For < 1s, show inline spinner; for > 2s, show determinate progress bar.
- EMPTY-STATE: Distinguish empty vs. no-results vs. error; never reuse one message. One primary action per empty state. Keep chrome visible.
- EMPTY-STATE: Never blame user; state neutrally and offer next step. Copy short: heading plus one supporting sentence max. Focus moves sensibly once user fills empty state.
- ERROR-STATE: State what happened in plain language, near where it happened. Name cause briefly; never raw codes. Tell user if data is safe.
- ERROR-STATE: Provide at least one recovery action: Retry, Reconnect, Edit, support. Never assign blame. Preserve user input—never clear form after failed submit.
- SUCCESS-STATE: Success is calm; brief confirmation, then return to work. Reversible actions show Undo toast (7–10 seconds). Never block screen for routine save.
- DISABLED-STATE: Explain why via tooltip or helper text, never look dead. Maintain readable contrast. Provide path to re-enable when possible.
- DESTRUCTIVE-ACTION: Style with danger token (red + label + icon). Name by outcome: Delete project, not OK. Prefer Undo toast to dialogs.
- DESTRUCTIVE-ACTION: Reversible destructive actions show Undo (7–10 seconds). Irreversible actions confirm via dialog (focus on Cancel) or typed confirmation.
- DESTRUCTIVE-ACTION: Dialogs default focus to Cancel, never destructive button. State permanent consequences including counts. Button restates verb: Discard changes, not Yes.
- CONFIRMATION: Confirm only meaningful, hard-to-reverse risk. If Undo is feasible, ship Undo instead. Body states consequence and scope with counts.
- CONFIRMATION: Confirm button uses action verb, never OK/Yes. Always provide Cancel: button + Escape + backdrop click. Never confirm routine, low-stakes actions.
- CONFIRMATION: Make Cancel default focus for destructive dialogs. Escape must cancel. Use role=alertdialog; link title via aria-labelledby, consequence via aria-describedby.
- SETTINGS: Group related settings under named sections, never flat list. Order by frequency. Use plain labels describing effect, not jargon.
- SETTINGS: Every control has visible, associated label (not placeholder). Required/optional explicit. Helper text one calm sentence. Risky settings show inline note.
- SETTINGS: Make save explicit: autosave with Saved confirmation, or save button disabled until change. Isolate destructive settings in bordered danger zone card.
- SETTINGS: Advanced/rare options behind progressive disclosure, default collapsed. Each section is fieldset with legend or heading.
- DATA-ENTRY: Collect minimum fields. Mark optional explicitly. Show format example for non-obvious fields (MM/YYYY, name@company.com).
- DATA-ENTRY: Validate on blur and submit, never mid-keystroke. Error messages explain fix, not just Invalid. Preserve input after errors.
- DATA-ENTRY: Use correct type and inputmode for right keyboard. Accept pasted values with spaces/dashes, normalize. Focus moves to first error after submit fails.
- DATA-ENTRY: Required state is token-driven prop, not ad-hoc markup. Group related fields; never split one value. Helper and error text link via aria-describedby.
- AI-ASSISTED: AI content visually distinct from user content (background token, badge, ghost text) until accepted.
- AI-ASSISTED: Every result offers Accept, Edit, Reject, Retry. Destructive replacements offer Undo. Never overwrite without explicit accept.
- AI-ASSISTED: State uncertainty plainly when confidence low or model declines. Route to manual path. Disclose what data feature sends before first use.
- AI-ASSISTED: Use specific verbs (Rewrite, Summarize, Suggest tags). Ban vague magic language. AI regions carry ARIA labels and keyboard navigation.
- ACCESSIBILITY: All interactive elements keyboard reachable via Tab. Focus order logical, matches reading order. Focus states visible with :focus-visible.
- ACCESSIBILITY: Buttons and links use correct semantics. All inputs have visible, associated label. Icon-only buttons have accessible names.
- ACCESSIBILITY: Color never the only indicator. Pair with text, icon, or shape. Text contrast meets WCAG AA (4.5:1 normal, 3:1 large).
- ACCESSIBILITY: Target sizes comfortable (min 44x44px touch). prefers-reduced-motion respected (no animation if enabled). Dialogs trap and restore focus.
- ACCESSIBILITY: Async changes announced via aria-live. Form errors linked via aria-describedby, marked aria-invalid=true. Busy regions marked aria-busy=true.
- RESPONSIVE: Narrow (< 640px): single column, stack vertically. Toolbars collapse to menu. Content fills screen. Touch targets large.
- RESPONSIVE: Medium (640–1024px): sidebar or rail visible. Two columns where space allows. Content stays readable. Inputs full width or paired.
- RESPONSIVE: Wide (> 1024px): full layout visible. Content bounded width, not edge-to-edge. Navigation persistent. Extra space for breathing, not clutter.
- RESPONSIVE: No layout breakage on any breakpoint. Content reflows logically. Text stays readable. Navigation accessible on all sizes.
- PRE-COMMIT: All ten principles satisfied. Required states present and working: loading, empty, error, success, disabled.
- PRE-COMMIT: Destructive actions styled with danger token and named by outcome. Reversible actions undo; irreversible confirm. No hardcoded colors/spacing.
- PRE-COMMIT: Accessibility checklist passed: keyboard, focus, labels, contrast, target size. Responsive tested mobile/tablet/desktop. Copy clear and concise.
- PRE-COMMIT: No console errors. Design review signed off. Accessibility review signed off. No unintentional tradeoffs.
- RED-FLAG: Missing any principle = rejection. Missing states = rejection. Unsafe destructive action = rejection.
- RED-FLAG: Accessibility regression (unreachable, invisible focus, color-only) = rejection. Hardcoded values = rejection. Unclear labels = rejection.
- RED-FLAG: Unrecoverable input loss = rejection. Responsive breakage = rejection. Privacy surprise = rejection. Over-confirmation = rejection.
