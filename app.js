// ─────────────────────────────────────────────────────────────
//  DualPost — App Logic
//  Handles: Mode toggle, OAuth, file selection, uploading
// ─────────────────────────────────────────────────────────────

// ── State ─────────────────────────────────────────────────────
const state = {
  file: null,
  ytToken: null,
  ttToken: null,
  uploading: false,
  testMode: false,  // default to live mode
};

// ── Force drawer closed on load ───────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const drawer = document.getElementById('debugDrawer');
  const tab    = document.getElementById('debugDrawerTab');
  if (drawer) { drawer.style.transition = 'none'; drawer.style.bottom = '-175px'; }
  if (tab)    { tab.style.display = 'flex'; }
  setTimeout(() => { if (drawer) drawer.style.transition = 'bottom 0.35s ease-out'; }, 50);
});

// ── Sidebar ───────────────────────────────────────────────────
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('open');
  document.getElementById('hamburger').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
  document.getElementById('hamburger').classList.remove('open');
  document.body.style.overflow = '';
}

// Close sidebar on Escape key
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSidebar(); });

// ── Debug Drawer ──────────────────────────────────────────────
function openDebugDrawer() {
  const drawer = document.getElementById('debugDrawer');
  const tab    = document.getElementById('debugDrawerTab');
  if (!drawer) return;
  drawer.style.bottom = '0px';
  if (tab) tab.style.display = 'none';
}

function closeDebugDrawer() {
  const drawer = document.getElementById('debugDrawer');
  const tab    = document.getElementById('debugDrawerTab');
  if (!drawer) return;
  drawer.style.bottom = '-175px';
  if (tab) tab.style.display = 'flex';
}

function dbg(msg) {
  console.log('[DualPost]', msg);
  const panel = document.getElementById('debugPanel');
  if (!panel) return;
  const line = document.createElement('div');
  line.textContent = new Date().toLocaleTimeString() + ' — ' + msg;
  panel.appendChild(line);
  panel.scrollTop = panel.scrollHeight;
}

// ── On Load ───────────────────────────────────────────────────
window.addEventListener('load', () => {
  const savedMode = localStorage.getItem('dp_mode');
  dbg('Saved mode: ' + (savedMode || 'none'));
  // Default to live mode unless explicitly saved as test
  if (savedMode === 'test') {
    state.testMode = true;
    document.getElementById('modeToggle').checked = false;
  } else {
    state.testMode = false;
    document.getElementById('modeToggle').checked = true;
    document.body.classList.add('live-mode');
  }
  applyModeUI();

  const urlParams = new URLSearchParams(window.location.search);
  const code      = urlParams.get('code');
  const pending   = localStorage.getItem('oauth_pending');
  dbg('Loaded. code=' + (code ? code.slice(0,12) + '...' : 'NONE') + ' | pending=' + (pending || 'NONE'));

  handleOAuthCallback();
  restoreTokens();
  updateAuthUI();
  initDropZone();
  // Set initial platform column states
  initPlatformStates();
  // Delay to ensure DOM is fully painted before fetching account info
  setTimeout(() => {
    dbg('Fetching creator info. ytToken=' + (state.ytToken?'YES':'NO') + ' ttToken=' + (state.ttToken?'YES':'NO') + ' testMode=' + state.testMode);
    if (state.ytToken || state.testMode) fetchYouTubeChannelInfo();
    if (state.ttToken) fetchTikTokCreatorInfo();
  }, 500);
});


// ── Mode Toggle ───────────────────────────────────────────────
function handleModeChange() {
  const toggle = document.getElementById('modeToggle');
  state.testMode = !toggle.checked;
  localStorage.setItem('dp_mode', state.testMode ? 'test' : 'live');

  if (state.testMode) {
    document.body.classList.remove('live-mode');
  } else {
    document.body.classList.add('live-mode');
  }

  applyModeUI();
  updateAuthUI();
}

function applyModeUI() {
  const uploadBtn = document.getElementById('uploadBtn');
  const pill      = document.getElementById('headerModePill');
  const sbIcon    = document.getElementById('sbModeIcon');
  const sbTitle   = document.getElementById('sbModeTitle');
  const sbSub     = document.getElementById('sbModeSub');

  if (state.testMode) {
    uploadBtn.querySelector('.btn-text').textContent = 'Simulate Upload';
    // mode pill hidden — if (pill) { pill.textContent = '🧪 Test'; }
    if (sbIcon)  sbIcon.textContent  = '🧪';
    if (sbTitle) sbTitle.textContent = 'Test Mode';
    if (sbSub)   sbSub.textContent   = 'Simulated uploads';
    document.body.classList.remove('live-mode');
  } else {
    uploadBtn.querySelector('.btn-text').textContent = 'Publish Now';
    // mode pill hidden — if (pill) { pill.textContent = '🚀 Live'; }
    if (sbIcon)  sbIcon.textContent  = '🚀';
    if (sbTitle) sbTitle.textContent = 'Live Mode';
    if (sbSub)   sbSub.textContent   = 'Real uploads';
    document.body.classList.add('live-mode');
  }
}

