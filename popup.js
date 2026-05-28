/**
 * Meeting Note Taker — Popup (Launcher + Settings)
 * ─────────────────────────────────────────────────
 * The popup serves as a launcher that opens the full
 * recorder page in a new tab (required for getDisplayMedia),
 * and provides access to API key settings.
 */

const $ = (sel) => document.querySelector(sel);

// Elements
const sectionLauncher = $('#sectionLauncher');
const settingsPanel = $('#settingsPanel');
const btnOpenRecorder = $('#btnOpenRecorder');
const btnSettings = $('#btnSettings');
const btnSettingsBack = $('#btnSettingsBack');
const btnSaveSettings = $('#btnSaveSettings');
const inputDeepgramKey = $('#inputDeepgramKey');
const inputOpenaiKey = $('#inputOpenaiKey');
const toastEl = $('#toast');

// ── API Keys ──

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

// ── UI ──

function showToast(message, type = 'success') {
  toastEl.textContent = message;
  toastEl.className = `toast ${type}`;
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2500);
}

function showSettings() {
  sectionLauncher.classList.remove('active');
  settingsPanel.classList.add('active');
}

function hideSettings() {
  settingsPanel.classList.remove('active');
  sectionLauncher.classList.add('active');
}

// ── Event Listeners ──

btnOpenRecorder.addEventListener('click', () => {
  // Open the recorder page in a new tab
  const recorderUrl = chrome.runtime.getURL('recorder.html');
  chrome.tabs.create({ url: recorderUrl });
  // Close the popup
  window.close();
});

btnSettings.addEventListener('click', showSettings);
btnSettingsBack.addEventListener('click', hideSettings);

btnSaveSettings.addEventListener('click', async () => {
  await saveApiKeys();
  showToast('Settings saved!');
  setTimeout(hideSettings, 800);
});

// ── Init ──

document.addEventListener('DOMContentLoaded', async () => {
  await loadApiKeys();
});
