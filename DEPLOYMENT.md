# DEPLOYMENT — Phương án deploy BlankUp (FE + BE)

> Nghiên cứu ngày 23/09/2026. Giá/giới hạn theo thông tin mới nhất từ nhà cung cấp.

## 1. Đặc điểm kiến trúc ảnh hưởng quyết định deploy

| Yếu tố | Chi tiết | Hệ quả khi deploy |
|---|---|---|
| Server đơn | `backend/server.js` phục vụ cả API (`/api/*`) + FE static (thư mục `frontend/`) cùng origin | Deploy **1 service duy nhất**, không cần tách FE/BE |
| Không build | FE là HTML/CSS/JS thuần, không bundler | Không cần CI pipeline build; chỉ cần `npm install` + `node server.js` |
| Database | **SQL Server** qua `mssql` (Windows Auth hoặc sa) | PaaS thường không có SQL Server managed → cần Azure SQL, VPS tự cài, hoặc chuyển sang file-backed demo mode |
| File storage | `backend/uploads/` (ảnh design ~1MB) + `backend/data/*.json` (orders, designs, comments…) | Cần **persistent disk** — volume gắn vào instance, KHÔNG dùng ephemeral filesystem (mất dữ liệu mỗi lần redeploy) |
| Google OAuth | FE hardcode Client ID (`frontend/js/social-config.js`), BE xác thực `GOOGLE_CLIENT_ID` | Khi đổi domain phải thêm Authorized JavaScript origin mới trên Google Cloud Console |
| Gmail SMTP | OTP đăng ký, quên mật khẩu | Gmail App Password hoạt động từ cloud bình thường (không bị chặn IP) |
| Webhook thanh toán | Sepay webhook, VNPay return | Cần **HTTPS public URL** — local ngrok chỉ dùng được để test |
| AI keys | Cloudflare (image + prompt), Gemini | Gọi outbound từ server, không phụ thuộc nơi deploy |

> **Lưu ý quan trọng:** app đang có cơ chế fallback "file-backed demo mode" khi SQL Server không kết nối được — mọi ghi chú trong tài liệu này ưu tiên giữ SQL Server thật vì dữ liệu users/orders/vouchers đang nằm trong DB; demo mode chỉ lưu 1 phần (orders/designs JSON) và không phù hợp production.

---

## 2. So sánh các phương án

### Phương án A — PaaS: Railway / Render (dễ nhất, chạy 24/7)

| | Railway (Hobby) | Render (Starter) |
|---|---|---|
| Giá | $5/month gồm $5 credit dùng theo lượng; thực tế app nhỏ ~$5–15/tháng | $7/month/service, always-on |
| Chạy 24/7 | ✅ Không spin-down (hết credit thì dừng service — cần theo dõi) | ✅ Không spin-down |
| Persistent disk | ✅ Volume (tính tiền theo GB) | ✅ Disk gắn vào service |
| SQL Server | ❌ Không có managed SQL Server | ❌ Không có |
| Deploy | Kết nối GitHub, auto-deploy mỗi push | Kết nối GitHub, auto-deploy |
| Domain HTTPS | ✅ Tặng subdomain + custom domain | ✅ Tặng subdomain + custom domain |
| Ngủ đông free | Không còn free tier (phải nạp tối thiểu $5) | Free tier bị spin-down sau 15 phút + giới hạn 750h/tháng — KHÔNG phù hợp 24/7 |

**Vấn đề database:** cả hai không có SQL Server managed. Ba lựa chọn:
1. **Azure SQL Database (free offer)** — 100.000 vCore-seconds/tháng + 32GB, miễn phí vĩnh viễn cho 1 DB serverless (auto-pause 1 giờ không dùng). `mssql` của Node kết nối Azure SQL bình thường (chỉ khác connection string: `yourdb.database.windows.net`, user `sqladmin`, enable "Allow Azure services" trong firewall). Đây là cách giữ nguyên code DB hiện tại với chi phí 0đ.
2. Chạy ở **demo mode** (không khuyến nghị production).
3. Chuyển sang Postgres/SQLite — phải sửa code nhiều, bỏ qua.

