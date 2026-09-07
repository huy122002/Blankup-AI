---
name: BlankUp AI
description: Nền tảng thiết kế và cá nhân hóa áo thun với AI.
colors:
  champagne-gold: "#c19856"
  gold-deep: "#a37c3a"
  gold-soft: "rgba(193, 152, 86, 0.14)"
  champagne: "#ead9c0"
  ink: "#0f0c09"
  ink-soft: "#1d1b18"
  warm-paper: "#f5f2eb"
  paper-bright: "#fffdf8"
  paper-deep: "#ece4d3"
  body: "#3f3830"
  muted: "#6d6358"
  faint: "#8e7657"
  line: "rgba(15, 12, 9, 0.14)"
  line-soft: "rgba(15, 12, 9, 0.08)"
  success: "#4a5a3f"
  error: "#a3341f"
  warning: "#a3711f"
typography:
  display:
    fontFamily: "'Playfair Display', Georgia, serif"
    fontSize: "clamp(2.8rem, 5.2vw, 4.4rem)"
    fontWeight: 500
    lineHeight: 1.02
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "'Playfair Display', Georgia, serif"
    fontSize: "clamp(2rem, 3.4vw, 2.7rem)"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  title:
    fontFamily: "'Manrope', system-ui, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'Manrope', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "'DM Mono', monospace"
    fontSize: "0.72rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.14em"
rounded:
  xs: "2px"
  md: "3px"
  lg: "4px"
  full: "999px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper-bright}"
    typography: "{typography.label}"
    rounded: "{rounded.xs}"
    padding: "14px 26px"
  button-primary-hover:
    backgroundColor: "{colors.champagne-gold}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xs}"
    padding: "14px 26px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.xs}"
    padding: "14px 26px"
  input-default:
    backgroundColor: "{colors.paper-bright}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xs}"
    padding: "12px 14px"
  card-default:
    backgroundColor: "{colors.paper-bright}"
    textColor: "{colors.body}"
    rounded: "{rounded.md}"
    padding: "20px"
  chip-filter:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "9px 16px"
---

# Design System: BlankUp AI

## Overview

**Creative North Star: "The Cinematic Atelier"**

BlankUp is a warm-paper atelier where screen-print craft meets quiet cinema. Serif headlines carry the drama, technical mono labels carry the process, and champagne gold appears only where the eye should land — a hang-tag, a focus ring, a hover. Nothing is glossy or neon; everything feels tactile, printed, and deliberate.

Density is editorial, not dense: generous section air (128px), narrow reading measures, hairline rules instead of boxes. Motion is filmic and GPU-only — clip-and-rise reveals, split-char headlines, a trailing gold cursor ring that never hides the native pointer. What you preview is what you buy, so product surfaces stay honest and high-contrast.

**Key Characteristics:**
- Warm paper stage, ink craft, gold spotlight
- Tactile and confident controls with physical press response
- Technical mono detailing (eyebrows, prices, status) against serif drama
- Flat at rest, lift on response — depth is earned, not decorated

## Colors

Warm paper neutrals carry the page; a single champagne gold carries the accent; ink carries text and CTAs.

### Primary

