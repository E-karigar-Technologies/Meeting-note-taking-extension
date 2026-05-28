/**
 * Meeting Note Taker — Recorder Page (Full Tab)
 * ──────────────────────────────────────────────
 * Runs in a full browser tab so getDisplayMedia works properly.
 * Records screen + system audio + microphone,
 * provides download (audio/video/both),
 * transcription via Deepgram (with speaker diarization),
 * and meeting summary via OpenAI.
 */

// ═══════════════════════════════════════════
//  DOM Elements
// ═══════════════════════════════════════════

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Sections
const sectionIdle = $('#sectionIdle');
const sectionRecording = $('#sectionRecording');
const sectionReview = $('#sectionReview');
const settingsPanel = $('#settingsPanel');

// Buttons
const btnStartRecording = $('#btnStartRecording');
const btnStopRecording = $('#btnStopRecording');
const btnDownload = $('#btnDownload');
const btnTranscribe = $('#btnTranscribe');
const btnEndSession = $('#btnEndSession');
const btnSettings = $('#btnSettings');
const btnSettingsBack = $('#btnSettingsBack');
const btnSaveSettings = $('#btnSaveSettings');
const btnStartTranscribe = $('#btnStartTranscribe');
const btnCopyTranscript = $('#btnCopyTranscript');
const btnCopySummary = $('#btnCopySummary');

// Modals
const downloadModal = $('#downloadModal');
const transcribeModal = $('#transcribeModal');
const btnCloseDownload = $('#btnCloseDownload');
const btnCloseTranscribe = $('#btnCloseTranscribe');

// Inputs
const inputDeepgramKey = $('#inputDeepgramKey');
const inputOpenaiKey = $('#inputOpenaiKey');
const selectLanguage = $('#selectLanguage');

// Display elements
const recordingTimer = $('#recordingTimer');
const reviewDuration = $('#reviewDuration');
const resultsContainer = $('#resultsContainer');
const transcriptContent = $('#transcriptContent');
const summaryContent = $('#summaryContent');
const processingIndicator = $('#processingIndicator');
const processingText = $('#processingText');
const processingSubtext = $('#processingSubtext');
const transcribeApiWarning = $('#transcribeApiWarning');
const linkGoSettings = $('#linkGoSettings');
const toastEl = $('#toast');

// Result card toggles
const transcriptToggle = $('#transcriptToggle');
const summaryToggle = $('#summaryToggle');
const transcriptCard = $('#transcriptCard');
const summaryCard = $('#summaryCard');

// ═══════════════════════════════════════════
//  State
// ═══════════════════════════════════════════

let currentState = 'idle'; // idle | recording | review
let displayStream = null;
let micStream = null;
let videoRecorder = null;
let audioRecorder = null;
let videoChunks = [];
let audioChunks = [];
let videoBlob = null;
let audioBlob = null;
let timerInterval = null;
let recordingStartTime = null;
let recordingDuration = 0;
let rawTranscriptText = '';
let rawSummaryText = '';
let originalTitle = document.title;

// ═══════════════════════════════════════════
//  API Keys (persisted in chrome.storage)
// ═══════════════════════════════════════════

let deepgramApiKey = '';
let openaiApiKey = '';

async function loadApiKeys() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const result = await chrome.storage.local.get(['deepgramApiKey', 'openaiApiKey']);
      deepgramApiKey = result.deepgramApiKey || '';
      openaiApiKey = result.openaiApiKey || '';
    } else {
      deepgramApiKey = localStorage.getItem('deepgramApiKey') || '';
      openaiApiKey = localStorage.getItem('openaiApiKey') || '';
    }
  } catch (e) {
    console.warn('Failed to load API keys:', e);
  }
  inputDeepgramKey.value = deepgramApiKey;
  inputOpenaiKey.value = openaiApiKey;
}

async function saveApiKeys() {
  deepgramApiKey = inputDeepgramKey.value.trim();
  openaiApiKey = inputOpenaiKey.value.trim();
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ deepgramApiKey, openaiApiKey });
    } else {
      localStorage.setItem('deepgramApiKey', deepgramApiKey);
      localStorage.setItem('openaiApiKey', openaiApiKey);
    }
  } catch (e) {
    console.warn('Failed to save API keys:', e);
  }
}

