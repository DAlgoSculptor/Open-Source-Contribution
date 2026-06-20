/**
 * renderer.js – Angel Interview Assistant
 *
 * Flow:
 *  1. User fills in resume + API key → clicks "Start Interview"
 *  2. Mic is acquired; interview panel shown; overlay/click-through mode enabled
 *  3. Press Space (global) or mic button to start/stop a recording
 *  4. Audio → Whisper transcription → GPT answer rendered in the answer box
 *  5. "Stop Interview" restores the setup panel
 */

'use strict';

/* ─────────────────────────────────────────────
   Constants & Supabase Config
───────────────────────────────────────────── */
const STORAGE_API_KEY    = 'angel-api-key';
const STORAGE_RESUME     = 'angel-resume';
const MIN_AUDIO_BYTES    = 800;   // skip near-silent blobs

// Configure your Supabase project here to enable cloud sync SaaS features
const SUPABASE_URL      = 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';

let supabaseClient = null;
try {
  if (window.supabase && SUPABASE_URL !== 'https://your-project.supabase.co') {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
} catch (err) {
  console.error("Supabase failed to initialize:", err);
}

/* ─────────────────────────────────────────────
   DOM refs
───────────────────────────────────────────── */
const setupPanel       = document.getElementById('setup-panel');
const interviewPanel   = document.getElementById('interview-panel');

const resumeInput      = document.getElementById('resume-input');
const apiKeyInput      = document.getElementById('api-key-input');
const toggleKeyVisBtn  = document.getElementById('toggle-key-vis');
const startBtn         = document.getElementById('start-btn');
const setupStatus      = document.getElementById('setup-status');

const answerBox        = document.getElementById('answer-box');
const statusText       = document.getElementById('status-text');
const recordingDot     = document.getElementById('recording-dot');
const micBtn           = document.getElementById('mic-btn');
const micSvg           = document.getElementById('mic-svg');
const stopSvg          = document.getElementById('stop-svg');
const stopBtn          = document.getElementById('stop-btn');

const hideBtnEl        = document.getElementById('hide-btn');
const closeBtnEl       = document.getElementById('close-btn');

// Auth DOM refs
const authCard         = document.getElementById('auth-card');
const authEmail        = document.getElementById('auth-email');
const authPassword     = document.getElementById('auth-password');
const authStatus       = document.getElementById('auth-status');
const authPrimaryBtn   = document.getElementById('auth-primary-btn');
const authToggleBtn    = document.getElementById('auth-toggle-btn');
const authToggleMsg    = document.getElementById('auth-toggle-msg');
const authSubtitle     = document.getElementById('auth-subtitle');
const logoutBtn        = document.getElementById('logout-btn');
const userEmailDisplay = document.getElementById('user-email-display');
const setupCard        = document.getElementById('setup-card');

/* ─────────────────────────────────────────────
   State
───────────────────────────────────────────── */
let mediaRecorder      = null;
let audioStream        = null;
let audioChunks        = [];
let activeMimeType     = '';
let isInterviewing     = false;
let isRecording        = false;
let isBusy             = false;   // true while transcribing / waiting for GPT
let lastTranscript     = '';
let authMode           = 'login'; // 'login' | 'signup'
let currentUser        = null;
let syncTimeout        = null;

/* ─────────────────────────────────────────────
   Persistence & Cloud Sync
───────────────────────────────────────────── */
function loadSettings() {
  const key    = localStorage.getItem(STORAGE_API_KEY) || '';
  const resume = localStorage.getItem(STORAGE_RESUME)  || '';
  if (key)    apiKeyInput.value  = key;
  if (resume) resumeInput.value  = resume;
}

function saveSettings() {
  localStorage.setItem(STORAGE_API_KEY, apiKeyInput.value.trim());
  localStorage.setItem(STORAGE_RESUME,  resumeInput.value.trim());
}

async function syncProfileToCloud() {
  if (!supabaseClient || !currentUser) return;
  try {
    const key = apiKeyInput.value.trim();
    const resume = resumeInput.value.trim();
    
    await supabaseClient.from('profiles').upsert({
      id: currentUser.id,
      resume: resume,
      openai_key: key,
      updated_at: new Date()
    });
  } catch (err) {
    console.error("Cloud sync failed:", err);
  }
}

function queueProfileSync() {
  saveSettings();
  if (!supabaseClient || !currentUser) return;
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(syncProfileToCloud, 1200);
}

async function loadCloudProfile(userId) {
  try {
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('resume, openai_key')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      if (data.openai_key) apiKeyInput.value = data.openai_key;
      if (data.resume) resumeInput.value = data.resume;
      saveSettings();
    } else {
      await supabaseClient.from('profiles').insert({
        id: userId,
        resume: resumeInput.value.trim(),
        openai_key: apiKeyInput.value.trim(),
        updated_at: new Date()
      });
    }
  } catch (err) {
    console.error("Error loading cloud profile:", err);
  }
}