- **Champagne Gold** (#c19856): the only accent. Eyebrows, active states, hover washes, focus rings, selection, price figures, italic serif highlights. Never a full-page background.
- **Deep Gold** (#a37c3a): gold's working weight — hover text, active nav links, eyebrow on light, button-hover text on gold. Dark-theme gold brightens to (#d5b178).
- **Gold Wash** (rgba(193, 152, 86, 0.14)): soft fills — badge backgrounds, chip hovers, pointer-spotlight blooms, login radial glow.

### Secondary (optional; omit if the project has only one accent)

- **Champagne Paper** (#ead9c0): gradient end-stop and login/paper-3 tint. Atmosphere, not UI chrome.

### Neutral

- **Ink** (#0f0c09): primary CTA fill, headings on light, nav/button text. Dark-theme inverse is Warm Paper (#f5f2eb).
- **Soft Ink** (#1d1b18): raised dark surfaces, AI-demo cards, editorial side panels.
- **Warm Paper** (#f5f2eb): default page ground (home, studio, pricing).
- **Bright Paper** (#fffdf8): cards, raised panels, login cards, dropdowns.
- **Deep Paper** (#ece4d3): subtle section grounds and hover paper.
- **Body Ink** (#3f3830): body copy on light.
- **Muted Fawn** (#6d6358): secondary/muted copy, placeholders.
- **Faint Ochre** (#8e7657): tertiary labels, avatar rings.
- **Hairline** (rgba(15, 12, 9, 0.14)): borders, dividers, card strokes. Soft variant at (rgba(15, 12, 9, 0.08)).
- **Moss Success** (#4a5a3f): success toasts, confirm states.
- **Kiln Error** (#a3341f): error toasts, destructive actions, auth errors.
- **Ochre Warning** (#a3711f): warning toasts.

### Named Rules (optional, powerful)

**The Ink Carries, Gold Speaks Rule.** CTAs are ink-on-paper by default; gold is accent and hover only. If gold covers more than ~10% of any viewport, remove some.
**The One Ground Rule.** Pages sit on warm paper (#f5f2eb) or bright paper (#fffdf8). Ink is never a full-page background — only small deliberate chips (active filters, tags, demo cards).

## Typography

**Display Font:** Playfair Display (with Georgia, serif fallback; self-hosted vietnamese + latin subsets)
**Body Font:** Manrope (with system-ui, sans-serif fallback; weights 400/500/600/700)
**Label/Mono Font:** DM Mono (with Menlo, Consolas, monospace fallback; technical labels, prices, data)

**Character:** Serif drama for headlines with italic gold accents; calm grotesque for reading; typewriter-precise mono for process. Vietnamese diacritics are first-class (subset unicode-ranges).

### Hierarchy

- **Display** (500, clamp(2.8rem, 5.2vw, 4.4rem), 1.02): hero and poster headlines only. Italic gold span for the emotional word.
- **Headline** (500, clamp(2rem, 3.4vw, 2.7rem), 1.1): section titles, login card titles, pricing titles.
- **Title** (700, 1.15rem, 1.15): card names, feature titles, step titles.
- **Body** (400, 1rem, 1.65): product descriptions, subtitles, form-adjacent copy. Max measure ~65ch.
- **Label** (500, 0.72rem, 0.14em tracking, uppercase): nav links, buttons, eyebrows, prices, badges, form labels. Eyebrow variant uses the same 0.72rem floor at 0.24em tracking (retired 0.66rem for legibility, typeset pass).

### Named Rules (optional)

**The One Italic Rule.** One italic serif accent per headline maximum (the `.bk-accent-i` / `.highlight` span). Everything else stays roman.
**The Mono-For-Process Rule.** Anything that is process — price, status, step number, eyebrow, button — speaks in DM Mono uppercase. Anything that is persuasion speaks in serif or Manrope.

## Layout

Container-and-hairline editorial model. Centered container (1240px, side padding 0 32px; 0 20px under 768px). Sections breathe at (128px 0) desktop, (84px 0) mobile. Alternating light grounds (paper / bright-paper / paper-alt #faf7f1) give rhythm without ever going dark.

Grids: hero 1.05fr/0.95fr (stacks to 1fr under 1024px); products auto-fill minmax(260px, 1fr) gap 28px; gallery 4-up to 1-up; steps 3-up hairline-divided (1px gutters on `--line`) collapsing to 1-up. Studio app shell: left rail (380px), canvas, right rail (300px); toolbar (52px); nav (72px fixed).

Spacing rhythm steps from an 8px base (8px, 16px, 24px, 32px); card padding (20–40px); form rows 2-up collapsing to 1-up under 768px. Breakpoints: (1024px) stack grids, (768px) burger nav + column buttons, (480px) single-column footer and stats.

## Elevation & Depth

Flat-by-default with tonal paper layering; shadows appear only as a response to state (hover, raised, modal, login card).

### Shadow Vocabulary (if applicable)

- **Resting hairline** (`border: 1px solid rgba(15, 12, 9, 0.14)`): default card/product/nav separation. No shadow.
- **Lift** (`box-shadow: 0 1px 0 rgba(15, 12, 9, 0.04), 0 16px 40px rgba(15, 12, 9, 0.1)`): hover on gallery/pricing/stat cards, mockup shells.
- **Spotlight bloom** (`background: radial-gradient(320px circle at var(--spot-x, 50%) var(--spot-y, 50%), rgba(193, 152, 86, 0.14), transparent 65%)`): pointer-tracked gold wash on curated cards, fading in on hover.
- **Cinematic card** (`box-shadow: 0 2px 0 rgba(15, 12, 9, 0.04), 0 28px 70px rgba(15, 12, 9, 0.16)`): login card, hero mockup at rest, large raised panels.
- **Studio card hover** (`box-shadow: 0 4px 12px rgba(23,20,15,0.09), 0 12px 28px rgba(23,20,15,0.07)`): app-surface card lift.

### Named Rules (optional)

**The Flat-By-Default Rule.** Surfaces are flat with hairlines at rest. Shadows appear only on hover, raised panels, toasts, dropdowns, and the login card — never as permanent decoration.

## Shapes

Sharply editorial, almost square. Inputs tightest (2px), buttons slightly set (2px), cards and images softly cut (3px), large shells (4px); pills (999px) reserved for filter toggles and small toggles only. Borders are hairlines (rgba ink 0.12–0.26); stitched seams are dashed gold (1px dashed rgba(163, 124, 58, 0.55)) on garment tags, mockup headers, and float cards.

Signature geometry: print registration crosshair-in-circle (15px `.reg-mark`) on framed visual panels; garment-label eyebrow tag (mono uppercase, 0.72rem, 0.14em, bordered, with punched-dot `::before`); film grain overlay (fixed, 5% multiply; 7% screen in dark); 72px fixed nav with hairline bottom and blur (8–14px).

## Components

### Buttons

Tactile and confident. Ink-solid, mono uppercase, square-cut.

- **Shape:** sharply square (2px radius).
- **Primary:** ink fill (#0f0c09) with bright-paper text (#fffdf8), 1px ink border, padding (14px 26px); large (16px 30px), small (10px 18px).
- **Hover / Focus:** fill shifts to champagne gold (#c19856) with ink text; focus ring is a 2px gold outline offset 2px. Press: translateY(1px) scale(0.99) over 120ms, transform-only.
- **Secondary / Ghost / Tertiary (if applicable):** transparent fill, ink text, strong-hairline border; hover tightens border to ink (ghost adds paper-alt wash). Loading holds scale(0.98); success flips to moss (#4a5a3f) with check; error shakes (280ms keyframes, disabled under reduced-motion).

### Chips (if used)

- **Style:** filter pills — transparent ground, muted mono uppercase text (0.72rem), 1px border, pill radius (999px), padding (9px 16px).
- **State:** hover tightens border to heading ink; active is solid ink fill with paper text. Studio style-chips use boxed 6px variant with gold active (gold text, gold border, gold wash fill).

### Cards / Containers

- **Corner Style:** softly cut (3px radius); large shells (4px); login card adds a 3px gold top-rule.
- **Background:** bright paper (#fffdf8) on warm-paper grounds; subtle hover shifts to (#f7f1e3).
- **Shadow Strategy:** flat with hairline border at rest; Lift shadow plus translateY(-3 to -6px) on hover; pointer spotlight bloom fades in.
- **Border:** 1px hairline (card-border #e7e2d6 light / rgba paper 0.14 dark); gallery/product skip outer padding — image flush, info padded (14–20px).
- **Internal Padding:** 20px default; feature cards (36px 28px); testimonials (30px); login (44–48px).

### Inputs / Fields

- **Style:** two dialects, never mixed on one surface — underline editorial (transparent, 1px bottom hairline, padding 10px 2px) for marketing/contact/auth-cinematic; boxed (bright paper, 1px border #e7e2d6, 2px radius, padding 12px 14px) for login-card default, studio, and admin.
- **Focus:** border shifts to gold (#c19856 / rust #a37c3a on boxed); 2px gold outline for keyboard focus-visible.
- **Error / Disabled:** auth error band — mono 0.78rem deep-gold text on gold wash with 2px radius; toasts mirror success/error/warning border tints.

### Navigation

Fixed 72px hairline bar with blur (paper 0.92 + 8px blur; pricing sticky + 14px blur). Wordmark in heading/sans 700 (pricing italic serif). Links in mono uppercase (0.72–0.74rem, muted) with 1px gold underline slide on hover. Actions: VI/EN toggle (bordered 2px box, active cell ink fill), theme toggle where present, ink CTA. Mobile: burger under 768px, menu drops as bordered column panel. User menu: 30px ink avatar circle, 240–250px dropdown card with header, hairline divider, mono kicker items.

### Signature Components

- **Print registration mark (`.reg-mark`):** 15px crosshair-in-circle in 22% ink at the four corners of every framed visual. Decorative, pointer-events none.
- **Garment-label tag (`.tag` / `.bk-eyebrow`):** mono uppercase eyebrow with punched-dot leader; max one per three sections. Mono (0.72rem, 0.14–0.24em).
- **Film grain (`.bk-grain`):** fixed SVG-turbulence overlay, 5% multiply (7% screen dark), pointer-events none, painted once.
- **Cursor ring (`.bk-cursor-ring`):** 14px gold ring trailing the pointer, swelling to 52px with gold wash on interactive hover; hidden on coarse pointers and reduced-motion.
- **Scroll reveal (`.rv` / `[data-reveal]`):** clip + rise (translateY 24–34px, 0.7–1s expo-out), staggered 60ms per child; split-char headline variant (28ms per char). All disabled under prefers-reduced-motion.

## Do's and Don'ts

Concrete visual guardrails grounded in the incumbent implementation.

### Do:

- **Do** keep pages on warm/bright paper and CTAs in ink — let gold speak in one place per viewport (eyebrow, hover, price, or focus).
- **Do** use Playfair italic for the single emotional word in a headline, Manrope for reading, DM Mono uppercase for process (nav, buttons, prices, badges, form labels).
- **Do** separate cards with 1px hairlines at rest and add Lift shadow plus translateY(-3px) only on hover or raised state.
- **Do** keep corners near-square (2px inputs/buttons, 3px cards/images, 999px pills only for filters/toggles) and dashed gold seams only on garment-tag surfaces.
- **Do** honor reduced-motion (kill reveals, cursor ring, spotlight, shake, view-transitions) and keep the 2px gold focus-visible ring on every interactive element.

### Don't:

- **Don't** flood surfaces with gold or ink — no gold page backgrounds, no full-viewport ink sections; dark is reserved for small chips, demo cards, and theme-inverted meanings.
- **Don't** round cards to large radii, add drop shadows at rest, or use glass blur outside nav/dropdowns — flat hairlines are the default.
- **Don't** set body copy in Playfair, headlines in all-caps sans, or buttons/prices in non-mono proportional type — the serif/sans/mono roles are fixed.
- **Don't** hide the native cursor, block pointer events with grain/spotlight overlays, or ship hover-only meaning without a focus/keyboard equivalent.
- **Don't** hard-code prices, credits, or plan copy into styles or markup — pricing renders from `GET /api/ai-plans`, and Vietnamese + English strings stay in markup/JS, not in CSS.