**Chi phí ước tính:** Railway ~$5–15/tháng (app + volume) hoặc Render ~$7 + disk ~$1–2 + Azure SQL free = **~$7–17/tháng**.

**Đánh giá:** Cấu hình nhanh nhất (~30–60 phút), auto-deploy từ GitHub, đủ chạy 24/7 mượt với traffic nhỏ/vừa.

---

### Phương án B — Fly.io (mềm dẻo, rẻ hơn khi tối ưu)

- Tính theo tài nguyên thực dùng: shared-cpu-1x (256MB) ~$2–4/tháng + volume 3GB ~$0.66/tháng + IPv4 $2/tháng → **~$5–8/tháng**.
- ✅ Always-on thật (không spin-down), persistent volume, deploy qua `fly launch` (tự nhận Node app) hoặc Dockerfile.
- ❌ Không có SQL Server managed → dùng Azure SQL free như trên.
- ❌ CLI-heavy hơn Railway/Render; máy khu vực Singapore (sin) là gần Việt Nam nhất (~40–70ms), FrankFurt xa hơn.
- Cần credit card để tạo organization (có $5 credit thử miễn phí nhưng yêu cầu card).

**Đánh giá:** Rẻ hơn Render một chút, hiệu năng tốt, nhưng thao tác nhiều hơn. Phù hợp nếu quen CLI.

---

### Phương án C — VPS Hetzner (rẻ nhất lâu dài, tự quản nhiều nhất)

- Hetzner CX22 (2 vCPU / 4GB / 40GB NVMe): **~€4.5–6.5/tháng** (giá đã tăng 2026, vùng Falkenstein/Helsinki).
- Tự cài mọi thứ: Node + PM2 (chạy 24/7, auto-restart), Nginx reverse proxy + Let's Encrypt HTTPS, SQL Server Express **trên chính VPS** (Windows Auth không cần — dùng SQL login sa; SQL Server Express free chạy được trên Linux qua container hoặc cài trực tiếp — tiêu thụ ~1–1.5GB RAM, CX22 đủ).
- Chi phí tổng: **~€6–8/tháng** cho tất cả (app + DB + storage) — rẻ nhất khi đã vượt free tier Azure SQL.
- Vùng gần VN: Hetzner có Singapore từ 2024 (~50–80ms) — chọn SG nếu khách chủ yếu ở VN.
- ❌ Phải tự vận hành: bảo mật SSH, update, backup thủ công, uptime tự chịu (~99.9% nếu cấu hình tốt).

**Đánh giá:** Rẻ nhất và toàn quyền, nhưng cần kỹ năng sysadmin + thời gian setup ban đầu (~2–4 giờ). Phù hợp khi dự án ổn định, muốn chi phí thấp dài hạn.

---

### Phương án D — Vercel/Netlify (KHÔNG phù hợp)

- Chỉ host static tốt, nhưng **API server Express dài chạy không phù hợp model serverless** ( Express + mssql connection pool + file uploads). Chỉ dùng nếu tách FE static sang Vercel và BE sang nơi khác — phức tạp hoá mà không có lợi vì FE đã được BE serve cùng origin (CORS đơn giản, cookie auth dễ).

---

## 3. Khuyến nghị theo giai đoạn

| Giai đoạn | Phương án | Chi phí/tháng | Lý do |
|---|---|---|---|
| **Demo cho case học phần / thuyết trình** | Render Starter hoặc Railway + Azure SQL free | ~$7 | Setup nhanh nhất, auto-deploy, đủ mượt |
| **Production thật, traffic nhỏ–vừa (<1000 users)** | Railway/Fly.io + Azure SQL free | ~$5–8 | 24/7 ổn định, chi phí thấp, có volume |
| **Production ổn định, tối ưu chi phí dài hạn** | Hetzner VPS SG | ~€6–8 (~$7–9) | Toàn quyền, DB + app + uploads chung 1 máy, không lo hết quota Azure |

