# MONO — Security Audit, Breach Testing & Quality Control Report

This report documents the security controls, threat-model mitigations, and automated verification executed prior to Google Play Store packaging.

## 1. Product-Specific Privacy & Integrity Guarantees

| Requirement | Enforcement Layer | Verification |
|---|---|---|
| **No Reels** | Zero Reels UI tabs, zero video upload support (magic-byte whitelist accepts only static/animated images), `/api/reels/*` returns `404`. | Automated test #2 |
| **Private Follower & Following Lists** | `GET /api/users/:username/followers` and `/following` return `403`. No user payload ever includes follower/following arrays or counts. | Automated test #4 |
| **Exclusive Founder Blue Tick** | Not stored as an editable DB column; derived strictly server-side from `user.username === config.founderUsername`. Mass-assignment stripped via Zod schemas. | Automated test #3 |
| **30-Day Message Auto-Erasure** | Every direct and group message sets `expires_at = created_at + 30 days`. Queries always filter `expires_at > now`, and `purgeExpiredData()` hard-deletes rows from SQLite on reads, startup, and periodic interval. | Automated test #7 |
| **24-Hour Stories & Author-Only Viewers** | Stories expire and are hard-deleted at 24h. Viewer lists are returned strictly when `story.author_id === viewer.id`. | Automated test #8 |
| **Reciprocal Activity / Last Seen** | Activity status is only visible when both viewer and target have `showActivityStatus` enabled. | Automated test #6 |
| **Cent-Accurate Group Bill Splitting** | All amounts stored as integer minor currency units (`total_cents`, `owed_cents`) with remainder distribution and greedy debt simplification. Zero floating-point drift. | Automated test #10 |

## 2. OWASP Mobile & API Breach Checks

- **Authentication & Passwords**:
  - Salted `crypto.scrypt` (`N=16384, r=8, p=1`, 16-byte random salt) with `crypto.timingSafeEqual`.
  - HS256 JWTs with strict header check (`alg === "HS256"`), rejecting `alg: "none"` and signature tampering.
  - Server-side JWT revocation table (`revoked_tokens`) checked on every authenticated request; immediate invalidation on logout and account deletion.
  - Production fail-fast guard enforces `JWT_SECRET >= 32 chars`.
- **Broken Object Level Authorization (IDOR)**:
  - Strict membership checks on every conversation, message, and bill endpoint (`403 Forbidden` for non-members).
  - Bill split participants and payers validated against the group's active membership list.
  - Post, story, comment, and bill deletion restricted strictly to owners/group admins.
- **Injection & File Upload Security**:
  - 100% parameterized SQLite prepared statements (`node:sqlite`) — tested against SQLi payloads.
  - Image uploads capped at 5 MB and validated by raw **magic bytes** (JPEG/PNG/WebP/GIF only). Spoofed `.jpg` scripts and `.svg` XSS payloads are rejected with `400`.
  - Randomized UUID filenames served with `X-Content-Type-Options: nosniff`.
- **HTTP & Transport Hardening**:
  - `helmet` enforces strict CSP (`object-src 'none'`, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and hides `X-Powered-By`.
  - Explicit CORS allowlist and `express-rate-limit` on auth, uploads, and API routes.
- **Android Play Store Hardening (`client/android/`)**:
  - `targetSdkVersion = 35`, `compileSdkVersion = 35` (meets Google Play 2025/2026 API 35 policy).
  - `android:allowBackup="false"` and `android:fullBackupContent="false"` (prevents ADB backup token extraction).
  - `android:usesCleartextTraffic="false"` + `network_security_config.xml` (HTTPS-only in production).
  - R8/ProGuard code minification & resource shrinking enabled on `release` builds.
  - Release signing credentials loaded strictly from gitignored `keystore.properties` (zero hardcoded secrets).
- **Google Play UGC & Privacy Compliance**:
  - In-app **Block User** and **Report Content** endpoints + UI controls implemented.
  - In-app **Permanent Account Deletion** (password-confirmed) implemented.
- **Dependency Vulnerability Scan**:
  - `zod` upgraded to v4.6.7+ and `vitest` to v5.1.1+ to patch reported advisories.
  - `npm audit` returns **0 vulnerabilities** on both `server/` and `client/`.

## 3. Production Hardening Checklist Before Public Launch

1. Deploy `server/` behind HTTPS (TLS 1.3) on a managed host (Railway, Render, Fly.io, or Cloud Run) with a strong `JWT_SECRET` (`openssl rand -hex 32`).
2. Move SQLite to PostgreSQL (or Litestream-backed SQLite volume) and store uploaded photos in private object storage (S3/R2/GCS) once traffic scales beyond early beta.
3. Add a scheduled daily backup & verify 30-day message purge excludes erased messages from backups/logs.
4. Add email verification / password reset via a transactional email provider (Resend/Postmark) before opening public signups.
5. Configure centralized error monitoring (Sentry with PII scrubbing) and rate-limiting at the edge CDN/WAF (Cloudflare).
