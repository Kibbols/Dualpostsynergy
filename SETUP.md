# DualPost — Setup Guide

> Upload vertical videos to **YouTube Shorts** and **TikTok** simultaneously, from a single page hosted on GitHub Pages.

---

## Overview

This is a **static web app** — no server required for the UI. However, both YouTube and TikTok require a small **token-exchange backend** to securely swap OAuth authorization codes for access tokens (because client secrets must never be in public frontend code).

You'll set up:
1. The GitHub Pages site (the app itself)
2. A Google Cloud project (YouTube API access)
3. A TikTok Developer app (TikTok API access)
4. A free Cloudflare Worker (token exchange backend — ~15 lines of code)

---

## Step 1 — Host on GitHub Pages

1. Create a new GitHub repository (e.g. `dualpost`)
2. Upload all files from this folder into the repo root:
   - `index.html`
   - `style.css`
   - `app.js`
   - `config.js`
3. Go to **Settings → Pages → Source** → select `main` branch, `/ (root)` folder → Save
4. Your app will be live at:
   ```
   https://YOUR_USERNAME.github.io/dualpost
   ```
5. Open `config.js` and set `REDIRECT_URI` to that URL.

---

## Step 2 — YouTube / Google Cloud Setup

### 2a. Create a Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click **New Project** → name it (e.g. "DualPost") → Create
3. In the left menu: **APIs & Services → Library**
4. Search for **"YouTube Data API v3"** → Enable it

### 2b. Create OAuth Credentials

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. If prompted, configure the **OAuth Consent Screen** first:
   - User type: **External**
   - App name: DualPost (or your name)
   - Add your email as a test user
   - Scopes: add `https://www.googleapis.com/auth/youtube.upload`
3. Back in Create Credentials:
   - Application type: **Web application**
   - Authorized redirect URIs: add your GitHub Pages URL exactly:
     ```
     https://YOUR_USERNAME.github.io/dualpost
     ```
4. Click Create → copy the **Client ID** (looks like `123456789.apps.googleusercontent.com`)
5. Paste it into `config.js` as `GOOGLE_CLIENT_ID`
6. Keep the **Client Secret** — you'll need it for the Cloudflare Worker

---

## Step 3 — TikTok Developer Setup

### 3a. Create a TikTok Developer Account

1. Go to [developers.tiktok.com](https://developers.tiktok.com)
2. Log in with your TikTok account → click **Manage Apps**
3. Click **Create App** → fill in the details:
   - Platform: **Web**
   - App name: DualPost

### 3b. Configure the App

1. In your app dashboard, go to **Login Kit** → enable it
2. Under **Redirect domain** add: `YOUR_USERNAME.github.io`
3. Under **Products**, add **Content Posting API**
   - Note: This requires TikTok approval (usually 1-5 business days for the review)
4. Go to **Keys & Tokens** → copy your **Client Key** and **Client Secret**
5. Paste `Client Key` into `config.js` as `TIKTOK_CLIENT_KEY`

---

## Step 4 — Cloudflare Worker (Token Exchange Backend)

Both platforms require a server-side token exchange. You'll use a **free Cloudflare Worker** for this.

### 4a. Create a Cloudflare Account

1. Sign up free at [cloudflare.com](https://cloudflare.com)
2. Go to **Workers & Pages → Create Worker**
3. Name it `dualpost-exchange` → Deploy

### 4b. Paste This Worker Code

Click **Edit Code** and replace everything with:

```javascript
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    const { code, platform, verifier } = await request.json();
    let tokenRes, data;

    if (platform === 'youtube') {
      tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: env.REDIRECT_URI,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        })
      });
    } else if (platform === 'tiktok') {
      tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_key: env.TIKTOK_CLIENT_KEY,
          client_secret: env.TIKTOK_CLIENT_SECRET,
          redirect_uri: env.REDIRECT_URI,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        })
      });
    } else {
      return new Response('Unknown platform', { status: 400 });
    }

    data = await tokenRes.json();

    return new Response(JSON.stringify({ access_token: data.access_token }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
      }
    });
  }
};
```

### 4c. Set Environment Variables

In the Worker dashboard → **Settings → Variables** → add:

| Variable | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | Your Google client ID |
| `GOOGLE_CLIENT_SECRET` | Your Google client secret |
| `TIKTOK_CLIENT_KEY` | Your TikTok client key |
| `TIKTOK_CLIENT_SECRET` | Your TikTok client secret |
| `REDIRECT_URI` | `https://YOUR_USERNAME.github.io/dualpost` |
| `ALLOWED_ORIGIN` | `https://YOUR_USERNAME.github.io` |

### 4d. Connect the Worker to the App

In `app.js`, find the two commented-out sections in `exchangeYouTubeCode()` and `exchangeTikTokCode()`. Uncomment them and replace `YOUR_WORKER.workers.dev` with your actual Worker URL (found in the Worker dashboard, e.g. `dualpost-exchange.yourname.workers.dev`).

Then delete or comment out the demo mode lines below each section.

---

## Step 5 — Test It

1. Visit your GitHub Pages URL
2. Click **Connect YouTube** → sign in with Google → authorize
3. Click **Connect TikTok** → sign in → authorize
4. Both buttons should turn green ✓
5. Drop a vertical video (MP4, under 256MB)
6. Enter a title → click **Publish Now**

---

## Troubleshooting

| Issue | Fix |
|---|---|
| "redirect_uri_mismatch" from Google | Make sure the URI in Google Cloud matches exactly (no trailing slash) |
| TikTok auth page shows error | Content Posting API may not be approved yet; check your app status |
| CORS error on token exchange | Check `ALLOWED_ORIGIN` in Worker matches your GitHub Pages domain |
| Upload fails with 401 | Token may have expired; disconnect and reconnect the platform |

---

## Video Requirements

| Platform | Max Size | Format | Max Length |
|---|---|---|---|
| YouTube Shorts | 256 GB (API) | MP4, MOV, WebM | 60 seconds for Shorts badge |
| TikTok | 4 GB | MP4, MOV | 10 minutes |

For best results: **1080×1920 (9:16 vertical)**, MP4, H.264.

---

## Privacy & Security

- No video data is stored anywhere except the platforms you upload to.
- OAuth tokens are stored in `sessionStorage` (cleared when you close the tab).
- Your client secrets **never** appear in the frontend code — they stay in Cloudflare's encrypted environment variables.
