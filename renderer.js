let mediaRecorder;
let audioChunks = [];
let isInterviewing = false;
let isRecording = false;
let whisperTranscribing = false;
let lastTranscript = '';
let stream = null;

const STORAGE_KEY_API = 'cluely-openai-api-key';
const STORAGE_KEY_RESUME = 'cluely-resume-text';

const startBtn = document.getElementById('start-interview');
const stopBtn = document.getElementById('stop-interview');
const answerContainer = document.getElementById('answer-container');
const apiKeyInput = document.getElementById('api-key');
const resumeInput = document.getElementById('resume-text');
const statusIndicator = document.getElementById('status-indicator');
const closeBtn = document.getElementById('close-overlay');
const overlayContainer = document.getElementById('overlay-container');
const controlsSection = document.querySelector('.controls-section');
const micToggleBtn = document.getElementById('mic-toggle');
const micIcon = document.getElementById('mic-icon');
const answerOuter = document.getElementById('answer-outer');

function loadSavedSettings() {
  const savedKey = localStorage.getItem(STORAGE_KEY_API);
  const savedResume = localStorage.getItem(STORAGE_KEY_RESUME);
  if (savedKey) apiKeyInput.value = savedKey;
  if (savedResume) resumeInput.value = savedResume;
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY_API, apiKeyInput.value.trim());
  localStorage.setItem(STORAGE_KEY_RESUME, resumeInput.value.trim());
}

function getSupportedMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4'
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function setStatus(text, highlight) {
  statusIndicator.innerText = text;
  if (highlight === 'recording') {
    statusIndicator.style.color = '#00ff99';
    answerContainer.style.boxShadow = '0 0 0 4px #00ff9955';
  } else if (highlight === 'error') {
    statusIndicator.style.color = '#ff4d4f';
    answerContainer.style.boxShadow = 'none';
  } else {
    statusIndicator.style.color = '#b0b0b0';
    answerContainer.style.boxShadow = 'none';
  }
}

function setMicActive(active) {
  if (active) {
    micToggleBtn.style.background = '#00ff99';
    micIcon.style.color = '#222';
    micIcon.style.opacity = '1';
    micIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="#222" width="18" height="18"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21a1 1 0 1 0 2 0v-2.08A7 7 0 0 0 19 12z"></path></svg>`;
  } else {
    micToggleBtn.style.background = 'rgba(30,30,30,0.7)';
    micIcon.style.color = '#fff';
    micIcon.style.opacity = '0.7';
    micIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="#fff" width="18" height="18"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21a1 1 0 1 0 2 0v-2.08A7 7 0 0 0 19 12z"></path></svg>`;
  }
}

function showAnswerContainer(show) {
  answerOuter.style.display = show ? 'flex' : 'none';
}

async function parseApiError(response) {
  try {
    const data = await response.json();
    return data.error?.message || response.statusText;
  } catch {
    return response.statusText;
  }
}

async function sendToWhisper(blob, apiKey) {
  setStatus('Transcribing...', '');
  const formData = new FormData();
  formData.append('file', blob, 'audio.webm');
  formData.append('model', 'whisper-1');
  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData
    });
    if (!response.ok) {
      const message = await parseApiError(response);
      throw new Error(message);
    }
    const data = await response.json();
    return data.text;
  } catch (err) {
    setStatus('Whisper error: ' + err.message, 'error');
    return '';
  }
}

async function sendToGPT(question, resume, apiKey) {
  setStatus('Getting answer...', '');
  const systemPrompt = `You are helping in a live interview. Use the following resume to answer as if you are the candidate. Ignore any unrelated speech or background talk. Focus on the actual interview question and answer smartly as per the resume.\n\nResume:\n${resume}`;
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question }
        ]
      })
    });
    if (!response.ok) {
      const message = await parseApiError(response);
      throw new Error(message);
    }
    const data = await response.json();
    return data.choices[0].message.content.trim();
  } catch (err) {
    setStatus('GPT error: ' + err.message, 'error');
    return '';
  }
}