function switchToLive() {
  document.getElementById('modeToggle').checked = true;
  state.testMode = false;
  localStorage.setItem('dp_mode', 'live');
  document.body.classList.add('live-mode');
  applyModeUI();
  updateAuthUI();
}

function switchToTest() {
  document.getElementById('modeToggle').checked = false;
  state.testMode = true;
  localStorage.setItem('dp_mode', 'test');
  document.body.classList.remove('live-mode');
  applyModeUI();
  updateAuthUI();
}

// ── Token Storage ─────────────────────────────────────────────
function saveTokens() {
  if (state.ytToken) localStorage.setItem('dp_yt', JSON.stringify(state.ytToken));
  if (state.ttToken) localStorage.setItem('dp_tt', JSON.stringify(state.ttToken));
}

function restoreTokens() {
  try {
    const yt = localStorage.getItem('dp_yt');
    const tt = localStorage.getItem('dp_tt');
    if (yt) state.ytToken = JSON.parse(yt);
    if (tt) state.ttToken = JSON.parse(tt);
  } catch(e) {}
}

function clearToken(platform) {
  if (platform === 'yt') { state.ytToken = null; localStorage.removeItem('dp_yt'); }
  if (platform === 'tt') { state.ttToken = null; localStorage.removeItem('dp_tt'); }
}

// ── Auth UI ───────────────────────────────────────────────────
function updateAuthUI() {
  const ytBtn        = document.getElementById('ytAuthBtn');
  const ttBtn        = document.getElementById('ttAuthBtn');
  const ytDot        = document.getElementById('ytDot');
  const ttDot        = document.getElementById('ttDot');
  const ytStatus     = document.getElementById('ytAuthStatus');
  const ttStatus     = document.getElementById('ttAuthStatus');
  const ytCardDot    = document.getElementById('ytCardDot');
  const ttCardDot    = document.getElementById('ttCardDot');
  const headerYtPill = document.getElementById('headerYtPill');
  const headerTtPill = document.getElementById('headerTtPill');

  const ytConnected = state.testMode || !!state.ytToken;
  const ttConnected = state.testMode || !!state.ttToken;

  // ── YouTube sidebar button ──
  if (ytConnected) {
    ytBtn.classList.add('connected');
    if (ytDot)     ytDot.classList.add('connected');
    if (ytCardDot) ytCardDot.classList.add('connected');
    if (ytStatus)  ytStatus.textContent = state.testMode ? 'Demo connected' : 'Connected ✓';
    if (headerYtPill) { headerYtPill.textContent = '▶ YT'; headerYtPill.style.display = ''; }
    ytBtn.onclick = state.testMode ? null : () => {
      clearToken('yt'); updateAuthUI(); toast('YouTube disconnected');
    };
  } else {
    ytBtn.classList.remove('connected');
    if (ytDot)     ytDot.classList.remove('connected');
    if (ytCardDot) ytCardDot.classList.remove('connected');
    if (ytStatus)  ytStatus.textContent = 'Tap to connect';
    if (headerYtPill) headerYtPill.style.display = 'none';
    ytBtn.onclick = authYouTube;
  }

  // ── TikTok sidebar button ──
  if (ttConnected) {
    ttBtn.classList.add('connected');
    if (ttDot)     ttDot.classList.add('connected');
    if (ttCardDot) ttCardDot.classList.add('connected');
    if (ttStatus)  ttStatus.textContent = state.testMode ? 'Demo connected' : 'Connected ✓';
    if (headerTtPill) { headerTtPill.textContent = '♪ TT'; headerTtPill.style.display = ''; }
    ttBtn.onclick = state.testMode ? null : () => {
      clearToken('tt'); updateAuthUI(); toast('TikTok disconnected');
    };
  } else {
    ttBtn.classList.remove('connected');
    if (ttDot)     ttDot.classList.remove('connected');
    if (ttCardDot) ttCardDot.classList.remove('connected');
    if (ttStatus)  ttStatus.textContent = 'Tap to connect';
    if (headerTtPill) headerTtPill.style.display = 'none';
    ttBtn.onclick = authTikTok;
  }
}