async function handleAuthAction() {
  const email = authEmail.value.trim();
  const password = authPassword.value.trim();

  if (!email || !password) {
    setAuthStatus("Please fill in email and password.", true);
    return;
  }

  clearAuthStatus();
  authPrimaryBtn.disabled = true;
  authPrimaryBtn.textContent = authMode === 'login' ? 'Logging in…' : 'Signing up…';

  try {
    if (authMode === 'login') {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const { data, error } = await supabaseClient.auth.signUp({ email, password });
      if (error) throw error;

      if (data.user && !data.session) {
        setAuthStatus("Check your email for confirmation link!", false);
        authPrimaryBtn.textContent = 'Check Email';
        return;
      }
    }
  } catch (err) {
    setAuthStatus(err.message, true);
    authPrimaryBtn.disabled = false;
    authPrimaryBtn.textContent = authMode === 'login' ? 'Log In' : 'Sign Up';
  }
}

async function handleLogout() {
  if (supabaseClient) {
    await supabaseClient.auth.signOut();
  }
}

async function initAuth() {
  if (!supabaseClient) {
    // Guest offline mode
    authCard.style.display = 'none';
    setupCard.style.display = 'block';
    userEmailDisplay.textContent = 'Guest Mode (No Sync)';
    logoutBtn.style.display = 'none';
    loadSettings();
    return;
  }

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      currentUser = session.user;
      userEmailDisplay.textContent = currentUser.email;
      logoutBtn.style.display = 'inline-block';
      authCard.style.display = 'none';
      setupCard.style.display = 'block';
      await loadCloudProfile(currentUser.id);
    } else {
      currentUser = null;
      userEmailDisplay.textContent = '';
      setupCard.style.display = 'none';
      authCard.style.display = 'block';
      authPrimaryBtn.disabled = false;
      authPrimaryBtn.textContent = authMode === 'login' ? 'Log In' : 'Sign Up';
      loadSettings();
    }
  });
}

/* ─────────────────────────────────────────────
   UI helpers
───────────────────────────────────────────── */
function setSetupError(msg) {
  setupStatus.style.color = '#ff6b6b';
  setupStatus.textContent = msg;
}
function clearSetupStatus() {
  setupStatus.textContent = '';
}

function setAuthStatus(msg, isError = true) {
  authStatus.style.color = isError ? '#ff6b6b' : '#64ffa0';
  authStatus.textContent = msg;
}
function clearAuthStatus() {
  authStatus.textContent = '';
}

function setStatus(msg, state /* 'idle'|'recording'|'thinking'|'error' */ = 'idle') {
  statusText.textContent = msg;

  // Dot
  recordingDot.classList.toggle('active', state === 'recording');

  // Answer box highlight
  answerBox.classList.remove('recording', 'thinking');
  if (state === 'recording') answerBox.classList.add('recording');
  if (state === 'thinking')  answerBox.classList.add('thinking');

  // Status text colour
  if (state === 'error')     statusText.style.color = '#ff6b6b';
  else if (state === 'recording') statusText.style.color = '#64ffa0';
  else                       statusText.style.color = '#9090bb';
}

function setMicRecording(active) {
  micBtn.classList.toggle('active', active);
  micSvg.style.display  = active ? 'none'  : 'block';
  stopSvg.style.display = active ? 'block' : 'none';
}

function showSetupPanel() {
  setupPanel.style.display        = 'flex';
  interviewPanel.style.display    = 'none';
}

function showInterviewPanel() {
  setupPanel.style.display        = 'none';
  interviewPanel.style.display    = 'flex';
}

function toggleAuthMode() {
  authMode = authMode === 'login' ? 'signup' : 'login';
  clearAuthStatus();
  if (authMode === 'login') {
    authSubtitle.textContent = 'Log in to sync your resume and API key securely to the cloud.';
    authPrimaryBtn.textContent = 'Log In';
    authToggleMsg.textContent = "Don't have an account?";
    authToggleBtn.textContent = 'Sign Up';
  } else {
    authSubtitle.textContent = 'Create an account to start syncing your profile to the cloud.';
    authPrimaryBtn.textContent = 'Sign Up';
    authToggleMsg.textContent = 'Already have an account?';
    authToggleBtn.textContent = 'Log In';
  }
}

