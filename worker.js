// ── VAPID signing helper ──────────────────────────────────────────
async function signVapid(privateKeyB64u, audience, subject) {
  const b64u = obj => btoa(JSON.stringify(obj)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  const header = { typ: "JWT", alg: "ES256" };
  const payload = { aud: audience, exp: Math.floor(Date.now() / 1000) + 43200, sub: subject };
  const signingInput = b64u(header) + "." + b64u(payload);
  const padded = privateKeyB64u.replace(/-/g,"+").replace(/_/g,"/");
  const keyBytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
  const privateKey = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(signingInput)
  );
  const sigB64u = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  return signingInput + "." + sigB64u;
}

// ── Web Push helpers (RFC 8291 / RFC 8188) ────────────────────────
function b64uDecode(str) {
  const padded = str.replace(/-/g,"+").replace(/_/g,"/") + "==".slice(0,(4-str.length%4)%4);
  const raw = atob(padded);
  return new Uint8Array([...raw].map(c=>c.charCodeAt(0)));
}
function concatBuffers(...arrays) {
  const total = arrays.reduce((s,a)=>s+a.byteLength,0);
  const out = new Uint8Array(total);
  let offset=0;
  for (const a of arrays){out.set(new Uint8Array(a.buffer||a),offset);offset+=a.byteLength;}
  return out;
}
async function hkdf(salt, ikm, info, len) {
  const saltKey = await crypto.subtle.importKey("raw",salt,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const prk = new Uint8Array(await crypto.subtle.sign("HMAC",saltKey,ikm));
  const prkKey = await crypto.subtle.importKey("raw",prk,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const infoBytes = typeof info==="string" ? new TextEncoder().encode(info) : info;
  const t = new Uint8Array(await crypto.subtle.sign("HMAC",prkKey,concatBuffers(infoBytes,new Uint8Array([1]))));
  return t.slice(0,len);
}

async function encryptWebPushPayload(subscription, payloadStr) {
  const enc = new TextEncoder();
  const receiverPublicKeyBytes = b64uDecode(subscription.keys.p256dh);
  const authSecret = b64uDecode(subscription.keys.auth);

  // Import receiver public key for ECDH
  const receiverPublicKey = await crypto.subtle.importKey(
    "raw", receiverPublicKeyBytes, {name:"ECDH",namedCurve:"P-256"}, false, []
  );

  // Generate sender (ephemeral) key pair
  const senderKP = await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
  const senderPublicKeyBytes = new Uint8Array(await crypto.subtle.exportKey("raw",senderKP.publicKey));

  // ECDH
  const ecdhBits = new Uint8Array(await crypto.subtle.deriveBits({name:"ECDH",public:receiverPublicKey},senderKP.privateKey,256));

  // Random 16-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // RFC 8291 §3.3 — derive IKM
  // keyinfo = "WebPush: info" + 0x00 + receiverPublicKey + senderPublicKey
  const keyInfo = concatBuffers(enc.encode("WebPush: info"), new Uint8Array([0]), receiverPublicKeyBytes, senderPublicKeyBytes);
  const ikm = await hkdf(authSecret, ecdhBits, keyInfo, 32);

  // RFC 8188 §2.1 — derive CEK and nonce
  // cek_info = "Content-Encoding: aes128gcm" + 0x00
  // nonce_info = "Content-Encoding: nonce" + 0x00
  const cekInfo = concatBuffers(enc.encode("Content-Encoding: aes128gcm"), new Uint8Array([0]));
  const nonceInfo = concatBuffers(enc.encode("Content-Encoding: nonce"), new Uint8Array([0]));
  const cek = await hkdf(salt, ikm, cekInfo, 16);
  const nonce = await hkdf(salt, ikm, nonceInfo, 12);

  // Encrypt: plaintext + 0x02 delimiter (end of record, no padding)
  const plaintext = enc.encode(payloadStr);
  const padded = concatBuffers(plaintext, new Uint8Array([2]));
  const cekKey = await crypto.subtle.importKey("raw",cek,{name:"AES-GCM"},false,["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv:nonce},cekKey,padded));

  // RFC 8188 header: salt(16) + record_size(4, big-endian) + key_id_len(1) + key_id(senderPublicKey, 65 bytes)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  const header = concatBuffers(salt, rs, new Uint8Array([senderPublicKeyBytes.length]), senderPublicKeyBytes);
  return concatBuffers(header, ciphertext);
}

async function sendWebPush(env, subscription, payload) {
  if (!subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) return 400;
  const endpoint = subscription.endpoint;
  const audience = new URL(endpoint).origin;
  const jwt = await signVapid(env.VAPID_PRIVATE_KEY, audience, "mailto:noreply@dualpost.app");
  const encrypted = await encryptWebPushPayload(subscription, JSON.stringify(payload));
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "TTL": "86400",
      "Authorization": "vapid t=" + jwt + ", k=" + env.VAPID_PUBLIC_KEY,
    },
    body: encrypted,
  });
  return res.status;
}

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

    // ── YouTube trending gaming data ─────────────────────────────────
    if (url.pathname === "/youtube-trending") {
      try {
        const query = body.query || "Dead by Daylight";
        // Search for recent DBD-specific videos sorted by view count
        const searchRes = await fetch(
          "https://www.googleapis.com/youtube/v3/search?part=snippet&q=" + encodeURIComponent(query) + "&type=video&videoCategoryId=20&order=viewCount&publishedAfter=" + new Date(Date.now() - 30*24*60*60*1000).toISOString() + "&maxResults=25&key=" + env.YOUTUBE_API_KEY,
          { headers: { "Accept": "application/json" } }
        );
        const searchData = await searchRes.json();
        if (searchData.error) throw new Error(searchData.error.message);

        const videoIds = (searchData.items || []).map(v => v.id.videoId).filter(Boolean).join(',');
        if (!videoIds) return new Response(JSON.stringify({ videos: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

        // Get full stats for those videos
        const statsRes = await fetch(
          "https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=" + videoIds + "&key=" + env.YOUTUBE_API_KEY,
          { headers: { "Accept": "application/json" } }
        );
        const statsData = await statsRes.json();
        if (statsData.error) throw new Error(statsData.error.message);

        const videos = (statsData.items || []).map(v => ({
          title: v.snippet.title,
          channel: v.snippet.channelTitle,
          tags: v.snippet.tags || [],
          views: parseInt(v.statistics.viewCount || 0),
          likes: parseInt(v.statistics.likeCount || 0),
          published: v.snippet.publishedAt,
        })).sort((a, b) => b.views - a.views);

        return new Response(JSON.stringify({ videos }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch(e) {
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

    // ── Twitch deep stream search (paginates server-side to find small streamers) ──
    if (url.pathname === "/twitch-streams-deep") {
      try {
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
        const gameId = body.game_id;
        const maxViewers = body.max_viewers || 50;
        const minViewers = body.min_viewers || 1;

        let results = [];
        let cursor = null;
        let pages = 0;

        while (pages < 25) {
          const endpoint = "https://api.twitch.tv/helix/streams?game_id=" + gameId + "&first=100&language=en" + (cursor ? "&after=" + cursor : "");
          const res = await fetch(endpoint, {
            headers: {
              "Authorization": "Bearer " + appToken,
              "Client-Id": env.TWITCH_CLIENT_ID,
            },
          });
          const data = await res.json();
          if (!data.data || !data.data.length) break;

          const streams = data.data;
          const pageMin = streams[streams.length - 1].viewer_count;

          // Collect streams in our target range (keep all fields including tags and language)
          for (const s of streams) {
            if (s.viewer_count >= minViewers && s.viewer_count <= maxViewers) {
              results.push(s);
            }
          }

          // Stop if we've collected enough or reached our target range
          if (results.length >= 50) break;

          // If the lowest viewer count on this page is still above our max, keep paginating
          if (pageMin > maxViewers && data.pagination && data.pagination.cursor) {
            cursor = data.pagination.cursor;
            pages++;
          } else {
            break;
          }
        }

        return new Response(JSON.stringify({ data: results }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }


    // ── YouTube Analytics OAuth token exchange ───────────────────────
    if (url.pathname === "/yta-auth") {
      try {
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.YT_ANALYTICS_CLIENT_ID,
            client_secret: env.YT_ANALYTICS_CLIENT_SECRET,
            code: body.code,
            grant_type: "authorization_code",
            redirect_uri: body.redirect_uri,
          }),
        });
        const data = await tokenRes.json();
        if (!data.access_token) throw new Error(data.error_description || "Token exchange failed");
        return new Response(JSON.stringify({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_in: data.expires_in,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── YouTube Analytics refresh token ──────────────────────────────
    if (url.pathname === "/yta-refresh") {
      try {
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.YT_ANALYTICS_CLIENT_ID,
            client_secret: env.YT_ANALYTICS_CLIENT_SECRET,
            grant_type: "refresh_token",
            refresh_token: body.refresh_token,
          }),
        });
        const data = await tokenRes.json();
        if (!data.access_token) throw new Error(data.error_description || "Refresh failed");
        return new Response(JSON.stringify({
          access_token: data.access_token,
          refresh_token: data.refresh_token || body.refresh_token,
          expires_in: data.expires_in,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── YouTube Analytics API proxy ───────────────────────────────────
    if (url.pathname === "/yta-query") {
      try {
        const { access_token, start_date, end_date, metrics, dimensions, filters } = body;
        let url_str = "https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE";
        url_str += "&startDate=" + start_date;
        url_str += "&endDate=" + end_date;
        url_str += "&metrics=" + (metrics || "views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,comments");
        if (dimensions) url_str += "&dimensions=" + dimensions;
        if (filters) url_str += "&filters=" + encodeURIComponent(filters);
        const ytRes = await fetch(url_str, {
          headers: { "Authorization": "Bearer " + access_token },
        });
        const data = await ytRes.json();
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── Push notification subscription storage ──────────────────────
    if (url.pathname === "/push-subscribe") {
      try {
        const { subscription } = body;
        if (!subscription || !subscription.endpoint) {
          return new Response(JSON.stringify({ error: "No subscription" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const key = "push_sub_" + btoa(subscription.endpoint).replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
        await env.PUSH_KV.put(key, JSON.stringify(subscription), { expirationTtl: 60 * 60 * 24 * 90 });
        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── Debug: manually trigger a push to test the pipeline ─────────
    if (url.pathname === "/push-test") {
      try {
        const subKeys = await env.PUSH_KV.list({ prefix: "push_sub_" });
        if (!subKeys.keys.length) return new Response(JSON.stringify({ error: "No subscriptions in KV" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const subRaw = await env.PUSH_KV.get(subKeys.keys[0].name);
        if (!subRaw) return new Response(JSON.stringify({ error: "Subscription key empty" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const sub = JSON.parse(subRaw);
        if (!sub.keys) return new Response(JSON.stringify({ error: "Subscription has no keys", sub }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const payload = { title: "Test notification", body: "If you see this, push is working!", url: "https://dualpost.app/streamer-hub/" };
        const status = await sendWebPush(env, sub, payload);
        return new Response(JSON.stringify({ ok: true, fcm_status: status }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message, stack: e.stack }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── Homework list sync (so cron can read it) ─────────────────────
    if (url.pathname === "/push-homework-sync") {
      try {
        const { list } = body;
        if (!Array.isArray(list)) return new Response(JSON.stringify({ error: "Invalid list" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        await env.PUSH_KV.put("homework_list", JSON.stringify(list));
        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
  },

  async scheduled(event, env, ctx) {
    try {
      const hwRaw = await env.PUSH_KV.get("homework_list");
      if (!hwRaw) return;
      const hwList = JSON.parse(hwRaw);
      if (!hwList.length) return;

      const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.TWITCH_CLIENT_ID, client_secret: env.TWITCH_CLIENT_SECRET,
          grant_type: "client_credentials",
        }),
      });
      const appToken = (await tokenRes.json()).access_token;

      const logins = hwList.map(s => s.login);
      const query = logins.map(l => "user_login=" + encodeURIComponent(l)).join("&");
      const streamsRes = await fetch("https://api.twitch.tv/helix/streams?" + query, {
        headers: { "Authorization": "Bearer " + appToken, "Client-Id": env.TWITCH_CLIENT_ID },
      });
      const liveStreamers = (await streamsRes.json()).data || [];
      if (!liveStreamers.length) return;

      const notifiedRaw = await env.PUSH_KV.get("push_notified") || "{}";
      const notified = JSON.parse(notifiedRaw);
      const now = Date.now();
      const toNotify = liveStreamers.filter(s => {
        const key = s.user_login.toLowerCase();
        return !notified[key] || (now - notified[key]) > 3600000;
      });
      if (!toNotify.length) return;

      const subKeys = await env.PUSH_KV.list({ prefix: "push_sub_" });
      if (!subKeys.keys.length) return;

      for (const streamer of toNotify) {
        const payload = {
          title: streamer.user_name + " is live!",
          body: (streamer.game_name ? "Playing " + streamer.game_name + " \u00b7 " : "") + streamer.viewer_count + " viewers",
          url: "https://twitch.tv/" + streamer.user_login,
        };
        for (const keyObj of subKeys.keys) {
          const subRaw = await env.PUSH_KV.get(keyObj.name);
          if (!subRaw) continue;
          try { await sendWebPush(env, JSON.parse(subRaw), payload); } catch(e) {}
        }
        notified[streamer.user_login.toLowerCase()] = now;
      }
      await env.PUSH_KV.put("push_notified", JSON.stringify(notified), { expirationTtl: 604800 });
    } catch(e) { console.error("Scheduled push failed:", e); }
  }

};