// ── PKCE Helpers ──────────────────────────────────────────────
function generateCodeVerifier() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── YouTube Auth ───────────────────────────────────────────────
async function authYouTube() {
  if (!CONFIG.GOOGLE_CLIENT_ID || CONFIG.GOOGLE_CLIENT_ID.startsWith('YOUR_')) {
    toast('⚠ Set GOOGLE_CLIENT_ID in config.js first', 'error'); return;
  }
  if (!CONFIG.WORKER_URL || CONFIG.WORKER_URL.startsWith('YOUR_')) {
    toast('⚠ Set WORKER_URL in config.js first', 'error'); return;
  }

  const verifier  = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  localStorage.setItem('yt_verifier', verifier);
  localStorage.setItem('oauth_pending', 'youtube');

  // Encode verifier in state so it survives the GitHub -> dualpost.app redirect
  const stateParam = btoa(JSON.stringify({ platform: 'youtube', verifier }));

  const params = new URLSearchParams({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    redirect_uri: CONFIG.REDIRECT_URI,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
    state: stateParam,
  });

  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// ── TikTok Auth ────────────────────────────────────────────────
async function authTikTok() {
  if (!CONFIG.TIKTOK_CLIENT_KEY || CONFIG.TIKTOK_CLIENT_KEY.startsWith('YOUR_')) {
    toast('⚠ Set TIKTOK_CLIENT_KEY in config.js first', 'error'); return;
  }
  if (!CONFIG.WORKER_URL || CONFIG.WORKER_URL.startsWith('YOUR_')) {
    toast('⚠ Set WORKER_URL in config.js first', 'error'); return;
  }

  const verifier  = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  localStorage.setItem('tt_verifier', verifier);
  localStorage.setItem('oauth_pending', 'tiktok');

  // Encode verifier in state so it survives the GitHub -> dualpost.app redirect
  const stateParam = btoa(JSON.stringify({ platform: 'tiktok', verifier }));

  const params = new URLSearchParams({
    client_key: CONFIG.TIKTOK_CLIENT_KEY,
    redirect_uri: CONFIG.TIKTOK_REDIRECT_URI,
    response_type: 'code',
    scope: 'video.upload,user.info.basic',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: stateParam,
  });

  window.location.href = `https://www.tiktok.com/v2/auth/authorize/?${params}`;
}

// ── OAuth Callback Handler ─────────────────────────────────────
async function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get('code');

  // Try localStorage first, then fall back to state param (survives cross-domain redirect)
  let platform = localStorage.getItem('oauth_pending');
  let verifierFromState = null;

  const stateParam = params.get('state');
  if (stateParam) {
    try {
      const decoded = JSON.parse(atob(stateParam));
      if (!platform && decoded.platform) platform = decoded.platform;
      if (decoded.verifier) verifierFromState = decoded.verifier;
    } catch(e) { /* state param wasn't ours, ignore */ }
  }

  dbg('Callback check: code=' + (code?'YES':'NO') + ' platform=' + (platform||'NONE'));
  if (!code || !platform) { dbg('Callback aborted - missing code or platform'); return; }

  window.history.replaceState({}, document.title, window.location.pathname);
  localStorage.removeItem('oauth_pending');

  toast('Connecting account...');
  dbg('Starting exchange for: ' + platform);

  try {
    if (platform === 'youtube')     await exchangeYouTubeCode(code, verifierFromState);
    else if (platform === 'tiktok') await exchangeTikTokCode(code, verifierFromState);
  } catch (err) {
    console.error('OAuth exchange error:', err);
    dbg('ERROR: ' + err.message);
    toast('Connection failed: ' + err.message, 'error');
  }

  updateAuthUI();
}

async function exchangeYouTubeCode(code, verifierOverride) {
  const verifier = verifierOverride || localStorage.getItem('yt_verifier');
  localStorage.removeItem('yt_verifier');

  // Note: Worker URL only — no /exchange path, the Worker handles all requests at root
  const res = await fetch(CONFIG.WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, platform: 'youtube', verifier }),
  });

  const rawText = await res.text();
  dbg('Worker YouTube response: ' + res.status + ' | ' + rawText.slice(0,80));

  if (!res.ok) throw new Error(`Worker returned ${res.status}: ${rawText}`);

  let data;
  try { data = JSON.parse(rawText); }
  catch (e) { throw new Error('Worker response was not valid JSON: ' + rawText); }

  if (!data.access_token) throw new Error('No access_token in response: ' + rawText);

  state.ytToken = { access_token: data.access_token };
  saveTokens();
  dbg('YouTube token saved OK');
  toast('YouTube connected! 🎉', 'success');
}

async function exchangeTikTokCode(code, verifierOverride) {
  const verifier = verifierOverride || localStorage.getItem('tt_verifier');
  localStorage.removeItem('tt_verifier');

  const res = await fetch(CONFIG.WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, platform: 'tiktok', verifier, redirect_uri: CONFIG.TIKTOK_REDIRECT_URI }),
  });

  const rawText = await res.text();
  dbg('Worker TikTok response: ' + res.status + ' | ' + rawText.slice(0,80));

  if (!res.ok) throw new Error(`Worker returned ${res.status}: ${rawText}`);

  let data;
  try { data = JSON.parse(rawText); }
  catch (e) { throw new Error('Worker response was not valid JSON: ' + rawText); }

  if (!data.access_token) throw new Error('No access_token in response: ' + rawText);

  state.ttToken = { access_token: data.access_token };
  saveTokens();
  toast('TikTok connected! 🎉', 'success');
}