/** Render content inside the answer box */
function renderAnswer(question, answer) {
  answerBox.innerHTML = '';

  if (question) {
    const qLabel = document.createElement('div');
    qLabel.className   = 'q-label';
    qLabel.textContent = 'Question';
    answerBox.appendChild(qLabel);

    const qText = document.createElement('div');
    qText.className   = 'answer-text';
    qText.style.color = '#8888cc';
    qText.style.marginBottom = '14px';
    qText.style.fontSize     = '0.9rem';
    qText.textContent = question;
    answerBox.appendChild(qText);

    const divider = document.createElement('hr');
    divider.style.cssText = 'border:none;border-top:1px solid rgba(255,255,255,0.07);margin:0 0 12px';
    answerBox.appendChild(divider);
  }

  const aText = document.createElement('div');
  aText.className   = 'answer-text';
  aText.textContent = answer;
  answerBox.appendChild(aText);

  // Scroll to top
  answerBox.scrollTop = 0;
}

function renderPlaceholder(msg) {
  answerBox.innerHTML = `<div class="answer-placeholder">${msg}</div>`;
}

function renderThinking(msg) {
  answerBox.innerHTML = `<div class="answer-placeholder"><span class="spinner"></span>${msg}</div>`;
}

/* ─────────────────────────────────────────────
   Audio helpers
───────────────────────────────────────────── */
function getSupportedMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4'
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function mimeToExtension(mimeType) {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'mp4';
  return 'webm';
}

/* ─────────────────────────────────────────────
   OpenAI API calls
───────────────────────────────────────────── */
async function extractErrorMessage(response) {
  try {
    const data = await response.json();
    return data?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
  } catch {
    return `HTTP ${response.status}: ${response.statusText}`;
  }
}

async function transcribeAudio(blob, apiKey) {
  const ext      = mimeToExtension(activeMimeType);
  const formData = new FormData();
  formData.append('file', blob, `recording.${ext}`);
  formData.append('model', 'whisper-1');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method:  'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body:    formData
  });

  if (!response.ok) {
    const msg = await extractErrorMessage(response);
    throw new Error(`Whisper: ${msg}`);
  }

  const data = await response.json();
  return (data.text || '').trim();
}

async function getGptAnswer(question, resume, apiKey) {
  const systemPrompt =
    `You are assisting a candidate during a live developer interview. ` +
    `Answer as the candidate, answering questions concisely, confidently, and naturally as if speaking aloud. ` +
    `Integrate relevant skills, experiences, and details from their resume below when appropriate. ` +
    `If the question is a general technical, behavioral, or coding question, provide a correct, professional, and accurate explanation ` +
    `from the perspective of a developer with this background. Do not mention that you are referencing a resume or say "Based on my resume".\n\n` +
    `Resume:\n${resume}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model:       'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: question }
      ],
      temperature: 0.65,
      max_tokens:  600
    })
  });

  if (!response.ok) {
    const msg = await extractErrorMessage(response);
    throw new Error(`GPT: ${msg}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

/* ─────────────────────────────────────────────
   Core pipeline: audio blob → answer
───────────────────────────────────────────── */
async function processAudioBlob(blob) {
  if (isBusy) return;
  isBusy = true;

  const apiKey = apiKeyInput.value.trim();
  const resume = resumeInput.value.trim();

  if (!apiKey || !resume) {
    setStatus('Missing API key or resume — stop and fill them in.', 'error');
    isBusy = false;
    return;
  }

  if (blob.size < MIN_AUDIO_BYTES) {
    setStatus('Recording too short — hold Space a bit longer.', 'error');
    isBusy = false;
    return;
  }

  try {
    // 1. Transcribe
    setStatus('Transcribing…', 'thinking');
    renderThinking('Transcribing audio…');

    const transcript = await transcribeAudio(blob, apiKey);

    if (!transcript) {
      setStatus('No speech detected — try again.', 'error');
      renderPlaceholder('No speech detected. Try recording again.');
      isBusy = false;
      return;
    }

    if (transcript === lastTranscript) {
      setStatus('Same question detected — ask something new.', 'idle');
      isBusy = false;
      return;
    }

    lastTranscript = transcript;

    // 2. Get GPT answer
    setStatus('Thinking…', 'thinking');
    renderThinking('Generating answer…');

    const answer = await getGptAnswer(transcript, resume, apiKey);

    renderAnswer(transcript, answer || '(No answer generated)');
    setStatus('Ready — press Space or mic button to record.', 'idle');

  } catch (err) {
    setStatus(err.message, 'error');
    renderPlaceholder(`⚠ ${err.message}`);
  }

  isBusy = false;
}

/* ─────────────────────────────────────────────
   Recording control
───────────────────────────────────────────── */
function startRecording() {
  if (!isInterviewing || !mediaRecorder || mediaRecorder.state !== 'inactive' || isBusy) return;
  audioChunks = [];
  mediaRecorder.start();
  isRecording = true;
  setStatus('Recording… press Space or mic button to stop.', 'recording');
  setMicRecording(true);
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
  mediaRecorder.stop();
  isRecording = false;
  setMicRecording(false);
  setStatus('Processing…', 'thinking');
}

function toggleRecording() {
  if (!isInterviewing || isBusy) return;
  if (isRecording) stopRecording();
  else             startRecording();
}

/* ─────────────────────────────────────────────
   Start / Stop Interview
───────────────────────────────────────────── */
async function startInterview() {
  const apiKey = apiKeyInput.value.trim();
  const resume = resumeInput.value.trim();

  if (!apiKey) { setSetupError('Please enter your OpenAI API key.'); return; }
  if (!resume) { setSetupError('Please paste your resume.'); return; }

  if (!navigator.mediaDevices?.getUserMedia) {
    setSetupError('Microphone access is not supported in this environment.');
    return;
  }

  activeMimeType = getSupportedMimeType();
  if (!activeMimeType) {
    setSetupError('No supported audio recording format found on this device.');
    return;
  }

  clearSetupStatus();
  startBtn.disabled = true;
  startBtn.textContent = 'Starting…';

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl:  true,
        sampleRate:       16000
      }
    });
  } catch (err) {
    setSetupError(`Microphone error: ${err.message}`);
    startBtn.disabled  = false;
    startBtn.textContent = '▶ Start Interview';
    return;
  }

  saveSettings();

  mediaRecorder = new MediaRecorder(audioStream, { mimeType: activeMimeType });
  audioChunks   = [];

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    if (!isInterviewing) return;
    if (audioChunks.length > 0) {
      const blob = new Blob(audioChunks, { type: activeMimeType.split(';')[0] });
      audioChunks = [];
      await processAudioBlob(blob);
    }
  };

  mediaRecorder.onerror = (e) => {
    setStatus(`Recording error: ${e.error?.message || 'unknown'}`, 'error');
    isRecording = false;
    setMicRecording(false);
  };

  isInterviewing = true;
  lastTranscript = '';
  isBusy         = false;

  showInterviewPanel();
  renderPlaceholder('Listening for questions…');
  setStatus('Ready — press Space or mic button to record.', 'idle');

  // Tell main process to enter interview / overlay mode
  window.electronAPI?.setInterviewMode(true);

  startBtn.disabled    = false;
  startBtn.textContent = '▶ Start Interview';
}