// ═══════════════════════════════════════════
//  UI Helpers
// ═══════════════════════════════════════════

function switchSection(target) {
  [sectionIdle, sectionRecording, sectionReview].forEach(s => s.classList.remove('active'));
  settingsPanel.classList.remove('active');
  target.classList.add('active');
}

function showSettings() {
  [sectionIdle, sectionRecording, sectionReview].forEach(s => s.classList.remove('active'));
  settingsPanel.classList.add('active');
}

function hideSettings() {
  settingsPanel.classList.remove('active');
  if (currentState === 'idle') switchSection(sectionIdle);
  else if (currentState === 'recording') switchSection(sectionRecording);
  else if (currentState === 'review') switchSection(sectionReview);
}

function showModal(modal) {
  modal.classList.add('active');
}

function hideModal(modal) {
  modal.classList.remove('active');
}

function showToast(message, type = 'success') {
  toastEl.textContent = message;
  toastEl.className = `toast ${type}`;
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2500);
}

function formatTime(seconds) {
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function updateTabTitle(text) {
  document.title = text;
}

// ═══════════════════════════════════════════
//  RECORDING
// ═══════════════════════════════════════════

async function startRecording() {
  try {
    // 1. Get display media (screen + system audio)
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'monitor',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        sampleRate: 48000
      }
    });

    // 2. Get microphone
    let micAcquired = false;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000
        }
      });
      micAcquired = true;
    } catch (micErr) {
      console.warn('Microphone access denied, continuing without mic:', micErr);
      showToast('Recording without microphone', 'info');
    }

    // 3. Mix all audio tracks into one
    const audioCtx = new AudioContext({ sampleRate: 48000 });
    const destination = audioCtx.createMediaStreamDestination();

    // Add system audio tracks (from display capture)
    const displayAudioTracks = displayStream.getAudioTracks();
    let hasAnyAudio = false;

    if (displayAudioTracks.length > 0) {
      const systemSource = audioCtx.createMediaStreamSource(
        new MediaStream(displayAudioTracks)
      );
      systemSource.connect(destination);
      hasAnyAudio = true;
    }

    // Add microphone track
    if (micStream) {
      const micSource = audioCtx.createMediaStreamSource(micStream);
      micSource.connect(destination);
      hasAnyAudio = true;
    }

    if (!hasAnyAudio) {
      showToast('Warning: No audio sources available. Enable system audio sharing or mic.', 'error');
    }

    // 4. Create combined streams
    const combinedAudioStream = destination.stream;

    // Video stream = screen video + combined audio
    const videoStream = new MediaStream([
      ...displayStream.getVideoTracks(),
      ...combinedAudioStream.getAudioTracks()
    ]);

    // 5. Create MediaRecorders
    const videoMimeType = getVideoMimeType();
    const audioMimeType = getAudioMimeType();

    videoChunks = [];
    audioChunks = [];

    videoRecorder = new MediaRecorder(videoStream, {
      mimeType: videoMimeType,
      videoBitsPerSecond: 2500000
    });

    audioRecorder = new MediaRecorder(combinedAudioStream, {
      mimeType: audioMimeType,
      audioBitsPerSecond: 128000
    });

    videoRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) videoChunks.push(e.data);
    };

    audioRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunks.push(e.data);
    };

    // Handle user clicking "Stop sharing" in browser UI
    displayStream.getVideoTracks()[0].onended = () => {
      if (currentState === 'recording') {
        stopRecording();
      }
    };

    // 6. Start recording
    videoRecorder.start(1000);
    audioRecorder.start(1000);

    // 7. Start timer
    recordingStartTime = Date.now();
    recordingDuration = 0;
    recordingTimer.textContent = '00:00:00';
    timerInterval = setInterval(() => {
      recordingDuration = Math.floor((Date.now() - recordingStartTime) / 1000);
      recordingTimer.textContent = formatTime(recordingDuration);
      updateTabTitle(`🔴 ${formatTime(recordingDuration)} — Recording`);
    }, 1000);

    // 8. Switch to recording UI
    currentState = 'recording';
    switchSection(sectionRecording);
    updateTabTitle('🔴 Recording...');

    // Warn before closing tab
    window.onbeforeunload = (e) => {
      if (currentState === 'recording') {
        e.preventDefault();
        e.returnValue = '';
      }
    };

  } catch (err) {
    console.error('Failed to start recording:', err);
    if (err.name === 'NotAllowedError') {
      showToast('Permission denied. Please allow screen sharing.', 'error');
    } else {
      showToast('Failed to start recording: ' + err.message, 'error');
    }
    cleanupStreams();
  }
}