// ── Drop Zone / File Handling ──────────────────────────────────
function initDropZone() {
  const zone  = document.getElementById('dropZone');
  const input = document.getElementById('videoInput');

  zone.addEventListener('click', () => {
    if (state.testMode && !state.file) {
      // In test mode set a fake placeholder so the upload flow works
      state.file = { name: 'demo-video.mp4', size: 10 * 1024 * 1024, type: 'video/mp4', _demo: true };
      showPreview(null);
      showFileMeta(state.file);
      toast('Demo video selected 🎬');
      return;
    }
    input.click();
  });
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('dragging'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragging');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  input.addEventListener('change', () => {
    if (input.files[0]) handleFile(input.files[0]);
  });
}

function handleFile(file) {
  // In test mode accept any file — nothing gets uploaded anyway
  if (!state.testMode) {
    const validExt = /\.(mp4|mov|webm)$/i.test(file.name);
    const validType = ['video/mp4','video/quicktime','video/webm'].includes(file.type);
    if (!validType && !validExt) {
      toast('Please select an MP4, MOV, or WebM file.', 'error'); return;
    }
    if (file.size > 256 * 1024 * 1024) {
      toast('File too large. Max 256MB.', 'error'); return;
    }
  }
  state.file = file;
  showPreview(file);
  showFileMeta(file);
}

function showPreview(file) {
  const wrap = document.getElementById('videoPreviewWrap');
  wrap.innerHTML = '';
  if (!file) {
    wrap.innerHTML = '<span style="font-size:2rem">🎬</span><span class="drop-hint">Demo video</span>';
    return;
  }
  const video = document.createElement('video');
  video.src = URL.createObjectURL(file);
  video.muted = true; video.loop = true; video.autoplay = true; video.playsInline = true;
  wrap.appendChild(video);
}

function showFileMeta(file) {
  document.getElementById('fileMeta').style.display = 'flex';
  document.getElementById('fileName').textContent = file.name + (file._demo ? ' (demo)' : '');
  document.getElementById('fileSize').textContent = formatBytes(file.size);
}

function clearFile() {
  state.file = null;
  document.getElementById('videoInput').value = '';
  document.getElementById('fileMeta').style.display = 'none';
  document.getElementById('videoPreviewWrap').innerHTML = `
    <span class="drop-icon">▲</span>
    <span class="drop-hint">Drop vertical video here<br/>or click to browse</span>`;
}

function updateCharCount() {
  document.getElementById('charCount').textContent =
    document.getElementById('videoTitle').value.length;
}

// ── Platform Settings Helpers ──────────────────────────────────
function togglePlatformSettings(platform) {
  const checked  = document.getElementById(platform + 'Check').checked;
  const settings = document.getElementById(platform + 'Settings');
  const col      = document.getElementById(platform + 'Col');
  if (settings) settings.classList.toggle('disabled', !checked);
  if (col)      col.classList.toggle(platform + '-active', checked);
}

function initPlatformStates() {
  togglePlatformSettings('yt');
  togglePlatformSettings('tt');
}

function updateTtDisclosure() {
  const branded  = document.getElementById('ttBrandedContent').checked;
  const disclaimer = document.getElementById('ttDisclaimer');
  if (!disclaimer) return;
  if (branded) {
    disclaimer.innerHTML = "By posting, you agree to TikTok's <a href='https://www.tiktok.com/legal/branded-content-policy' target='_blank'>Branded Content Policy</a> and <a href='https://www.tiktok.com/legal/music-usage-confirmation' target='_blank'>Music Usage Confirmation</a>";
  } else {
    disclaimer.innerHTML = `By posting, you agree to TikTok's <a href="https://www.tiktok.com/legal/music-usage-confirmation" target="_blank">Music Usage Confirmation</a>`;
  }
}

