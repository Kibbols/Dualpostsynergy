// ─────────────────────────────────────────────────────────────
//  DualPost — App Logic
//  Handles: OAuth (YouTube + TikTok), file selection, uploading
// ─────────────────────────────────────────────────────────────

// ── State ─────────────────────────────────────────────────────
const state = {
  file: null,
  ytToken: null,
  ttToken: null,
  uploading: false,
  ytUploadCancelled: false,
  ttUploadCancelled: false,
};

// ── On Load ───────────────────────────────────────────────────
window.addEventListener('load', () => {
  // Check if we're returning from an OAuth redirect
  handleOAuthCallback();
  // Restore any saved tokens from sessionStorage
  restoreTokens();
  updateAuthUI();
  initDropZone();
});

// ── Token Storage ─────────────────────────────────────────────
function saveTokens() {
  if (state.ytToken) sessionStorage.setItem('dp_yt', JSON.stringify(state.ytToken));
  if (state.ttToken) sessionStorage.setItem('dp_tt', JSON.stringify(state.ttToken));
}

function restoreTokens() {
  const yt = sessionStorage.getItem('dp_yt');
  const tt = sessionStorage.getItem('dp_tt');
  if (yt) state.ytToken = JSON.parse(yt);
  if (tt) state.ttToken = JSON.parse(tt);
}

function clearToken(platform) {
  if (platform === 'yt') { state.ytToken = null; sessionStorage.removeItem('dp_yt'); }
  if (platform === 'tt') { state.ttToken = null; sessionStorage.removeItem('dp_tt'); }
}

// ── Auth UI ───────────────────────────────────────────────────
function updateAuthUI() {
  const ytBtn = document.getElementById('ytAuthBtn');
  const ttBtn = document.getElementById('ttAuthBtn');
  const ytDot = document.getElementById('ytDot');
  const ttDot = document.getElementById('ttDot');

  if (state.ytToken) {
    ytBtn.classList.add('connected');
    ytBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.7 15.5V8.5l6.3 3.5-6.3 3.5z"/></svg> YouTube ✓`;
    ytBtn.onclick = () => { clearToken('yt'); updateAuthUI(); toast('YouTube disconnected'); };
    if (ytDot) ytDot.classList.add('connected');
  } else {
    ytBtn.classList.remove('connected');
    ytBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.7 15.5V8.5l6.3 3.5-6.3 3.5z"/></svg> Connect YouTube`;
    ytBtn.onclick = authYouTube;
    if (ytDot) ytDot.classList.remove('connected');
  }

  if (state.ttToken) {
    ttBtn.classList.add('connected');
    ttBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.6 3.3A4.9 4.9 0 0 1 14.7 0h-3.6v16.4a2.9 2.9 0 0 1-2.9 2.5 2.9 2.9 0 0 1-2.9-2.9 2.9 2.9 0 0 1 2.9-2.9c.3 0 .5 0 .8.1V9.5a6.5 6.5 0 0 0-.8-.1A6.5 6.5 0 0 0 1.7 16a6.5 6.5 0 0 0 6.5 6.5A6.5 6.5 0 0 0 14.7 16V8.2a8.4 8.4 0 0 0 4.9 1.6V6.2a4.9 4.9 0 0 1-3-.9z"/></svg> TikTok ✓`;
    ttBtn.onclick = () => { clearToken('tt'); updateAuthUI(); toast('TikTok disconnected'); };
    if (ttDot) ttDot.classList.add('connected');
  } else {
    ttBtn.classList.remove('connected');
    ttBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.6 3.3A4.9 4.9 0 0 1 14.7 0h-3.6v16.4a2.9 2.9 0 0 1-2.9 2.5 2.9 2.9 0 0 1-2.9-2.9 2.9 2.9 0 0 1 2.9-2.9c.3 0 .5 0 .8.1V9.5a6.5 6.5 0 0 0-.8-.1A6.5 6.5 0 0 0 1.7 16a6.5 6.5 0 0 0 6.5 6.5A6.5 6.5 0 0 0 14.7 16V8.2a8.4 8.4 0 0 0 4.9 1.6V6.2a4.9 4.9 0 0 1-3-.9z"/></svg> Connect TikTok`;
    ttBtn.onclick = authTikTok;
    if (ttDot) ttDot.classList.remove('connected');
  }
}