function stopRecording() {
  return new Promise((resolve) => {
    clearInterval(timerInterval);
    timerInterval = null;
    window.onbeforeunload = null;

    let stoppedCount = 0;
    const totalToStop = 2;
    const videoMime = getVideoMimeType();
    const audioMime = getAudioMimeType();

    function checkDone() {
      stoppedCount++;
      if (stoppedCount >= totalToStop) {
        cleanupStreams();
        currentState = 'review';
        reviewDuration.textContent = formatDuration(recordingDuration);
        resultsContainer.style.display = 'none';
        processingIndicator.style.display = 'none';
        switchSection(sectionReview);
        updateTabTitle('✅ Recording Complete — Meeting Note Taker');
        showToast('Recording saved successfully!');
        resolve();
      }
    }

    if (videoRecorder && videoRecorder.state !== 'inactive') {
      videoRecorder.onstop = () => {
        videoBlob = new Blob(videoChunks, { type: videoMime });
        checkDone();
      };
      videoRecorder.stop();
    } else {
      checkDone();
    }

    if (audioRecorder && audioRecorder.state !== 'inactive') {
      audioRecorder.onstop = () => {
        audioBlob = new Blob(audioChunks, { type: audioMime });
        checkDone();
      };
      audioRecorder.stop();
    } else {
      checkDone();
    }
  });
}

function cleanupStreams() {
  if (displayStream) {
    displayStream.getTracks().forEach(t => t.stop());
    displayStream = null;
  }
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
}

function getVideoMimeType() {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
}

function getAudioMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus'
  ];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || 'audio/webm';
}

// ═══════════════════════════════════════════
//  DOWNLOAD
// ═══════════════════════════════════════════

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function handleDownload(type) {
  const ts = getTimestamp();
  if (type === 'audio' || type === 'both') {
    if (audioBlob) {
      downloadBlob(audioBlob, `meeting-audio-${ts}.webm`);
    } else {
      showToast('No audio recording available', 'error');
      return;
    }
  }
  if (type === 'video' || type === 'both') {
    if (videoBlob) {
      downloadBlob(videoBlob, `meeting-video-${ts}.webm`);
    } else {
      showToast('No video recording available', 'error');
      return;
    }
  }
  showToast(type === 'both' ? 'Downloads started!' : `${type.charAt(0).toUpperCase() + type.slice(1)} download started!`);
  hideModal(downloadModal);
}

// ═══════════════════════════════════════════
//  TRANSCRIPTION (Deepgram + OpenAI)
// ═══════════════════════════════════════════