function stopInterview() {
  isInterviewing = false;
  isBusy         = false;
  lastIgnoreState = null;

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch (_) {}
  }
  if (audioStream) {
    audioStream.getTracks().forEach((t) => t.stop());
    audioStream = null;
  }

  mediaRecorder = null;
  isRecording   = false;
  setMicRecording(false);

  // Tell main process to leave interview / overlay mode
  window.electronAPI?.setInterviewMode(false);

  showSetupPanel();
}

/* ─────────────────────────────────────────────
   Event listeners
───────────────────────────────────────────── */
let lastIgnoreState = null;
function setIgnoreMouse(ignore) {
  if (lastIgnoreState === ignore) return;
  lastIgnoreState = ignore;
  window.electronAPI?.setOverlayMode(ignore);
}

// Mouse move listener to toggle ignore mouse events dynamically
window.addEventListener('mousemove', (e) => {
  if (!isInterviewing) {
    setIgnoreMouse(false);
    return;
  }
  const isInteractive = e.target.closest('button, input, textarea, a, [role="button"]') || 
                        e.target.closest('#answer-box') || 
                        e.target.closest('#interview-statusbar') ||
                        e.target.closest('#bottom-bar') ||
                        e.target.closest('.corner-btn');
  setIgnoreMouse(!isInteractive);
});

// Local spacebar listener when window is focused
window.addEventListener('keydown', (e) => {
  if (!isInterviewing) return;
  if (e.code === 'Space') {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
      return;
    }
    e.preventDefault();
    toggleRecording();
  }
});

startBtn.addEventListener('click', startInterview);
stopBtn.addEventListener('click',  stopInterview);
micBtn.addEventListener('click',   toggleRecording);

hideBtnEl.addEventListener('click', () => {
  window.electronAPI?.hideWindow();
});

closeBtnEl.addEventListener('click', () => {
  if (isInterviewing) stopInterview();
  window.electronAPI?.quitApp();
});

toggleKeyVisBtn.addEventListener('click', () => {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type         = isPassword ? 'text' : 'password';
  toggleKeyVisBtn.textContent = isPassword ? 'Hide' : 'Show';
});

// Auth button actions
authPrimaryBtn.addEventListener('click', handleAuthAction);
authToggleBtn.addEventListener('click',  toggleAuthMode);
logoutBtn.addEventListener('click',      handleLogout);

// Persist and sync on change
apiKeyInput.addEventListener('input', queueProfileSync);
resumeInput.addEventListener('input', queueProfileSync);

// Global recording shortcut from main process
window.electronAPI?.onToggleRecording(() => toggleRecording());

/* ─────────────────────────────────────────────
   Init
───────────────────────────────────────────── */
initAuth();
showSetupPanel();