> Cả 3 phương án đều giữ nguyên 100% code hiện tại — không phải sửa logic app.

---

## 4. Checklist cấu hình khi deploy (bắt buộc để mọi chức năng hoạt động)

### 4.1. Biến môi trường (điền trên dashboard của nền tảng, KHÔNG commit .env)

```
NODE_ENV=production
PORT=3000                        # hoặc theo nền tảng
REQUIRE_SQL_SERVER=true          # bắt buộc DB, không chạy demo mode

# SQL Server (Azure SQL)
SQL_SERVER=yourdb.database.windows.net
SQL_DATABASE=BlankupDB
SQL_USER=sqladmin
SQL_PASSWORD=...
SQL_ENCRYPT=true

# JWT
JWT_SECRET=<random 64+ ký tự — BẮT BUỘC vì NODE_ENV=production sẽ throw nếu thiếu>

# Google OAuth
GOOGLE_CLIENT_ID=116646431316-5kkndeufqeikrqer21492rkm0k6bi4ih.apps.googleusercontent.com

# Gmail SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=cubinlylom@gmail.com
SMTP_PASS=<App Password 16 ký tự — thu hồi mã cũ trong chat, tạo mã mới>
SMTP_FROM="Blankup <cubinlylom@gmail.com>"

# AI providers
CLOUDFLARE_ENABLED=true
CLOUDFLARE_ACCOUNT_ID=<your-cloudflare-account-id>
CLOUDFLARE_API_TOKEN=<rotate sau khi lộ trong chat>
CLOUDFLARE_IMAGE_MODEL=@cf/black-forest-labs/flux-1-schnell
CLOUDFLARE_PROMPT_MODEL=@cf/meta/llama-3.1-8b-instruct

GEMINI_ENABLED=true
GEMINI_API_KEY=<rotate sau khi lộ trong chat>
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image

# CORS + thanh toán
ALLOWED_ORIGINS=https://yourdomain.com
VNP_TMN_CODE=... VNP_HASH_SECRET=... VNP_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html
VNP_RETURN_URL=https://yourdomain.com/api/payment/vnpay-return
SEPAY_WEBHOOK_SECRET=...
```

### 4.2. Google OAuth (bắt buộc để login Google hoạt động)

1. Vào https://console.cloud.google.com/apis/credentials → OAuth 2.0 Client ID hiện có.
2. **Authorized JavaScript origins** — thêm `https://yourdomain.onrender.com` (hoặc domain Railway/Fly) và `https://yourdomain.com` nếu dùng custom domain.
3. (Không cần redirect URI cho flow GSI one-tap hiện tại.)
4. Nếu đổi Client ID mới: sửa **cả hai** nơi — `frontend/js/social-config.js` (FE) và env `GOOGLE_CLIENT_ID` (BE) — hai giá trị phải khớp nhau.

### 4.3. Gmail SMTP

- App Password hiện tại đã xuất hiện trong chat → **thu hồi và tạo App Password mới** trước khi deploy (Google Account → Security → 2-Step Verification → App passwords).
- Gmail giới hạn ~500 mail/ngày cho App Password — đủ cho đăng ký + quên mật khẩu giai đoạn đầu.

### 4.4. AI keys (Cloudflare + Gemini)

- Cả 2 key đã lộ trong chat → **rotate**: Cloudflare dashboard → API Tokens → Roll; Google AI Studio → tạo key mới, xoá key cũ.
- Sau khi rotate, điền key mới vào env của nền tảng deploy.
- Không cần cấu hình thêm gì về mạng (outbound HTTPS).

### 4.5. Persistent storage

- Gắn volume/disk mount vào `backend/uploads` và `backend/data` (Railway: Volume service; Render: Disk; Fly: `fly volumes create`).
- Backup định kỳ: dump `BlankupDB` (Azure SQL tự backup 7 ngày miễn phí) + rsync volume.