async function processAudioChunk(blob) {
  if (whisperTranscribing) return;
  whisperTranscribing = true;
  const apiKey = apiKeyInput.value.trim();
  const resume = resumeInput.value.trim();
  if (!apiKey || !resume) {
    setStatus('Please enter your OpenAI API key and paste your resume.', 'error');
    whisperTranscribing = false;
    return;
  }
  const transcript = await sendToWhisper(blob, apiKey);
  if (transcript && transcript !== lastTranscript) {
    lastTranscript = transcript;
    const answer = await sendToGPT(transcript, resume, apiKey);
    answerContainer.innerText = answer || 'No answer.';
    setStatus('Ready. Press spacebar to record.', '');
  } else if (!transcript) {
    answerContainer.innerText = 'No speech detected.';
    setStatus('Ready. Press spacebar to record.', '');
  }
  whisperTranscribing = false;
}

function startRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    audioChunks = [];
    mediaRecorder.start();
    isRecording = true;
    setStatus('Recording... Click mic or press spacebar to stop.', 'recording');
    setMicActive(true);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    isRecording = false;
    setStatus('Processing...', '');
    setMicActive(false);
  }
}

function handleSpacebar(e) {
  if (!isInterviewing) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!isRecording) startRecording();
    else stopRecording();
  }
}

function stopInterview() {
  isInterviewing = false;
  isRecording = false;
  setStatus('Interview stopped.', '');
  startBtn.style.display = 'inline-block';
  stopBtn.style.display = 'none';
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  window.removeEventListener('keydown', handleSpacebar);
  answerContainer.innerText = 'Interview stopped.';
  controlsSection.style.display = 'flex';
  showAnswerContainer(false);
  setMicActive(false);
  if (window.electronAPI?.setOverlayMode) {
    window.electronAPI.setOverlayMode(false);
  }
}

micToggleBtn.onclick = () => {
  if (!isInterviewing) return;
  if (!isRecording) startRecording();
  else stopRecording();
};

startBtn.onclick = async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('Microphone access not supported.', 'error');
    return;
  }
  const apiKey = apiKeyInput.value.trim();
  const resume = resumeInput.value.trim();
  if (!apiKey || !resume) {
    setStatus('Please enter your OpenAI API key and paste your resume.', 'error');
    return;
  }

  saveSettings();

  const mimeType = getSupportedMimeType();
  if (!mimeType) {
    setStatus('No supported audio format on this device.', 'error');
    return;
  }

  if (window.electronAPI?.setOverlayMode) {
    window.electronAPI.setOverlayMode(true);
  }

  startBtn.style.display = 'none';
  stopBtn.style.display = 'inline-block';
  setStatus('Ready. Press spacebar to record.', '');
  answerContainer.innerText = 'Ask a question...';
  isInterviewing = true;
  lastTranscript = '';
  controlsSection.style.display = 'none';
  showAnswerContainer(true);
  setMicActive(false);

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream, { mimeType });
    audioChunks = [];
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunks.push(event.data);
    };
    mediaRecorder.onstop = async () => {
      if (audioChunks.length > 0 && isInterviewing) {
        const blob = new Blob(audioChunks, { type: mimeType.split(';')[0] });
        audioChunks = [];
        await processAudioChunk(blob);
      }
    };
    window.addEventListener('keydown', handleSpacebar);
  } catch (err) {
    setStatus('Mic error: ' + err.message, 'error');
    stopInterview();
    startBtn.style.display = 'inline-block';
    stopBtn.style.display = 'none';
  }
};

stopBtn.onclick = stopInterview;

closeBtn.onclick = () => {
  if (isInterviewing) stopInterview();
  if (window.electronAPI?.hideWindow) {
    window.electronAPI.hideWindow();
  } else {
    overlayContainer.style.display = 'none';
  }
};

apiKeyInput.addEventListener('change', saveSettings);
resumeInput.addEventListener('change', saveSettings);

loadSavedSettings();
showAnswerContainer(false);