// ── PKCE Helpers ──────────────────────────────────────────────
function generateCodeVerifier() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── YouTube Auth (Google OAuth 2.0 with PKCE) ─────────────────
async function authYouTube() {
  if (CONFIG.GOOGLE_CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com') {
    toast('⚠ Set your GOOGLE_CLIENT_ID in config.js', 'error'); return;
  }
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  sessionStorage.setItem('yt_verifier', verifier);
  sessionStorage.setItem('oauth_pending', 'youtube');

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

// ── TikTok Auth (OAuth 2.0 with PKCE) ────────────────────────
async function authTikTok() {
  if (CONFIG.TIKTOK_CLIENT_KEY === 'YOUR_TIKTOK_CLIENT_KEY') {
    toast('⚠ Set your TIKTOK_CLIENT_KEY in config.js', 'error'); return;
  }
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  sessionStorage.setItem('tt_verifier', verifier);
  sessionStorage.setItem('oauth_pending', 'tiktok');

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

// ── OAuth Callback Handler ────────────────────────────────────
async function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const platform = sessionStorage.getItem('oauth_pending');

  if (!code || !platform) return;

  // Clean up URL
  window.history.replaceState({}, document.title, window.location.pathname);
  sessionStorage.removeItem('oauth_pending');

  toast('Authenticating...');

  if (platform === 'youtube') {
    await exchangeYouTubeCode(code);
  } else if (platform === 'tiktok') {
    await exchangeTikTokCode(code);
  }

  updateAuthUI();
}

async function exchangeYouTubeCode(code) {
  // NOTE: Normally token exchange requires a backend to keep client_secret safe.
  // For GitHub Pages (no backend), YouTube supports the "Installed App" / limited input device
  // flow for public clients. In this setup we store only the access token from the implicit
  // grant for simplicity, OR you can proxy through a small Cloudflare Worker (see SETUP.md).
  //
  // For a fully functional setup, uncomment and configure the backend proxy URL below:
  //
  // const res = await fetch('https://YOUR_WORKER.workers.dev/exchange', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ code, platform: 'youtube', verifier: sessionStorage.getItem('yt_verifier') })
  // });
  // const data = await res.json();
  // state.ytToken = data.access_token;
  // saveTokens();
  // toast('YouTube connected!', 'success');
  //
  // ─── DEMO MODE (no backend): stores placeholder so UI updates ───
  state.ytToken = { access_token: 'DEMO_' + code.slice(0, 8), demo: true };
  sessionStorage.removeItem('yt_verifier');
  saveTokens();
  toast('YouTube connected! (See SETUP.md to complete backend step)', 'success');
}

async function exchangeTikTokCode(code) {
  // Same note as above — token exchange for TikTok also requires a backend.
  // Uncomment and configure the proxy when ready:
  //
  // const res = await fetch('https://YOUR_WORKER.workers.dev/exchange', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ code, platform: 'tiktok', verifier: sessionStorage.getItem('tt_verifier') })
  // });
  // const data = await res.json();
  // state.ttToken = data.access_token;
  // saveTokens();
  // toast('TikTok connected!', 'success');

  state.ttToken = { access_token: 'DEMO_' + code.slice(0, 8), demo: true };
  sessionStorage.removeItem('tt_verifier');
  saveTokens();
  toast('TikTok connected! (See SETUP.md to complete backend step)', 'success');
}

// ── Drop Zone / File Handling ─────────────────────────────────
function initDropZone() {
  const zone = document.getElementById('dropZone');
  const input = document.getElementById('videoInput');

  zone.addEventListener('click', () => input.click());

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragging'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragging');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  input.addEventListener('change', () => {
    if (input.files[0]) handleFile(input.files[0]);
  });
}

