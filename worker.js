export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "https://dualpost.app",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

    // Allow requests from dualpost.app (covers all subpaths including streamer-hub)
    const reqOrigin = request.headers.get("origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || "https://dualpost.app";
    if (reqOrigin && reqOrigin !== allowedOrigin) {
      return new Response("Host not in allowlist", { status: 403, headers: corsHeaders });
    }

    let body;
    try { body = await request.json(); } catch (e) { return new Response("Invalid JSON", { status: 400, headers: corsHeaders }); }

    const url = new URL(request.url);

    // ── Proxy route ───────────────────────────────────────────────
    if (url.pathname === "/proxy") {
      try {
        const apiRes = await fetch(body.url, {
          method: body.method || "GET",
          headers: {
            "Authorization": "Bearer " + body.token,
            "Content-Type": "application/json; charset=UTF-8",
          },
          body: body.method === "POST" ? "{}" : undefined,
        });
        const data = await apiRes.json();
        return new Response(JSON.stringify(data), {
          status: apiRes.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── TikTok upload init route ─────────────────────────────────
    if (url.pathname === "/tt-init") {
      try {
        const ttEndpoint = body.draft
          ? "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/"
          : "https://open.tiktokapis.com/v2/post/publish/video/init/";
        // Draft mode only takes source_info, not post_info
        const ttBody = body.draft
          ? { source_info: body.source_info }
          : { post_info: body.post_info, source_info: body.source_info };

        const ttRes = await fetch(ttEndpoint, {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + body.token,
            "Content-Type": "application/json; charset=UTF-8",
          },
          body: JSON.stringify(ttBody),
        });
        const ttData = await ttRes.json();
        if (!ttRes.ok) {
          return new Response(JSON.stringify({ error: ttData?.error?.message || "TikTok init failed", status: ttRes.status }), {
            status: ttRes.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({
          publish_id: ttData.data?.publish_id,
          upload_url: ttData.data?.upload_url,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── TikTok publish status check ──────────────────────────────
    if (url.pathname === "/tt-status") {
      try {
        const statusRes = await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + body.token,
            "Content-Type": "application/json; charset=UTF-8",
          },
          body: JSON.stringify({ publish_id: body.publish_id }),
        });
        // Log raw response for debugging
        const rawText = await statusRes.text();
        const data = JSON.parse(rawText);
        return new Response(JSON.stringify(data), {
          status: statusRes.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── TikTok token refresh route ───────────────────────────────
    if (url.pathname === "/tt-refresh") {
      try {
        const refreshRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_key: env.TIKTOK_CLIENT_KEY,
            client_secret: env.TIKTOK_CLIENT_SECRET,
            grant_type: "refresh_token",
            refresh_token: body.refresh_token,
          }),
        });
        const data = await refreshRes.json();
        if (!data.access_token) {
          return new Response(JSON.stringify({ error: "TT refresh failed", details: data }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_in: data.expires_in,
          open_id: data.open_id,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── YouTube token refresh route ───────────────────────────────
    if (url.pathname === "/yt-refresh") {
      try {
        const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            refresh_token: body.refresh_token,
            grant_type: "refresh_token",
          }),
        });
        const data = await refreshRes.json();
        if (!data.access_token) {
          return new Response(JSON.stringify({ error: "Refresh failed", details: data }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ access_token: data.access_token, expires_in: data.expires_in }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── Reddit proxy (for Streamer Hub) ─────────────────────────────
    if (url.pathname === "/reddit") {
      try {
        const sub    = body.sub || "deadbydaylight";
        const sort   = body.sort || "hot";
        const redditRes = await fetch(
          `https://old.reddit.com/r/${sub}/${sort}.json?limit=25&t=day&raw_json=1`,
          { headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
          }}
        );
        const rawText = await redditRes.text();
        if (rawText.trim().startsWith('<')) {
          return new Response(JSON.stringify({ error: "Reddit returned an HTML block page — try again in a moment." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const data = JSON.parse(rawText);
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── Reddit individual post proxy ────────────────────────────────
    if (url.pathname === "/reddit-post") {
      try {
        const postUrl = body.url || "";
        if (!postUrl.includes("reddit.com")) throw new Error("Invalid URL");
        const redditRes = await fetch(postUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
          }
        });
        const rawText = await redditRes.text();
        if (rawText.trim().startsWith('<')) {
          return new Response(JSON.stringify({ error: "Reddit blocked the request" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(rawText, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }


    // ── Twitch OAuth token exchange ──────────────────────────────────
    if (url.pathname === "/twitch-auth") {
      try {
        const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.TWITCH_CLIENT_ID,
            client_secret: env.TWITCH_CLIENT_SECRET,
            code: body.code,
            grant_type: "authorization_code",
            redirect_uri: body.redirect_uri,
          }),
        });
        const data = await tokenRes.json();
        if (!data.access_token) throw new Error(data.message || "Token exchange failed");
        return new Response(JSON.stringify({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_in: data.expires_in,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── Twitch refresh token ─────────────────────────────────────────
    if (url.pathname === "/twitch-refresh") {
      try {
        const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.TWITCH_CLIENT_ID,
            client_secret: env.TWITCH_CLIENT_SECRET,
            grant_type: "refresh_token",
            refresh_token: body.refresh_token,
          }),
        });
        const data = await tokenRes.json();
        if (!data.access_token) throw new Error(data.message || "Refresh failed");
        return new Response(JSON.stringify({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_in: data.expires_in,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── Twitch API proxy (user data, streams, categories) ────────────
    if (url.pathname === "/twitch-api") {
      try {
        const endpoint = body.endpoint;
        const accessToken = body.access_token;
        const twitchRes = await fetch("https://api.twitch.tv/helix/" + endpoint, {
          headers: {
            "Authorization": "Bearer " + accessToken,
            "Client-Id": env.TWITCH_CLIENT_ID,
          },
        });
        const data = await twitchRes.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── Twitch app token (for public data like categories/streams) ───
    if (url.pathname === "/twitch-public") {
      try {
        // Get app access token
        const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.TWITCH_CLIENT_ID,
            client_secret: env.TWITCH_CLIENT_SECRET,
            grant_type: "client_credentials",
          }),
        });
        const tokenData = await tokenRes.json();
        const appToken = tokenData.access_token;

        // Make the actual API call
        const twitchRes = await fetch("https://api.twitch.tv/helix/" + body.endpoint, {
          headers: {
            "Authorization": "Bearer " + appToken,
            "Client-Id": env.TWITCH_CLIENT_ID,
          },
        });
        const data = await twitchRes.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── Streamer Hub password verification ──────────────────────────
    if (url.pathname === "/verify-password") {
      const provided = body.password || "";
      const stored   = env.STREAMER_HUB_PASSWORD || "";
      const valid =
        provided.length > 0 &&
        provided.length === stored.length &&
        provided.split("").every((c, i) => c === stored[i]);
      return new Response(JSON.stringify({ ok: valid }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Token exchange route ───────────────────────────────────────
    const code = body.code;
    const platform = body.platform;
    const verifier = body.verifier;

    try {
      let tokenRes;
      if (platform === "youtube") {
        tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: body.redirect_uri || env.REDIRECT_URI, grant_type: "authorization_code", code_verifier: verifier }),
        });
      } else if (platform === "tiktok") {
        tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ code, client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, redirect_uri: body.redirect_uri || env.REDIRECT_URI, grant_type: "authorization_code", code_verifier: verifier }),
        });
      } else {
        return new Response("Unknown platform", { status: 400, headers: corsHeaders });
      }
      const data = await tokenRes.json();
      if (!data.access_token) return new Response(JSON.stringify({ error: data.error, error_description: data.error_description, full: data }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in, open_id: data.open_id }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }
};