// ── YouTube Channel Info ──────────────────────────────────────
async function fetchYouTubeChannelInfo() {
  const loadingEl = document.getElementById('ytCreatorLoading');
  const infoEl    = document.getElementById('ytCreatorInfo');
  if (!loadingEl || !infoEl) return;

  dbg('fetchYouTubeChannelInfo called. testMode=' + state.testMode);
  if (state.testMode) {
    populateYouTubeChannelInfo({
      title: 'Demo Channel',
      customUrl: '@demochannel',
      thumbnails: { default: { url: '' } },
    });
    return;
  }

  const ytAccessToken = state.ytToken?.access_token || (typeof state.ytToken === 'string' ? state.ytToken : null);
  dbg('YT access token: ' + (ytAccessToken ? ytAccessToken.slice(0,12)+'...' : 'NONE'));
  if (!ytAccessToken) { dbg('No YT access token'); return; }

  loadingEl.style.display = 'flex';
  infoEl.style.display = 'none';

  try {
    dbg('Calling YT proxy...');
    // Try channels API first for specific channel name
    const chanRes = await fetch(CONFIG.WORKER_URL + '/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
        token: ytAccessToken,
      }),
    });
    const chanText = await chanRes.text();
    dbg('YT channels response: ' + chanRes.status + ' | ' + chanText.slice(0, 80));
    const chanData = JSON.parse(chanText);

    if (chanData.items && chanData.items.length > 0) {
      populateYouTubeChannelInfo(chanData.items[0].snippet);
    } else {
      // Fall back to userinfo for Google account name/picture
      dbg('YT channels empty, falling back to userinfo');
      const uiRes = await fetch(CONFIG.WORKER_URL + '/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://www.googleapis.com/oauth2/v3/userinfo',
          token: ytAccessToken,
        }),
      });
      const uiData = JSON.parse(await uiRes.text());
      populateYouTubeChannelInfo({
        title: uiData.name || 'YouTube Connected',
        customUrl: uiData.email || '',
        thumbnails: { default: { url: uiData.picture || '' } },
      });
    }
  } catch(e) {
    dbg('YouTube channel info fetch failed: ' + e.message + ' — trying userinfo fallback');
    try {
      const uiRes = await fetch(CONFIG.WORKER_URL + '/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://www.googleapis.com/oauth2/v3/userinfo',
          token: ytAccessToken,
        }),
      });
      const uiData = JSON.parse(await uiRes.text());
      populateYouTubeChannelInfo({
        title: uiData.name || 'YouTube Connected',
        customUrl: uiData.email || '',
        thumbnails: { default: { url: uiData.picture || '' } },
      });
    } catch(e2) {
      populateYouTubeChannelInfo({ title: 'YouTube Connected', customUrl: '', thumbnails: {} });
    }
  } finally {
    loadingEl.style.display = 'none';
  }
}

function populateYouTubeChannelInfo(snippet) {
  const infoEl = document.getElementById('ytCreatorInfo');
  if (!infoEl) return;

  document.getElementById('ytCreatorName').textContent     = snippet.title || '';
  document.getElementById('ytCreatorUsername').textContent = snippet.customUrl || '';

  const avatar = document.getElementById('ytCreatorAvatar');
  const url    = snippet.thumbnails?.default?.url || snippet.thumbnails?.medium?.url || '';
  if (url) { avatar.src = url; avatar.style.display = 'block'; }
  else       { avatar.style.display = 'none'; }

  infoEl.style.display = 'flex';
}

// ── TikTok Creator Info ────────────────────────────────────────
function showTikTokPlaceholder() {
  dbg('showTikTokPlaceholder called');
  const infoEl = document.getElementById('ttCreatorInfo');
  const loadingEl = document.getElementById('ttCreatorLoading');
  dbg('infoEl=' + (infoEl?'found':'NULL') + ' loadingEl=' + (loadingEl?'found':'NULL'));
  if (loadingEl) loadingEl.style.display = 'none';
  if (infoEl) {
    infoEl.innerHTML = '<span style="font-size:0.72rem;font-weight:700;color:#a07850;line-height:1.5;">Account connected. Profile info requires production API access — not available in sandbox mode.</span>';
    infoEl.style.display = 'flex';
    dbg('Placeholder text set, display=flex');
  }
  // Populate privacy with defaults
  const privacySelect = document.getElementById('ttPrivacy');
  if (privacySelect) {
    privacySelect.innerHTML = '<option value="">Select...</option>';
    [['PUBLIC_TO_EVERYONE','Everyone'],['MUTUAL_FOLLOW_FRIENDS','Friends'],['SELF_ONLY','Only Me']].forEach(([val, label]) => {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = label;
      privacySelect.appendChild(opt);
    });
  }
}