function handleFile(file) {
  const validTypes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/mov'];
  if (!validTypes.includes(file.type) && !file.name.match(/\.(mp4|mov|webm)$/i)) {
    toast('Please select an MP4, MOV, or WebM video file.', 'error'); return;
  }

  const maxSize = 256 * 1024 * 1024; // 256MB
  if (file.size > maxSize) {
    toast('File too large. Max 256MB for client-side upload.', 'error'); return;
  }

  state.file = file;
  showPreview(file);
  showFileMeta(file);
}

function showPreview(file) {
  const wrap = document.getElementById('videoPreviewWrap');
  wrap.innerHTML = '';
  const video = document.createElement('video');
  video.src = URL.createObjectURL(file);
  video.muted = true;
  video.loop = true;
  video.autoplay = true;
  video.playsInline = true;
  video.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:12px;';
  wrap.appendChild(video);
}

function showFileMeta(file) {
  document.getElementById('fileMeta').style.display = 'flex';
  document.getElementById('fileName').textContent = file.name;
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
  const len = document.getElementById('videoTitle').value.length;
  document.getElementById('charCount').textContent = len;
}

// ── Upload ────────────────────────────────────────────────────
async function startUpload() {
  const title = document.getElementById('videoTitle').value.trim();
  const desc = document.getElementById('videoDesc').value.trim();
  const uploadYT = document.getElementById('ytCheck').checked;
  const uploadTT = document.getElementById('ttCheck').checked;

  // Validations
  if (!state.file) { toast('Please select a video file first.', 'error'); return; }
  if (!title) { toast('Please enter a video title.', 'error'); return; }
  if (!uploadYT && !uploadTT) { toast('Select at least one platform.', 'error'); return; }
  if (uploadYT && !state.ytToken) { toast('Connect YouTube first.', 'error'); return; }
  if (uploadTT && !state.ttToken) { toast('Connect TikTok first.', 'error'); return; }

  // Show progress panel
  document.getElementById('uploaderCard').style.display = 'none';
  document.getElementById('progressPanel').style.display = 'block';

  state.uploading = true;
  state.ytUploadCancelled = false;
  state.ttUploadCancelled = false;

  const results = {};

  // Upload in parallel
  const uploads = [];
  if (uploadYT) uploads.push(uploadToYouTube(state.file, title, desc).then(r => { results.yt = r; }));
  if (uploadTT) uploads.push(uploadToTikTok(state.file, title, desc).then(r => { results.tt = r; }));

  await Promise.allSettled(uploads);

  if (!state.uploading) return; // was cancelled

  showSuccess(results, uploadYT, uploadTT);
}

// ── YouTube Upload ────────────────────────────────────────────
async function uploadToYouTube(file, title, description) {
  setProgress('yt', 0, 'Starting upload...');

  // If this is a demo token, simulate upload
  if (state.ytToken?.demo) {
    return simulateUpload('yt', 'https://youtube.com/shorts/demo123');
  }

  const token = state.ytToken.access_token;

  // Step 1: Create resumable upload session
  const metadata = {
    snippet: { title, description, categoryId: '22' },
    status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
  };

  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': file.type,
        'X-Upload-Content-Length': file.size,
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!initRes.ok) {
    const err = await initRes.json();
    setProgress('yt', 0, `Error: ${err.error?.message || 'Auth failed'}`);
    throw new Error('YouTube init failed');
  }

  const uploadUrl = initRes.headers.get('Location');
  setProgress('yt', 5, 'Uploading...');

  // Step 2: Upload file with progress tracking
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 95) + 5;
        setProgress('yt', pct, `${pct}%`);
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 201) {
        const video = JSON.parse(xhr.responseText);
        const url = `https://youtube.com/shorts/${video.id}`;
        setProgress('yt', 100, 'Done ✓');
        resolve(url);
      } else {
        setProgress('yt', 0, 'Upload failed');
        reject(new Error('YouTube upload failed'));
      }
    };

    xhr.onerror = () => { setProgress('yt', 0, 'Network error'); reject(); };
    xhr.send(file);

    // Allow cancellation
    window._ytXhr = xhr;
  });
}

