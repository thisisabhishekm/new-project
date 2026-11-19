# Google Play Store Release Guide — MONO

Because publishing to Google Play requires your personal Google Play Console developer account, identity verification, private signing keystore, and hosted HTTPS backend URL, follow these steps to lock in and publish MONO cleanly.

## Step 1: Host the Backend Over HTTPS

1. Deploy `server/` to a host with automatic HTTPS (e.g., Railway, Render, Fly.io, or Google Cloud Run).
2. Configure environment variables (see `server/.env.example`):
   - `NODE_ENV=production`
   - `JWT_SECRET=<64-char random hex string from openssl rand -hex 32>`
   - `FOUNDER_USERNAME=abhishek` (or your chosen exclusive blue-tick handle)
   - `CORS_ORIGINS=https://localhost,capacitor://localhost,https://your-web-domain.com`
3. Verify `https://api.your-domain.com/api/health` returns `{"status":"ok", ...}`.

## Step 2: Point the Android App to Your Production API

1. Create `client/.env.production`:
   ```env
   VITE_API_BASE_URL=https://api.your-domain.com
   ```
2. Build and sync web assets into the Android project:
   ```bash
   npm run android:sync
   ```

## Step 3: Create Your Private Upload Keystore (Keep Offline & Safe!)

Run once locally (never commit `.jks` or `keystore.properties` to Git):

```bash
keytool -genkey -v \
  -keystore client/android/mono-upload-key.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias mono-upload
```

Copy `client/android/keystore.properties.example` to `client/android/keystore.properties` and fill in your passwords.

## Step 4: Build the Signed Play Store App Bundle (`.aab`)

```bash
export JAVA_HOME=/path/to/jdk-21
npm run android:bundle
```

Your signed release bundle will be generated at:
`client/android/app/build/outputs/bundle/release/app-release.aab`

## Step 5: Complete Google Play Console Requirements

1. **Developer Account**: Register at [play.google.com/console](https://play.google.com/console) ($25 one-time fee) and complete identity verification.
2. **Create App**: Name `MONO`, package `com.mono.social`, category `Social`, Free.
3. **Store Listing Assets**:
   - App Icon: `512 × 512 px` monochrome PNG
   - Feature Graphic: `1024 × 500 px` monochrome PNG
   - Phone Screenshots: 2–8 clean light & dark mode screenshots
4. **Privacy Policy & Account Deletion**:
   - Host `docs/PRIVACY_POLICY.md` at a public HTTPS URL and paste it in **App content → Privacy policy**.
   - Confirm in-app account deletion is available under **Profile → Settings → Delete Account Permanently**.
5. **Data Safety Form**:
   - Declare: Account Info (username, email), User Content (photos, captions, 24h stories, 30-day ephemeral messages, group bill records).
   - Data encrypted in transit (HTTPS/TLS): **Yes**.
   - Users can request data deletion: **Yes** (instant in-app deletion).
   - Data shared with third parties / advertisers: **No**.
6. **UGC Content Rating & Moderation**:
   - Complete the IARC questionnaire (confirm user-generated content with in-app Block & Report controls).
7. **Closed Testing (Google Play Requirement for Personal Accounts)**:
   - Upload `app-release.aab` to the **Closed testing** track, invite at least 12 testers opted in for 14 continuous days, then apply for **Production** access and roll out!
