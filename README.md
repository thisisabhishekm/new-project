# MONO — Minimalist Black & White Social + Group Bill Splitting

A clean, Apple Human Interface Guidelines–inspired monochrome social media application packaged for Android (Google Play Store).

## Core Features
- **No Reels, Ever** — Pure still photography, chronological feed, zero algorithmic short-video noise.
- **Private Follower & Following Lists** — Strictly hidden server-side (`403 Forbidden` on list probes, zero public counts).
- **Exclusive Founder Blue Tick** — The single colored pixel in the entire B&W UI, derived strictly from server config (`FOUNDER_USERNAME`).
- **Stories (24h)** — Ephemeral photo/monochrome text stories with author-only viewer tracking.
- **Tags, Locations & Presence** — `#hashtags`, `@people` photo pins, location labels, and reciprocal Active / Last Seen status.
- **30-Day Auto-Erasing Messages** — Every direct & group message is permanently hard-deleted from the database after 30 days.
- **Group Bill Splitting** — Equal, exact, and percentage cent-accurate bill splits inside groups with automatic minimum-transfer debt simplification and one-tap settlement.
- **Play Store Hardened** — API 35 target, HTTPS-only `network_security_config`, `allowBackup="false"`, R8 minification, in-app Block/Report & Account Deletion.

## Quick Start (Local Development)

```bash
# Terminal 1: Start API server (http://localhost:4000)
npm run dev:server

# Terminal 2: Start monochrome web/mobile client (http://localhost:5173)
npm run dev:client
```

Demo accounts (seeded automatically on first run):
- Founder (exclusive Blue Tick): `@abhishek` / `MonoDemo!2026`
- Friend: `@maya` / `MonoDemo!2026`

## Verification & Quality Control

```bash
npm run typecheck      # Strict TypeScript check (server + client)
npm run test:server    # 12 automated security, breach & functional QA tests
npm run audit:deps     # Zero-vulnerability dependency audit
npm run android:bundle # Build Play Store Android App Bundle (.aab)
```

## Documentation
- [Security Audit & Breach Report](docs/SECURITY_AUDIT.md)
- [Google Play Store Release Guide](docs/PLAY_STORE_RELEASE_GUIDE.md)
- [Privacy Policy](docs/PRIVACY_POLICY.md)
