const RELEASE_BASE = 'https://github.com/LovaRK/telemetry-governance-ai/releases/download/v1.3.0';
const DOWNLOADS = {
  windows: `${RELEASE_BASE}/datasensAI-installer-windows-v1.3.0.zip`,
  mac:     `${RELEASE_BASE}/datasensAI-installer-mac-v1.3.0.zip`,
};

// ── OS detection ──
function detectOS() {
  const ua = navigator.userAgent;
  const platform = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  if (/win/i.test(platform) || /windows/i.test(ua)) return 'windows';
  if (/mac/i.test(platform) || /macintosh|mac os x/i.test(ua)) return 'mac';
  return 'unknown';
}

// ── Show the right block and set download links ──
function applyOS(os) {
  const pill   = document.getElementById('os-pill');
  const icon   = document.getElementById('os-icon');
  const label  = document.getElementById('os-label');

  // Hide all blocks
  ['windows', 'mac', 'both'].forEach(id => {
    document.getElementById(`block-${id}`)?.classList.add('hidden');
  });

  if (os === 'windows') {
    document.getElementById('block-windows').classList.remove('hidden');
    document.getElementById('btn-windows').href = DOWNLOADS.windows;
    icon.textContent  = '🪟';
    label.textContent = 'Windows detected';
    pill.classList.add('detected');
  } else if (os === 'mac') {
    document.getElementById('block-mac').classList.remove('hidden');
    document.getElementById('btn-mac').href = DOWNLOADS.mac;
    icon.textContent  = '🍎';
    label.textContent = 'Mac detected';
    pill.classList.add('detected');
  } else {
    document.getElementById('block-both').classList.remove('hidden');
    document.getElementById('btn-both-windows').href = DOWNLOADS.windows;
    document.getElementById('btn-both-mac').href     = DOWNLOADS.mac;
    icon.textContent  = '💻';
    label.textContent = 'Select your OS below';
  }
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  applyOS(detectOS());
});