async function fetchTikTokCreatorInfo() {
  const loadingEl = document.getElementById('ttCreatorLoading');
  const infoEl    = document.getElementById('ttCreatorInfo');
  if (!loadingEl || !infoEl) return;

  dbg('fetchTikTokCreatorInfo called. testMode=' + state.testMode);
  if (state.testMode) {
    populateTikTokCreatorInfo({
      creator_nickname: 'Demo User',
      creator_username: '@demouser',
      creator_avatar_url: '',
      privacy_level_options: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
      comment_disabled: false,
      duet_disabled: false,
      stitch_disabled: false,
    });
    return;
  }

  const ttAccessToken = state.ttToken?.access_token || (typeof state.ttToken === 'string' ? state.ttToken : null);
  dbg('TT access token: ' + (ttAccessToken ? ttAccessToken.slice(0,12)+'...' : 'NONE'));
  if (!ttAccessToken) { dbg('No TT access token'); return; }

  loadingEl.style.display = 'flex';
  infoEl.style.display = 'none';

  try {
    dbg('Calling TT proxy...');
    const res = await fetch(CONFIG.WORKER_URL + '/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
        token: ttAccessToken,
        method: 'POST',
      }),
    });
    const text = await res.text();
    dbg('TT proxy response: ' + res.status + ' | ' + text.slice(0, 100));
    let data = {};
    try { data = JSON.parse(text); } catch(parseErr) { dbg('TT JSON parse error: ' + parseErr.message); }
    if (data.data && data.data.creator_nickname) {
      populateTikTokCreatorInfo(data.data);
    } else {
      dbg('TT no valid data — showing placeholder');
      showTikTokPlaceholder();
    }
  } catch(e) {
    dbg('Creator info fetch failed: ' + e.message);
    showTikTokPlaceholder();
  } finally {
    const ttLoading = document.getElementById('ttCreatorLoading');
    if (ttLoading) ttLoading.style.display = 'none';
  }
}

function populateTikTokCreatorInfo(info) {
  // Show creator info card
  const infoEl = document.getElementById('ttCreatorInfo');
  if (infoEl) {
    document.getElementById('ttCreatorName').textContent     = info.creator_nickname || '';
    document.getElementById('ttCreatorUsername').textContent = info.creator_username ? '@' + info.creator_username.replace('@','') : '';
    const avatar = document.getElementById('ttCreatorAvatar');
    if (info.creator_avatar_url) {
      avatar.src = info.creator_avatar_url;
      avatar.style.display = 'block';
    } else {
      avatar.style.display = 'none';
    }
    infoEl.style.display = 'flex';
  }

  // Populate privacy dropdown
  const privacySelect = document.getElementById('ttPrivacy');
  if (privacySelect) {
    privacySelect.innerHTML = '<option value="">Select...</option>';
    const labels = {
      'PUBLIC_TO_EVERYONE':    'Everyone',
      'MUTUAL_FOLLOW_FRIENDS': 'Friends',
      'SELF_ONLY':             'Only Me',
    };
    (info.privacy_level_options || ['PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','SELF_ONLY']).forEach(level => {
      const opt = document.createElement('option');
      opt.value = level;
      opt.textContent = labels[level] || level;
      privacySelect.appendChild(opt);
    });
  }

  // Set interaction checkboxes
  const setInteraction = (id, labelId, disabled) => {
    const el    = document.getElementById(id);
    const label = document.getElementById(labelId);
    if (el)    { el.checked = false; el.disabled = !!disabled; }
    if (label) label.classList.toggle('disabled', !!disabled);
  };

  setInteraction('ttComment', 'ttCommentLabel', info.comment_disabled);
  setInteraction('ttDuet',    'ttDuetLabel',    info.duet_disabled);
  setInteraction('ttStitch',  'ttStitchLabel',  info.stitch_disabled);
}

// ── Upload Orchestration ───────────────────────────────────────
async function startUpload() {
  const title    = document.getElementById('videoTitle').value.trim();
  const desc     = document.getElementById('videoDesc').value.trim();
  const uploadYT = document.getElementById('ytCheck').checked;
  const uploadTT = document.getElementById('ttCheck').checked;

  dbg('Upload pressed. testMode=' + state.testMode + ' ytToken=' + (state.ytToken ? 'YES' : 'NO') + ' file=' + (state.file ? state.file.name : 'NONE'));

  if (!state.file && !state.testMode) { toast('Please select a video file first.', 'error'); return; }
  if (!title)                         { toast('Please enter a video title.', 'error'); return; }
  if (!uploadYT && !uploadTT)         { toast('Select at least one platform.', 'error'); return; }

  // YouTube validation
  if (uploadYT) {
    const ytPrivacy = document.getElementById('ytPrivacy').value;
    if (!ytPrivacy) { toast('Please select a YouTube visibility.', 'error'); return; }
  }

  // TikTok validation
  if (uploadTT) {
    const ttPrivacy = document.getElementById('ttPrivacy').value;
    if (!ttPrivacy) { toast('Please select a TikTok visibility.', 'error'); return; }
  }

  // Live mode auth checks
  if (!state.testMode) {
    if (uploadYT && !state.ytToken) { toast('Connect YouTube first.', 'error'); return; }
    if (uploadTT && !state.ttToken) { toast('Connect TikTok first.', 'error'); return; }
  }

  document.getElementById('uploaderCard').style.display = 'none';
  document.getElementById('progressPanel').style.display = 'block';

  // Update progress panel title to show mode
  document.querySelector('.progress-title').textContent =
    state.testMode ? '🧪 Simulating Upload...' : '🚀 Uploading...';

  state.uploading = true;

  const results = {};
  const uploads = [];

  if (uploadYT) uploads.push(
    (state.testMode ? simulateUpload('yt') : uploadToYouTube(state.file, title, desc))
      .then(url  => { results.yt = { url, ok: true }; })
      .catch(err => { results.yt = { ok: false, err }; console.error(err); })
  );

  if (uploadTT) uploads.push(
    (state.testMode ? simulateUpload('tt') : uploadToTikTok(state.file, title, desc))
      .then(url  => { results.tt = { url, ok: true }; })
      .catch(err => { results.tt = { ok: false, err }; console.error(err); })
  );

  await Promise.all(uploads);

  if (!state.uploading) return; // cancelled

  showSuccess(results, uploadYT, uploadTT);
}

