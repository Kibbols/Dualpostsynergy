# DualPost — Setup Guide

> Upload vertical videos to **YouTube Shorts** and **TikTok** simultaneously, from a single page hosted on GitHub Pages.

---

## What You're Building

```
[ Your Browser ] ──uploads video──▶ [ YouTube API ]
       │                             [ TikTok API  ]
       │
       └──swap OAuth code──▶ [ Cloudflare Worker ] ──uses secret──▶ [ Google / TikTok ]
```

The app itself is just static files on GitHub Pages. The **Cloudflare Worker** is a tiny free server that handles the one part that needs a secret key — swapping a temporary OAuth code for a real access token. Your secrets never appear in your public code.

---

## Your Credentials (already filled in config.js)

| Field | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | `684633849089-qasr9779deg5mg2a00tb28pt1q9g1nus.apps.googleusercontent.com` |
| `REDIRECT_URI` | `https://kibbols.github.io/Dualpostsynergy` |
| `TIKTOK_CLIENT_KEY` | Fill in after TikTok app is approved |
| `WORKER_URL` | Fill in after Step 3 below |

---

## Step 1 — Push to GitHub Pages

1. Go to [github.com](https://github.com) and open your **Dualpostsynergy** repository
2. Upload all files from this zip into the repo root:
   - `index.html`
   - `style.css`
   - `app.js`
   - `config.js`
   - `privacy-policy.html`
   - `terms.html`
3. Go to **Settings → Pages → Source** → select `main` branch, `/ (root)` folder → **Save**
4. Your app will be live at: `https://kibbols.github.io/Dualpostsynergy`

> ✅ GitHub Pages is already configured in `config.js` — nothing to change there.

---

## Step 2 — Google Cloud (YouTube) — Already Partly Done

Your Google Client ID is already set. You just need to confirm two things in Google Cloud.

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Select your project → **APIs & Services → Credentials**
3. Click your OAuth 2.0 Client ID → check that **Authorized redirect URIs** includes exactly:
   ```
   https://kibbols.github.io/Dualpostsynergy
   ```
   (No trailing slash. Add it if it's missing, then Save.)
4. While you're here, copy your **Client Secret** — you'll need it in Step 3.
   - It's on the same credentials page, labelled "Client secret"
   - It looks like: `GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxx`
   - **Keep this private — never put it in your code or GitHub**

> If you haven't enabled the YouTube Data API yet: **APIs & Services → Library → search "YouTube Data API v3" → Enable**

---

## Step 3 — Cloudflare Worker (The Token Exchange Backend)

This is the part that makes real uploads work. It takes about 10 minutes.

### 3a. Create a Free Cloudflare Account

1. Go to [cloudflare.com](https://cloudflare.com) and sign up (free — no credit card needed)
2. Once logged in, click **Workers & Pages** in the left sidebar
3. Click **Create** → **Create Worker**
4. Name it `dualpost-exchange`
5. Click **Deploy** (don't worry about the default code for now)

### 3b. Add the Worker Code

1. After deploying, click **Edit Code**
2. Select everything in the editor (`Ctrl+A` / `Cmd+A`) and delete it
3. Paste in this entire block:

```javascript
export default {
  async fetch(request, env) {

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    const { code, platform, verifier } = body;
    if (!code || !platform) {
      return new Response('Missing code or platform', { status: 400 });
    }

    let tokenRes;

    if (platform === 'youtube') {
      tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id:     env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri:  env.REDIRECT_URI,
          grant_type:    'authorization_code',
          code_verifier: verifier,
        }),
      });

    } else if (platform === 'tiktok') {
      tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_key:    env.TIKTOK_CLIENT_KEY,
          client_secret: env.TIKTOK_CLIENT_SECRET,
          redirect_uri:  env.REDIRECT_URI,
          grant_type:    'authorization_code',
          code_verifier: verifier,
        }),
      });

    } else {
      return new Response('Unknown platform', { status: 400 });
    }

    const data = await tokenRes.json();

    if (!tokenRes.ok || !data.access_token) {
      return new Response(
        JSON.stringify({ error: data.error_description || data.error || 'Token exchange failed' }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN } }
      );
    }

    return new Response(
      JSON.stringify({ access_token: data.access_token }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
        }
      }
    );
  }
};
```

4. Click **Save and Deploy**

### 3c. Set Your Secret Environment Variables

This is where your private keys go — they're encrypted by Cloudflare and never visible to anyone.

1. In the Worker dashboard, click the **Settings** tab
2. Scroll to **Variables and Secrets**
3. Click **Add variable** for each of the following — use type **Secret** for all of them:

| Variable name | Value to paste |
|---|---|
| `GOOGLE_CLIENT_ID` | `684633849089-qasr9779deg5mg2a00tb28pt1q9g1nus.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Your Google client secret (from Step 2) |
| `TIKTOK_CLIENT_KEY` | Your TikTok client key (fill in when approved) |
| `TIKTOK_CLIENT_SECRET` | Your TikTok client secret (fill in when approved) |
| `REDIRECT_URI` | `https://kibbols.github.io/Dualpostsynergy` |
| `ALLOWED_ORIGIN` | `https://kibbols.github.io` |

4. Click **Save and Deploy** after adding all variables

### 3d. Copy Your Worker URL and Update config.js

1. At the top of the Worker dashboard you'll see a URL like:
   ```
   https://dualpost-exchange.YOUR-SUBDOMAIN.workers.dev
   ```
2. Copy that URL
3. Open `config.js` and replace `YOUR_WORKER_URL` with it:
   ```javascript
   WORKER_URL: 'https://dualpost-exchange.your-subdomain.workers.dev',
   ```
4. Save and push `config.js` to GitHub

> YouTube live uploading is now fully working. ✅

---

## Step 4 — TikTok (Waiting on API Approval)

TikTok requires a formal app review before the Content Posting API is granted.

### 4a. Create a TikTok Developer App

1. Go to [developers.tiktok.com](https://developers.tiktok.com)
2. Log in with your TikTok account → **Manage Apps → Create App**
   - Platform: **Web**
   - App name: DualPost (or your preferred name)
3. In your app settings, go to **Login Kit** → enable it
4. Under **Redirect domain** add: `kibbols.github.io`
5. Under **Products**, request access to **Content Posting API**

### 4b. App Review Submission

TikTok will ask for the following — here's where to find each one:

| TikTok asks for | Where to get it |
|---|---|
| **Privacy Policy URL** | `https://kibbols.github.io/Dualpostsynergy/privacy-policy.html` |
| **Terms of Service URL** | `https://kibbols.github.io/Dualpostsynergy/terms.html` |
| **Proof of concept video** | Screen record yourself using the app in Test Mode |
| **App description** | See suggested text below |

**Suggested app description for TikTok review:**
> DualPost is a personal web tool that allows a content creator to upload a single vertical video simultaneously to TikTok and YouTube Shorts. The user authenticates via TikTok OAuth, selects a video file from their device, enters a title and description, and the app posts the video directly to their TikTok account using the Content Posting API. No data is stored on any server. The tool is hosted as a static site on GitHub Pages.

### 4c. After Approval

Once TikTok approves your app:

1. Go to **Keys & Tokens** in your TikTok app dashboard
2. Copy your **Client Key** and **Client Secret**
3. Add the Client Key to `config.js`:
   ```javascript
   TIKTOK_CLIENT_KEY: 'your_tiktok_client_key_here',
   ```
4. Add the Client Secret to your Cloudflare Worker variables (Step 3c above)
5. Push the updated `config.js` to GitHub

> TikTok live uploading is now fully working. ✅

---

## Step 5 — Full Test Checklist

Once everything is set up, run through this before going live:

- [ ] App loads at `https://kibbols.github.io/Dualpostsynergy`
- [ ] Test Mode toggle works — simulated upload runs and shows success screen
- [ ] Switch to Live Mode — YouTube and TikTok buttons show "Connect" (not already connected)
- [ ] Click Connect YouTube → Google sign-in appears → authorize → button turns green
- [ ] Click Connect TikTok → TikTok sign-in appears → authorize → button turns green
- [ ] Drop a vertical video file → preview appears in phone frame
- [ ] Enter a title → click Publish Now
- [ ] Both progress bars fill → success screen appears with links
- [ ] Video appears in YouTube Studio and TikTok within a few minutes

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "redirect_uri_mismatch" from Google | URI mismatch | Check Google Cloud — must be exactly `https://kibbols.github.io/Dualpostsynergy` with no trailing slash |
| Stuck on "Connecting account..." | Worker URL wrong or not deployed | Double-check `WORKER_URL` in config.js matches your Cloudflare Worker URL exactly |
| CORS error in browser console | `ALLOWED_ORIGIN` wrong in Worker | Must be `https://kibbols.github.io` (no path, no trailing slash) |
| YouTube upload fails with 401 | Token expired | Disconnect and reconnect YouTube |
| YouTube upload fails with 403 | API not enabled or quota hit | Check YouTube Data API v3 is enabled in Google Cloud Console |
| TikTok button doesn't appear after auth | Content Posting API not approved yet | Wait for TikTok review or use Test Mode in the meantime |
| Upload appears to succeed but video missing | TikTok processing delay | Check TikTok Studio — videos can take a few minutes to appear |
| Progress bar fills but no success screen | JavaScript error | Open browser DevTools (F12) → Console tab for the specific error |

---

## Video Requirements

| Platform | Recommended format | Max file size | Length for Shorts/Shorts badge |
|---|---|---|---|
| YouTube Shorts | MP4, H.264, 1080×1920 | 256 GB | Under 60 seconds gets Shorts badge |
| TikTok | MP4, H.264, 1080×1920 | 4 GB | Up to 10 minutes |

**Best practice:** Export at **1080×1920 (9:16 vertical)**, MP4, H.264, under 60 seconds to qualify as a Short on both platforms.

---

## Security Notes

- Your `GOOGLE_CLIENT_SECRET` and `TIKTOK_CLIENT_SECRET` are stored only in Cloudflare's encrypted environment variables — never in your code or GitHub repo
- OAuth tokens are stored in browser `sessionStorage` only — they're cleared when the tab is closed
- No video data, tokens, or personal information is logged or stored anywhere by DualPost
- The Cloudflare Worker only accepts POST requests from `kibbols.github.io` (enforced by `ALLOWED_ORIGIN`)