// ── TikTok Upload ─────────────────────────────────────────────
async function uploadToTikTok(file, title, description) {
  setProgress('tt', 0, 'Starting upload...');

  // Demo mode simulation
  if (state.ttToken?.demo) {
    return simulateUpload('tt', 'https://tiktok.com/@you/video/demo456');
  }

  const token = state.ttToken.access_token;

  // Step 1: Initialize upload
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
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: file.size,
        chunk_size: file.size,
        total_chunk_count: 1,
      },
    }),
  });

  if (!initRes.ok) {
    const err = await initRes.json();
    setProgress('tt', 0, `Error: ${err.error?.message || 'Auth failed'}`);
    throw new Error('TikTok init failed');
  }

  const { data } = await initRes.json();
  const { publish_id, upload_url } = data;
  setProgress('tt', 5, 'Uploading...');

  // Step 2: Upload the chunk
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', upload_url);
    xhr.setRequestHeader('Content-Range', `bytes 0-${file.size - 1}/${file.size}`);
    xhr.setRequestHeader('Content-Type', 'video/mp4');

    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 90) + 5;
        setProgress('tt', pct, `${pct}%`);
      }
    };

    xhr.onload = async () => {
      if (xhr.status === 200 || xhr.status === 201) {
        setProgress('tt', 100, 'Done ✓');
        resolve(`https://www.tiktok.com/@me/video/${publish_id}`);
      } else {
        setProgress('tt', 0, 'Upload failed');
        reject();
      }
    };

    xhr.onerror = () => { setProgress('tt', 0, 'Network error'); reject(); };
    xhr.send(file);
    window._ttXhr = xhr;
  });
}

// ── Simulate Upload (Demo Mode) ────────────────────────────────
function simulateUpload(platform, url) {
  return new Promise(resolve => {
    let pct = 0;
    const interval = setInterval(() => {
      pct += Math.random() * 12;
      if (pct >= 100) {
        pct = 100;
        clearInterval(interval);
        setProgress(platform, 100, 'Done ✓');
        resolve(url);
      } else {
        setProgress(platform, Math.round(pct), `${Math.round(pct)}%`);
      }
    }, 200);
  });
}

// ── Progress Helpers ──────────────────────────────────────────
function setProgress(platform, pct, statusText) {
  const bar = document.getElementById(`${platform}Bar`);
  const status = document.getElementById(`${platform}Status`);
  if (bar) bar.style.width = `${pct}%`;
  if (status) status.textContent = statusText;
}

function cancelUpload() {
  state.uploading = false;
  if (window._ytXhr) window._ytXhr.abort();
  if (window._ttXhr) window._ttXhr.abort();
  document.getElementById('progressPanel').style.display = 'none';
  document.getElementById('uploaderCard').style.display = 'block';
  toast('Upload cancelled.');
}

// ── Success ───────────────────────────────────────────────────
function showSuccess(results, uploadYT, uploadTT) {
  document.getElementById('progressPanel').style.display = 'none';
  const panel = document.getElementById('successPanel');
  panel.style.display = 'block';

  const linksDiv = document.getElementById('successLinks');
  linksDiv.innerHTML = '';

  if (uploadYT && results.yt) {
    const a = document.createElement('a');
    a.href = results.yt;
    a.target = '_blank';
    a.textContent = '▶ View on YouTube Shorts';
    linksDiv.appendChild(a);
  }
  if (uploadTT && results.tt) {
    const a = document.createElement('a');
    a.href = results.tt;
    a.target = '_blank';
    a.textContent = '♪ View on TikTok';
    linksDiv.appendChild(a);
  }
}

function resetApp() {
  state.file = null;
  state.uploading = false;
  document.getElementById('successPanel').style.display = 'none';
  document.getElementById('uploaderCard').style.display = 'block';
  document.getElementById('videoTitle').value = '';
  document.getElementById('videoDesc').value = '';
  document.getElementById('charCount').textContent = '0';
  clearFile();
  setProgress('yt', 0, 'Waiting...');
  setProgress('tt', 0, 'Waiting...');
}

// ── Toast Notifications ───────────────────────────────────────
let toastTimeout;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { el.classList.remove('show'); }, 3500);
}

// ── Utilities ─────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
