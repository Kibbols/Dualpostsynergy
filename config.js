// ─────────────────────────────────────────────────────────────
//  DualPost — Configuration
//  Fill in your credentials below. See SETUP.md for instructions.
// ─────────────────────────────────────────────────────────────

const CONFIG = {

  // ── YouTube / Google ──────────────────────────────────────
  // From: https://console.cloud.google.com → APIs & Services → Credentials
  GOOGLE_CLIENT_ID: '684633849089-qasr9779deg5mg2a00tb28pt1q9g1nus.apps.googleusercontent.com',

  // Your GitHub Pages URL (no trailing slash)
  // e.g. 'https://yourusername.github.io/your-repo-name'
  REDIRECT_URI: 'https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPO_NAME',

  // ── TikTok ───────────────────────────────────────────────
  // From: https://developers.tiktok.com → My Apps → your app → Keys & Tokens
  TIKTOK_CLIENT_KEY: 'YOUR_TIKTOK_CLIENT_KEY',

  // ─────────────────────────────────────────────────────────
  // DO NOT put client secrets here — this is a public frontend.
  // All OAuth flows use PKCE (no secret required).
  // ─────────────────────────────────────────────────────────
};
