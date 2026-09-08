---
target_identity: "file:C:\\Users\\cubin\\OneDrive\\Desktop\\EXE\\Blankup-AI\\frontend\\studio.html"
target_fingerprint: "sha256:c834ca7767ff49ab915a289b3b549c71e078241d204942e612d858108e6be87d"
target_path: "C:\\Users\\cubin\\OneDrive\\Desktop\\EXE\\Blankup-AI\\frontend\\studio.html"
timestamp: 2026-09-07T08-30-19Z
slug: frontend-studio-html
---
# Critique — frontend/studio.html (BlankUp AI Studio)

## Method
Degraded single-context (no sub-agent tool exposed). Assessment A: source review of frontend/studio.html + tokens/studio.css. Assessment B: `impeccable detect --json frontend/studio.html`.

## Design Health Score (Operate mode, all 10 heuristics apply)
| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Disabled Order/Download/Share give no reason; placement hidden until generation is good |
| 2 | Match System / Real World | 3 | Vietnamese commerce copy is natural; sliders speak X/Y/% coordinates |
| 3 | User Control and Freedom | 2 | Auth wall modal has no dismiss/guest path; no undo for generation |
| 4 | Consistency and Standards | 3 | Atelier tokens coherent; product color dots + 20px chips diverge |
| 5 | Error Prevention | 2 | maxlength/accept/hints present; 10MB + phone rules only enforced late |
| 6 | Recognition Rather Than Recall | 2 | 7 placement sliders require recall; presets help but are secondary |
| 7 | Flexibility and Efficiency | 1 | No shortcuts, no bulk, one-at-a-time generation |
| 8 | Aesthetic and Minimalist Design | 3 | Strong paper/ink/gold world; glow + hairline+shadow + all-caps dilute it |
| 9 | Error Recovery | 2 | Inline role=alert errors good; refresh/mid-flow preservation unclear |
| 10 | Help and Documentation | 2 | Empty-state tips + hints + onboarding overlay; no contextual help for placement |
| **Total** | | **23/40** | **Acceptable** |

## Design Specificity Verdict
**LLM assessment**: Coherent Cinematic Atelier (warm paper, ink CTAs, gold spotlight, mono-for-process, serif drama) — not interchangeable. Left rail controls, 3D preview, placement presets, community strip, and Vietnamese print copy feel authored for BlankUp's design-to-order flow. Missed character: style chips and placement sliders read as generic tool panels; product color dots are raw functional hex with no atelier framing.
**Deterministic scan**: 17 findings on frontend/studio.html — 2 warnings (all-caps-body 37 chars, dark-glow gold halo), 15 advisory (4× hairline+wide-shadow, 9× color-outside-DESIGN, 1× 20px radius, 1× em-dash saturation). False positives: 5 product color dots (#1e293b, #6b7280, #dc2626, #2563eb, #059669) are selectable shirt colors, not system drift — DESIGN.md needs a product-color exception, not a fix. Real hits: glow, elevation indecision, uppercase badge, 20px suggestion chips vs 2/3/4px scale.

## Overall Impression
The bones are right — prompt, preview what you buy, then order in one place. The single biggest opportunity is staging: everything is visible before anything has value. Gate the entry kindly and reveal product/placement only after first generation.

## What's Working
1. **Honest preview core**: empty state with 10–200 char + PNG-transparency tip, front/back toggle, drag/rotate/reset, print-proof sheet. Directly serves "what you preview is what you buy."
2. **Good form manners**: aria-describedby, live counts (0/2000, 0/1000), role=alert errors, autocomplete/inputmode, Vietnamese phone hint, upload formats stated.
3. **Progress + history**: generation overlay with % + message, skeleton community loading, localStorage history list. High-stakes AI wait is acknowledged.

## Priority Issues
- **[P1] Auth wall traps first-run**: unauthenticated entry forces modal (display flex, body overflow hidden) with only Login/Home. Trial banner promises 1 free generation but modal blocks it. Fix: dismissible modal + guest trial path, defer hard gate to order/save. Suggested: /impeccable onboard
- **[P1] Three columns compete before first value**: left (8 styles + 8 suggestions + text), right (type/color/size/qty/price/actions), center empty. Cognitive load high. Fix: Step 1 = prompt only; reveal product + placement after first design. Suggested: /impeccable distill
- **[P1] 7 raw sliders as primary placement**: X/Y/scale/rotation + text X/Y/scale with numeric ranges (-80..80, 20..220). Recall over recognition, thumb-hostile. Fix: visual drag + 5 position / 3 size presets as primary, collapse sliders into Advanced. Suggested: /impeccable layout
- **[P2] Disabled actions with no reason**: Order/Download/Preview/Share disabled with no helper. User hits dead end. Fix: enablement rule + inline hint "Tạo design để mở khóa" + aria-disabled + tooltip. Suggested: /impeccable clarify
- **[P2] Elevation + glow indecision**: hairline border paired with 16px diffuse shadow (4×), gold glow on dark, uppercase badge (MẶT TRƯỚC, 37 chars). Violates flat-by-default. Fix: hairline OR shadow, neutralize glow, sentence-case badge. Suggested: /impeccable polish

## Persona Red Flags
**Alex (Power)**: no shortcuts for generate/front-back/reset; one-at-a-time generation, no batch variations; history exists but no re-run/duplicate; slow 3D + overlay cannot be skipped.
**Jordan (First-Timer)**: entry modal is first pixel — "login or leave"; 8 styles + 8 suggestions + 3 tabs with no recommended path; placement numbers assume print knowledge; order form asks name/phone/address with no guest reassurance until success note.
**Casey (Mobile, one-handed)**: 380px + 300px rails + canvas do not fit thumb zone; 7 sliders + 7 color dots are tiny targets; primary Generate sits in left rail, Order in right rail — both off thumb reach; interruption loses prompt (only history persists, not draft); 3D/Three.js heavy on 3G.

## Minor Observations
- Suggestion chips use 20px radius vs 2/3/4px editorial scale — either tokenize or square them.
- Em-dash saturation (11) in Vietnamese body copy — swap most for commas/colons.
- Canvas has role=img + label (good) but no keyboard alternative for drag/rotate; focus-visible gold ring must be verified on all toolbar/preset/slider controls.
- Order success "contact in 24h" is weak reassurance after payment — add order ID + tracking entry point.
- Price renders static 250,000₫ in HTML — must render from GET /api/ai-plans per DESIGN.md guardrail.

## Questions to Consider
- What if the first viewport were only prompt + Generate, and everything else revealed itself after value?
- Does placement need 7 sliders, or would drag + 5 presets + 1 size cover 95% of orders?
- What would a confident guest trial feel like — create first, login only to save/order?
