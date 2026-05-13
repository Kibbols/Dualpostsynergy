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
  testMode: true,   // default to test mode for safety
};

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
  // Auto-open drawer when new log arrives so user sees it
  openDebugDrawer();
}

// ── On Load ───────────────────────────────────────────────────
window.addEventListener('load', () => {
  const savedMode = localStorage.getItem('dp_mode');
  if (savedMode === 'live') {
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
  const banner    = document.getElementById('modeBanner');
  const uploadBtn = document.getElementById('uploadBtn');
  const pill      = document.getElementById('headerModePill');

  // Sidebar mode row
  const sbIcon  = document.getElementById('sbModeIcon');
  const sbTitle = document.getElementById('sbModeTitle');
  const sbSub   = document.getElementById('sbModeSub');

  if (state.testMode) {
    banner.innerHTML = `
      <span class="mode-banner-icon">🧪</span>
      <div><strong>Test Mode</strong> — No real uploads. Auth is skipped and progress is simulated. Perfect for demos!</div>
      <button class="mode-banner-switch" onclick="switchToLive()">Switch to Live →</button>`;
    uploadBtn.querySelector('.btn-text').textContent = 'Simulate Upload';
    if (pill)    { pill.textContent = '🧪 Test'; pill.classList.remove('live-pill'); }
    if (sbIcon)  sbIcon.textContent  = '🧪';
    if (sbTitle) sbTitle.textContent = 'Test Mode';
    if (sbSub)   sbSub.textContent   = 'Simulated uploads';
  } else {
    banner.innerHTML = `
      <span class="mode-banner-icon">🚀</span>
      <div><strong>Live Mode</strong> — Real uploads to YouTube &amp; TikTok. Connect your accounts to get started.</div>
      <button class="mode-banner-switch" onclick="switchToTest()">← Switch to Test</button>`;
    uploadBtn.querySelector('.btn-text').textContent = 'Publish Now';
    if (pill)    { pill.textContent = '🚀 Live'; pill.classList.add('live-pill'); }
    if (sbIcon)  sbIcon.textContent  = '🚀';
    if (sbTitle) sbTitle.textContent = 'Live Mode';
    if (sbSub)   sbSub.textContent   = 'Real uploads';
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

  const params = new URLSearchParams({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    redirect_uri: CONFIG.REDIRECT_URI,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/youtube.upload',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
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

  const params = new URLSearchParams({
    client_key: CONFIG.TIKTOK_CLIENT_KEY,
    redirect_uri: CONFIG.REDIRECT_URI,
    response_type: 'code',
    scope: 'video.upload',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'tiktok_auth',
  });

  window.location.href = `https://www.tiktok.com/v2/auth/authorize/?${params}`;
}

// ── OAuth Callback Handler ─────────────────────────────────────
async function handleOAuthCallback() {
  const params   = new URLSearchParams(window.location.search);
  const code     = params.get('code');
  const platform = localStorage.getItem('oauth_pending');

  dbg('Callback check: code=' + (code?'YES':'NO') + ' platform=' + (platform||'NONE'));
  if (!code || !platform) { dbg('Callback aborted - missing code or platform'); return; }

  // Clean the URL immediately so a refresh doesn't re-trigger
  window.history.replaceState({}, document.title, window.location.pathname);
  localStorage.removeItem('oauth_pending');

  toast('Connecting account...');
  dbg('Starting exchange for: ' + platform);

  try {
    if (platform === 'youtube')     await exchangeYouTubeCode(code);
    else if (platform === 'tiktok') await exchangeTikTokCode(code);
  } catch (err) {
    console.error('OAuth exchange error:', err);
    dbg('ERROR: ' + err.message);
    toast('Connection failed: ' + err.message, 'error');
  }

  updateAuthUI();
}

async function exchangeYouTubeCode(code) {
  const verifier = localStorage.getItem('yt_verifier');
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

async function exchangeTikTokCode(code) {
  const verifier = localStorage.getItem('tt_verifier');
  localStorage.removeItem('tt_verifier');

  const res = await fetch(CONFIG.WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, platform: 'tiktok', verifier }),
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

// ── Upload Orchestration ───────────────────────────────────────
async function startUpload() {
  const title    = document.getElementById('videoTitle').value.trim();
  const desc     = document.getElementById('videoDesc').value.trim();
  const uploadYT = document.getElementById('ytCheck').checked;
  const uploadTT = document.getElementById('ttCheck').checked;

  if (!state.file && !state.testMode) { toast('Please select a video file first.', 'error'); return; }
  if (!title)                   { toast('Please enter a video title.', 'error'); return; }
  if (!uploadYT && !uploadTT)   { toast('Select at least one platform.', 'error'); return; }

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
        snippet: { title, description, categoryId: '22' },
        status:  { privacyStatus: 'public', selfDeclaredMadeForKids: false },
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
        privacy_level: 'PUBLIC_TO_EVERYONE',
        disable_duet: false, disable_comment: false, disable_stitch: false,
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