async function transcribeAndSummarize() {
  if (!deepgramApiKey) {
    showToast('Deepgram API key is required', 'error');
    return;
  }
  if (!openaiApiKey) {
    showToast('OpenAI API key is required', 'error');
    return;
  }
  if (!audioBlob) {
    showToast('No audio recording available', 'error');
    return;
  }

  hideModal(transcribeModal);

  // Show processing UI
  processingIndicator.style.display = 'flex';
  resultsContainer.style.display = 'none';
  processingText.textContent = 'Transcribing audio with Deepgram...';
  processingSubtext.textContent = 'Using Nova-2 model with speaker detection';
  updateTabTitle('⏳ Transcribing... — Meeting Note Taker');

  const language = selectLanguage.value;

  try {
    // ── Step 1: Send to Deepgram ──
    const dgUrl = `https://api.deepgram.com/v1/listen?model=nova-2&diarize=true&punctuate=true&paragraphs=true&smart_format=true&language=${language}`;

    const dgResponse = await fetch(dgUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${deepgramApiKey}`,
        'Content-Type': audioBlob.type || 'audio/webm'
      },
      body: audioBlob
    });

    if (!dgResponse.ok) {
      const errText = await dgResponse.text();
      throw new Error(`Deepgram API error (${dgResponse.status}): ${errText}`);
    }

    const dgData = await dgResponse.json();

    // ── Step 2: Format transcript with speaker labels ──
    const transcript = formatDeepgramTranscript(dgData);
    rawTranscriptText = getPlainTranscript(dgData);
    transcriptContent.innerHTML = transcript;

    // ── Step 3: Send transcript to OpenAI for summary ──
    processingText.textContent = 'Generating meeting summary with AI...';
    processingSubtext.textContent = 'Extracting key points, decisions, and action items';
    updateTabTitle('⏳ Summarizing... — Meeting Note Taker');

    const summary = await generateSummary(rawTranscriptText);
    rawSummaryText = summary;
    summaryContent.innerHTML = formatSummaryHtml(summary);

    // ── Step 4: Show results ──
    processingIndicator.style.display = 'none';
    resultsContainer.style.display = 'block';

    transcriptCard.classList.add('expanded');
    summaryCard.classList.add('expanded');

    updateTabTitle('✅ Done — Meeting Note Taker');
    showToast('Transcription & summary complete!');

  } catch (err) {
    console.error('Transcription failed:', err);
    processingIndicator.style.display = 'none';
    updateTabTitle('❌ Error — Meeting Note Taker');
    showToast('Transcription failed: ' + err.message, 'error');
  }
}

function formatDeepgramTranscript(data) {
  try {
    const words = data.results?.channels?.[0]?.alternatives?.[0]?.words || [];
    if (words.length === 0) {
      const plainText = data.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
      return `<p>${escapeHtml(plainText) || 'No speech detected in the recording.'}</p>`;
    }

    let html = '';
    let currentSpeaker = null;
    let currentText = '';

    for (const word of words) {
      const speaker = word.speaker ?? 0;
      if (speaker !== currentSpeaker) {
        if (currentText) {
          html += `${escapeHtml(currentText.trim())}<br>`;
        }
        currentSpeaker = speaker;
        currentText = '';
        html += `<span class="speaker-label speaker-${speaker % 6}">Speaker ${speaker + 1}</span> `;
      }
      currentText += word.punctuated_word || word.word;
      currentText += ' ';
    }
    if (currentText) {
      html += `${escapeHtml(currentText.trim())}`;
    }

    return html || '<p>No speech detected.</p>';
  } catch (e) {
    console.error('Error formatting transcript:', e);
    const fallback = data.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
    return `<p>${escapeHtml(fallback) || 'Error formatting transcript.'}</p>`;
  }
}

function getPlainTranscript(data) {
  try {
    const words = data.results?.channels?.[0]?.alternatives?.[0]?.words || [];
    if (words.length === 0) {
      return data.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
    }

    let text = '';
    let currentSpeaker = null;

    for (const word of words) {
      const speaker = word.speaker ?? 0;
      if (speaker !== currentSpeaker) {
        if (text) text += '\n';
        currentSpeaker = speaker;
        text += `\nSpeaker ${speaker + 1}: `;
      }
      text += (word.punctuated_word || word.word) + ' ';
    }

    return text.trim();
  } catch (e) {
    return data.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
  }
}

async function generateSummary(transcript) {
  const systemPrompt = `You are an expert meeting analyst. Analyze the following meeting transcript and provide a comprehensive summary. Format your response in markdown with these sections:

### 📋 Meeting Overview
A brief 2-3 sentence summary of what the meeting was about.

### 🎯 Key Discussion Points
- List the main topics discussed in bullet points

### ✅ Decisions Made
- List any decisions that were made during the meeting

### 📌 Action Items
- List specific action items, including who is responsible if mentioned
- Format: [Person] - [Task] - [Deadline if mentioned]

### 💡 Key Insights
- Any important insights, observations, or notable quotes

### ⏭️ Follow-ups
- Any items that need follow-up or were deferred

If any section has no relevant content, skip it. Be concise but thorough.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Here is the meeting transcript:\n\n${transcript}` }
      ],
      temperature: 0.3,
      max_tokens: 2000
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'No summary generated.';
}

function formatSummaryHtml(markdown) {
  let html = escapeHtml(markdown);
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  if (!html.startsWith('<')) html = `<p>${html}</p>`;
  return html;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ═══════════════════════════════════════════
//  SESSION END
// ═══════════════════════════════════════════

function endSession() {
  videoChunks = [];
  audioChunks = [];
  videoBlob = null;
  audioBlob = null;
  rawTranscriptText = '';
  rawSummaryText = '';

  recordingTimer.textContent = '00:00:00';
  reviewDuration.textContent = '00:00';
  transcriptContent.innerHTML = '';
  summaryContent.innerHTML = '';
  resultsContainer.style.display = 'none';
  processingIndicator.style.display = 'none';

  cleanupStreams();
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  window.onbeforeunload = null;

  currentState = 'idle';
  switchSection(sectionIdle);
  updateTabTitle(originalTitle);
  showToast('Session ended. All data cleared.', 'info');
}

// ═══════════════════════════════════════════
//  CLIPBOARD
// ═══════════════════════════════════════════

async function copyToClipboard(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${label} copied to clipboard!`);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast(`${label} copied to clipboard!`);
  }
}

