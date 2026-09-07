# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: Vietnamese shoppers/creators who describe an idea in text (or supply an input image), generate AI T-shirt designs in Studio, preview them on product, and order on the same platform.

Secondary: Admin operators who manage users, orders and payments, vouchers, AI plans and credits, designs and community content, plus reports and exports.

## Product Purpose

BlankUp AI combines an AI Creative Studio, e-commerce ordering, community gallery, and operations admin on one web platform. Users create and save AI designs, preview them on product, pick variants, apply vouchers, pay, track orders, and manage their account. Success means a complete design-to-order flow works end to end without leaving the platform.

## Positioning

Unlike standalone image generators or blank-apparel shops, BlankUp fuses text/image-to-design Studio plus product preview with integrated commerce (variants, voucher rules, COD/bank transfer/VNPay, order tracking) behind a multi-provider AI gateway (OmniRoute, OpenAI, Cloudflare AI) so providers can be added without changing core flows.

## Operating Context

Core shopper workflow: describe idea or upload image -> generate design -> preview on product (Three.js) -> save/manage designs -> pick product variant -> customize order info -> apply voucher -> pay -> track order.

Supporting workflows: discover community/gallery designs and like/comment; register/login, email verification, forgot/reset password, account and order-history management; admin management of users, orders, payments, vouchers, AI plans/credits, designs, metrics/reports and data exports.

Environment: web, Vietnamese-first copy and Vietnamese phone validation, VND commerce with COD, bank transfer, VNPay and Sepay confirmation flows, email-based verification and notifications.

## Capabilities and Constraints

Capabilities (confirmed in repo): AI Studio from text and from input image; preview on product; saved/my designs; product types and variants; configurable vouchers (fixed amount, percent, min order value, validity window, total and per-user limits, business scope); payments COD, bank transfer, VNPay, Sepay; order status tracking; JWT auth with `user` and `admin` roles; email verification and password reset; community gallery with likes/comments; admin CRUD plus reports/exports.

Constraints to preserve (user-confirmed): keep static HTML/CSS/JS + Three.js frontend and Express + SQL Server backend; keep Vietnamese flows, current payment methods and voucher/credit rules, and the two-role model; API envelope `{ success, data }` / `{ success, error }`; JWT payload `{ userId, username, role }`; OTP 6 digits expiring after 2 minutes; input validation (email format, password min 8 chars, Vietnamese phone, files max 10MB); no secrets in repo, env-only server keys.

Explicitly undecided: production deploy target and config; accessibility standard; future AI providers beyond OmniRoute/OpenAI/Cloudflare AI; additional specialized roles; public pricing/licensing claims.

## Brand Commitments

Name: BlankUp AI (also written Blankup AI). Tagline from repo: "Nền tảng thiết kế và cá nhân hóa áo thun với AI." Voice follows existing README and Vietnamese product copy. No binding visual constraints were volunteered during init.

## Evidence on Hand

Real sources: `README.md`, `frontend/*.html` (index, studio, creator, pricing, account, login, admin, etc.), `backend/routes/*.js` (auth, ai-design, ai-plans, products, orders, payment, admin, etc.), `openspec/specs/` (ai-design, auth, orders, api-standards, security).

Absences future work must not fabricate: no confirmed testimonials, customers, case studies, press, benchmarks, pricing, or licensing claims on hand.

## Product Principles

1. Design-to-order in one place: creation, preview, purchase, and tracking stay connected.
2. What you preview is what you buy: preview fidelity outranks decoration.
3. Provider flexibility without workflow breakage: add AI providers behind the gateway, not through the flows.
4. Trustworthy commerce: voucher, credit, payment, and order consistency are product features.
5. Operable by default: admin visibility, reports, and exports ship with the feature.