// ── Simulated Upload (Test Mode) ───────────────────────────────
function simulateUpload(platform) {
  return new Promise(resolve => {
    setProgress(platform, 0, 'Simulating...');
    let pct = 0;
    // Stagger start so the two bars don't move in perfect sync (looks more real)
    const delay = platform === 'tt' ? 300 : 0;
    setTimeout(() => {
      const interval = setInterval(() => {
        // Random chunky increments like a real upload
        pct += Math.random() * 14 + 3;
        if (pct >= 100) {
          pct = 100;
          clearInterval(interval);
          setProgress(platform, 100, 'Done ✓');
          resolve(platform === 'yt'
            ? 'https://www.youtube.com/shorts/demo_test'
            : 'https://www.tiktok.com/@demo/video/test');
        } else {
          setProgress(platform, Math.round(pct), `${Math.round(pct)}%`);
        }
      }, 220);
    }, delay);
  });
}

// ── YouTube Upload (Live) ──────────────────────────────────────
async function uploadToYouTube(file, title, description) {
  setProgress('yt', 2, 'Creating upload session...');

  const token = state.ytToken.access_token;

  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': file.type || 'video/mp4',
        'X-Upload-Content-Length': file.size,
      },
      body: JSON.stringify({
        snippet: {
          title,
          description,
          categoryId: document.getElementById('ytCategory').value || undefined,
        },
        status: {
          privacyStatus: document.getElementById('ytPrivacy').value || 'public',
          selfDeclaredMadeForKids: document.querySelector('input[name="ytKids"]:checked')?.value === 'true',
          containsSyntheticMedia: false,
        },
        paidProductPlacementAndPromotion: document.getElementById('ytPaidPromotion')?.checked || false,
      }),
    }
  );

  if (initRes.status === 401) {
    clearToken('yt'); updateAuthUI();
    throw new Error('YouTube token expired — please reconnect.');
  }
  if (!initRes.ok) {
    const body = await initRes.json().catch(() => ({}));
    throw new Error(body?.error?.message || `YouTube init failed (${initRes.status})`);
  }

  const uploadUrl = initRes.headers.get('Location');
  if (!uploadUrl) throw new Error('YouTube did not return an upload URL.');
  setProgress('yt', 5, 'Uploading...');

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');

    xhr.upload.onprogress = e => {
      if (e.lengthComputable)
        setProgress('yt', Math.round((e.loaded / e.total) * 93) + 5,
          `${Math.round((e.loaded / e.total) * 93) + 5}%`);
    };

    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 201) {
        try {
          const video = JSON.parse(xhr.responseText);
          setProgress('yt', 100, 'Done ✓');
          resolve(`https://www.youtube.com/shorts/${video.id}`);
        } catch {
          setProgress('yt', 100, 'Done ✓');
          resolve('https://studio.youtube.com');
        }
      } else {
        setProgress('yt', 0, `Failed (${xhr.status})`);
        reject(new Error(`YouTube upload error ${xhr.status}: ${xhr.responseText}`));
      }
    };
    xhr.onerror  = () => { setProgress('yt', 0, 'Network error'); reject(new Error('Network error')); };
    xhr.onabort  = () => { setProgress('yt', 0, 'Cancelled');     reject(new Error('Cancelled')); };
    xhr.send(file);
    window._ytXhr = xhr;
  });
}