// ═══════════════════════════════════════════
//  EVENT LISTENERS
// ═══════════════════════════════════════════

btnStartRecording.addEventListener('click', startRecording);
btnStopRecording.addEventListener('click', stopRecording);

// Download
btnDownload.addEventListener('click', () => showModal(downloadModal));
btnCloseDownload.addEventListener('click', () => hideModal(downloadModal));
downloadModal.addEventListener('click', (e) => {
  if (e.target === downloadModal) hideModal(downloadModal);
});

$$('.download-option').forEach(opt => {
  opt.addEventListener('click', () => handleDownload(opt.dataset.type));
});

// Transcribe
btnTranscribe.addEventListener('click', () => {
  if (!deepgramApiKey || !openaiApiKey) {
    transcribeApiWarning.style.display = 'flex';
  } else {
    transcribeApiWarning.style.display = 'none';
  }
  showModal(transcribeModal);
});
btnCloseTranscribe.addEventListener('click', () => hideModal(transcribeModal));
transcribeModal.addEventListener('click', (e) => {
  if (e.target === transcribeModal) hideModal(transcribeModal);
});
btnStartTranscribe.addEventListener('click', transcribeAndSummarize);

linkGoSettings.addEventListener('click', () => {
  hideModal(transcribeModal);
  showSettings();
});

// Session end
btnEndSession.addEventListener('click', () => {
  if (confirm('End this session? All recording data will be permanently cleared.')) {
    endSession();
  }
});

// Settings
btnSettings.addEventListener('click', showSettings);
btnSettingsBack.addEventListener('click', hideSettings);
btnSaveSettings.addEventListener('click', async () => {
  await saveApiKeys();
  showToast('Settings saved successfully!');
  hideSettings();
});

// Result card toggles
transcriptToggle.addEventListener('click', () => transcriptCard.classList.toggle('expanded'));
summaryToggle.addEventListener('click', () => summaryCard.classList.toggle('expanded'));

// Copy buttons
btnCopyTranscript.addEventListener('click', (e) => {
  e.stopPropagation();
  copyToClipboard(rawTranscriptText, 'Transcript');
});
btnCopySummary.addEventListener('click', (e) => {
  e.stopPropagation();
  copyToClipboard(rawSummaryText, 'Summary');
});

// ═══════════════════════════════════════════
//  INITIALIZATION
// ═══════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  await loadApiKeys();
});