### 4.6. Webhook thanh toán

- Sepay dashboard → đặt webhook URL = `https://yourdomain.com/api/ai-plans/sepay-webhook` (HTTPS bắt buộc).
- VNPay sandbox → `VNP_RETURN_URL` như trên; khi lên production đổi `VNP_URL` sang trang thật + TMN thật.

---

## 5. Các bước deploy chi tiết — Railway (khuyến nghị bắt đầu)

1. `railway login` → `railway init` trong repo → chọn "Deploy from GitHub".
2. Settings → Root Directory = `backend` (Railway build service này), Start Command = `node server.js`.
3. Variables → dán toàn bộ env ở mục 4.1.
4. Volumes → tạo volume, mount path = `/app/data` + `/app/uploads` (hoặc path tương ứng trong container).
5. Azure Portal → tạo Azure SQL Database (free offer) → firewall cho phép Azure services → lấy connection string điền vào env.
6. Deploy → Railway cấp domain `xxx.up.railway.app` → thêm vào Google OAuth origins (4.2).
7. Mở `https://xxx.up.railway.app` → test đăng ký + login Google + tạo design AI + mua gói.
8. Custom domain (tuỳ chọn): trỏ CNAME về Railway, thêm vào ALLOWED_ORIGINS + Google origins.

## 6. Các bước deploy chi tiết — Hetzner VPS

1. Tạo CX22 (Singapore/Falkenstein), SSH key login.
2. `apt update && apt install -y nodejs npm nginx certbot python3-certbot-nginx`.
3. Clone repo → `cd backend && npm ci --omit=dev`.
4. Cài SQL Server Express trên Ubuntu (`mssql-server` package, 2GB RAM yêu cầu — CX22 4GB đủ) hoặc chạy container `mcr.microsoft.com/mssql/server:2022-latest`. Restore `BlankupDB` từ backup local.
5. Tạo `/etc/systemd/system/blankup.service`:
   ```ini
   [Unit]
   Description=Blankup API
   After=network.target mssql-server.service
   [Service]
   WorkingDirectory=/opt/blankup/backend
   ExecStart=/usr/bin/node server.js
   EnvironmentFile=/opt/blankup/backend/.env.production
   Restart=always
   User=www-data
   [Install]
   WantedBy=multi-user.target
   ```
6. `systemctl enable --now blankup`.
7. Nginx reverse proxy 80/443 → 3000, `certbot --nginx` cho HTTPS.
8. Google OAuth origins + Sepay/VNPay URLs → domain thật.

---

## 7. Rủi ro & việc cần làm trước khi deploy

| Rủi ro | Mức độ | Việc làm |
|---|---|---|
| API keys đã lộ trong chat (Cloudflare, Gemini, Gmail App Password) | 🔴 Cao | Rotate toàn bộ trước khi điền vào env production |
| `JWT_SECRET` default trong code nếu quên set | 🔴 Cao | Đã có check throw khi NODE_ENV=production — vẫn phải set giá trị mạnh |
| `data/*.json` (orders/designs) ở demo mode sẽ mất khi redeploy nếu không có volume | 🟠 Trung | Bắt buộc gắn persistent disk |
| Google OAuth quên thêm domain mới | 🟠 Trung | Bấm login Google sẽ báo lỗi origin — thêm trước khi test |
| Gmail quota 500 mail/ngày | 🟡 Thấp | Đủ giai đoạn đầu; khi lớn chuyển SMTP chuyên dụng (Resend, Mailgun) |
| SQL Server Express trên VPS ăn ~1.5GB RAM | 🟡 Thấp | CX22 4GB đủ; hoặc dùng Azure SQL free để nhẹ máy |
| CORS chặn domain thật nếu quên ALLOWED_ORIGINS | 🟡 Thấp | Chỉ cần khi tách FE/BE khác origin — hiện tại cùng origin nên không sao |