// ── TikTok Upload (Live) ───────────────────────────────────────
async function uploadToTikTok(file, title, description) {
  setProgress('tt', 2, 'Creating upload session...');

  const token = state.ttToken.access_token;

  const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        title: title.slice(0, 150),
        privacy_level: document.getElementById('ttPrivacy').value || 'PUBLIC_TO_EVERYONE',
        disable_comment: !document.getElementById('ttComment').checked,
        disable_duet:    !document.getElementById('ttDuet').checked,
        disable_stitch:  !document.getElementById('ttStitch').checked,
        brand_content_toggle: document.getElementById('ttBrandedContent').checked,
        brand_organic_toggle: document.getElementById('ttYourBrand').checked,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: file.size,
        chunk_size: file.size,
        total_chunk_count: 1,
      },
    }),
  });

  if (initRes.status === 401) {
    clearToken('tt'); updateAuthUI();
    throw new Error('TikTok token expired — please reconnect.');
  }
  if (!initRes.ok) {
    const body = await initRes.json().catch(() => ({}));
    throw new Error(body?.error?.message || `TikTok init failed (${initRes.status})`);
  }

  const { data } = await initRes.json();
  const { publish_id, upload_url } = data;
  if (!upload_url) throw new Error('TikTok did not return an upload URL.');
  setProgress('tt', 5, 'Uploading...');

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', upload_url);
    xhr.setRequestHeader('Content-Range', `bytes 0-${file.size - 1}/${file.size}`);
    xhr.setRequestHeader('Content-Type', 'video/mp4');

    xhr.upload.onprogress = e => {
      if (e.lengthComputable)
        setProgress('tt', Math.round((e.loaded / e.total) * 93) + 5,
          `${Math.round((e.loaded / e.total) * 93) + 5}%`);
    };

    xhr.onload = () => {
      if ([200, 201, 206].includes(xhr.status)) {
        setProgress('tt', 100, 'Done ✓');
        resolve(`https://www.tiktok.com/upload?publish_id=${publish_id}`);
      } else {
        setProgress('tt', 0, `Failed (${xhr.status})`);
        reject(new Error(`TikTok upload error ${xhr.status}: ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => { setProgress('tt', 0, 'Network error'); reject(new Error('Network error')); };
    xhr.onabort = () => { setProgress('tt', 0, 'Cancelled');     reject(new Error('Cancelled')); };
    xhr.send(file);
    window._ttXhr = xhr;
  });
}

// ── Cancel ─────────────────────────────────────────────────────
function cancelUpload() {
  state.uploading = false;
  if (window._ytXhr) { window._ytXhr.abort(); window._ytXhr = null; }
  if (window._ttXhr) { window._ttXhr.abort(); window._ttXhr = null; }
  document.getElementById('progressPanel').style.display = 'none';
  document.getElementById('uploaderCard').style.display = 'block';
  toast('Upload cancelled.');
}

// ── Progress Helpers ───────────────────────────────────────────
function setProgress(platform, pct, statusText) {
  const bar    = document.getElementById(`${platform}Bar`);
  const status = document.getElementById(`${platform}Status`);
  if (bar)    bar.style.width = `${pct}%`;
  if (status) status.textContent = statusText;
}

// ── Success Panel ──────────────────────────────────────────────
function showSuccess(results, uploadYT, uploadTT) {
  document.getElementById('progressPanel').style.display = 'none';
  const panel = document.getElementById('successPanel');
  panel.style.display = 'block';

  // Add test mode badge to success title
  if (state.testMode) {
    document.querySelector('.success-title').textContent = 'Simulated!';
  } else {
    document.querySelector('.success-title').textContent = 'Posted!';
  }

  const linksDiv = document.getElementById('successLinks');
  linksDiv.innerHTML = state.testMode
    ? '<p style="font-size:0.82rem;font-weight:700;color:#a07850;margin-bottom:8px;">🧪 These are demo links — switch to Live Mode to post for real.</p>'
    : '';

  if (uploadYT) {
    const a = document.createElement('a');
    if (results.yt?.ok) {
      a.href = results.yt.url; a.target = '_blank';
      a.textContent = state.testMode ? '▶ Demo YouTube Shorts link' : '▶ View on YouTube Shorts';
    } else {
      a.href = 'https://studio.youtube.com'; a.target = '_blank';
      a.textContent = '▶ YouTube — check Studio for status';
      a.style.borderColor = '#f97316';
    }
    linksDiv.appendChild(a);
  }

  if (uploadTT) {
    const a = document.createElement('a');
    if (results.tt?.ok) {
      a.href = results.tt.url; a.target = '_blank';
      a.textContent = state.testMode ? '♪ Demo TikTok link' : '♪ View on TikTok';
    } else {
      a.href = 'https://www.tiktok.com/upload'; a.target = '_blank';
      a.textContent = '♪ TikTok — check your uploads';
      a.style.borderColor = '#f97316';
    }
    linksDiv.appendChild(a);
  }
}

function resetApp() {
  state.file = null;
  state.uploading = false;
  document.getElementById('successPanel').style.display = 'none';
  document.getElementById('uploaderCard').style.display = 'block';
  document.getElementById('videoTitle').value = '';
  document.getElementById('videoDesc').value  = '';
  document.getElementById('charCount').textContent = '0';
  clearFile();
  setProgress('yt', 0, 'Waiting...');
  setProgress('tt', 0, 'Waiting...');
}

// ── Toast ──────────────────────────────────────────────────────
let toastTimeout;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.remove('show'), 3500);
}

// ── Utilities ──────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
