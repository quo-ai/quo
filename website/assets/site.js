/* Quo website: links, platform detection, downloads and dialogs.
   No analytics or third-party requests. Change destinations in LINKS only;
   a null link hides (or marks "coming soon") everything that points to it. */

const GITHUB = 'https://github.com/quo-ai/quo';
const RELEASES = `${GITHUB}/releases/latest`;

const LINKS = {
  webapp: 'https://quoai-app.vercel.app/',
  github: GITHUB,
  releases: RELEASES,
  contribute: `${GITHUB}/blob/master/.github/CONTRIBUTING.md`,
  ios: null, // App Store URL once the listing is live
  android: 'https://play.google.com/store/apps/details?id=com.quo.app',
  x: null, // e.g. 'https://x.com/<handle>'
};

// Fixed asset names (apps/desktop/README.md), so /latest/download/ always serves the newest build.
const DESKTOP = {
  mac: { name: 'Mac', url: `${RELEASES}/download/Quo-mac-universal.dmg` },
  windows: { name: 'Windows', url: `${RELEASES}/download/Quo-windows-x64-setup.exe` },
  linux: { name: 'Linux', url: `${RELEASES}/download/Quo-linux-x86_64.AppImage` },
};

const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);
const isMobile = isIOS || isAndroid;
const os = isIOS ? 'ios' : isAndroid ? 'android' : /Windows/.test(ua) ? 'windows' : /Mac/.test(ua) ? 'mac' : /Linux|X11|CrOS/.test(ua) ? 'linux' : null;
const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'This browser';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

for (const el of $$('[data-link]')) {
  const href = LINKS[el.dataset.link];
  if (href) {
    el.href = href;
  } else if (el.dataset.link === 'ios') {
    el.removeAttribute('href');
    el.setAttribute('aria-disabled', 'true');
    el.classList.add('is-soon');
    const label = $('[data-ios-label]', el) ?? $('[data-ios-detail]', el);
    if (label) label.textContent = 'Coming soon';
  } else {
    el.hidden = true;
  }
}
for (const el of $$('[data-dl]')) el.href = DESKTOP[el.dataset.dl].url;
for (const el of $$('[data-clone]')) el.textContent = LINKS.github;

// Name the visitor's OS on the desktop buttons; put their row first in the dialog.
if (DESKTOP[os]) {
  for (const el of $$('[data-desktop-label]')) el.textContent = `Download for ${DESKTOP[os].name}`;
  for (const el of $$(`.dl-btn[data-dl="${os}"]`)) el.classList.add('is-recommended');
}
const list = $('.dl-list');
const mine = os && list?.querySelector(`[data-os="${os}"]`);
if (mine) {
  mine.classList.add('is-recommended');
  list.prepend(mine);
}

function open(id) {
  const dialog = document.getElementById(id);
  if (!dialog) return false;
  for (const d of $$('dialog[open]')) d.close();
  dialog.showModal();
  // Start on the main action rather than the close button.
  $('.is-recommended, [data-primary]:not([hidden])', dialog)?.focus({ focusVisible: false });
  return true;
}

for (const dialog of $$('dialog')) {
  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target.closest('[data-close]')) dialog.close();
  });
}
for (const el of $$('[data-open]')) {
  el.addEventListener('click', event => {
    if (open(el.dataset.open)) event.preventDefault();
  });
}

// Desktop downloads start straight away, then a dialog explains the next steps
// (the pattern Claude, ChatGPT and Cursor use).
let lastDownload = null;
function startDownload(target) {
  if (!DESKTOP[target] || !document.getElementById('started')) return false;
  lastDownload = target;
  location.href = DESKTOP[target].url;
  for (const steps of $$('[data-steps]')) steps.hidden = steps.dataset.steps !== target;
  open('started');
  return true;
}
for (const el of $$('[data-dl]')) {
  el.addEventListener('click', event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (startDownload(el.dataset.dl)) event.preventDefault();
  });
}
for (const el of $$('[data-download]')) {
  el.addEventListener('click', event => {
    if (isAndroid && LINKS.android) return;
    if (startDownload(os)) event.preventDefault();
    else if (open('download')) event.preventDefault();
  });
}
// On Android the second button gets the app instead of a desktop build.
if (isAndroid && LINKS.android) {
  for (const button of $$('[data-download]')) {
    button.href = LINKS.android;
    const label = $('[data-desktop-label]', button);
    if (label) label.textContent = 'Get it on Google Play';
  }
  const playBadge = $('.store[data-link="android"]');
  playBadge?.parentElement.prepend(playBadge);
}
$('[data-retry]')?.addEventListener('click', event => {
  event.preventDefault();
  if (lastDownload) location.href = DESKTOP[lastDownload].url;
});
$('[data-desktop-instead]')?.addEventListener('click', () => {
  if (!startDownload(os)) open('download');
});

// Can this browser run models on the graphics card? Same test as Quo Web:
// a real WebGPU adapter plus JSPI (WebAssembly.Suspending), which wllama needs.
const gpuCheck = (async () => {
  if (!navigator.gpu) return { gpu: false, reason: 'no-webgpu' };
  if (typeof WebAssembly?.Suspending !== 'function') return { gpu: false, reason: 'update' };
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    const fallback = adapter?.info?.isFallbackAdapter ?? adapter?.isFallbackAdapter ?? false;
    return adapter && !fallback ? { gpu: true } : { gpu: false, reason: 'no-adapter' };
  } catch {
    return { gpu: false, reason: 'no-adapter' };
  }
})();

const REASONS = {
  'no-webgpu': `${browser} can't use your graphics card for AI yet, so Quo would run on your processor and replies would be slower.`,
  update: `Your version of ${browser} is missing a feature Quo needs to use your graphics card. Update it, or use Chrome or Edge.`,
  'no-adapter': `${browser} couldn't reach your graphics card, so Quo would run on your processor. Updating your browser or graphics drivers can help.`,
};

const check = $('[data-browser-check]');
if (check && !isMobile) {
  gpuCheck.then(({ gpu }) => {
    check.hidden = false;
    check.classList.toggle('ok', gpu);
    check.innerHTML = gpu
      ? `<svg aria-hidden="true"><use href="#i-check"/></svg>${browser} can use your graphics card. Quo will run at full speed.`
      : /Chrome|Edge/.test(browser)
        ? `${browser} can't reach your graphics card here, so replies will be slower. The desktop app may help.`
        : `${browser} will run Quo on your processor. For faster replies, use Chrome, Edge or the desktop app.`;
  });
}

// Phones: the app store link, or "coming soon" until the iPhone listing is live.
const store = $('[data-store]');
const storeUrl = isIOS ? LINKS.ios : LINKS.android;
if (store) {
  if (storeUrl) {
    store.href = storeUrl;
    store.textContent = isIOS ? 'Download on the App Store' : 'Get it on Google Play';
  } else {
    store.hidden = true;
    $('#mobile-title').textContent = 'Quo for iPhone is coming soon';
    const sub = $('[data-mobile-sub]');
    if (sub) sub.textContent = 'Phone browsers don’t have enough memory for AI models, so for now Quo works best on a computer. Send yourself the link for later.';
  }
}

// Phone visitors (often from a post on X) can send Quo to their computer.
$('[data-share]')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  const url = location.origin + '/';
  try {
    if (navigator.share) await navigator.share({ title: 'Quo: private AI that works offline', url });
    else {
      await navigator.clipboard.writeText(url);
      button.textContent = 'Link copied';
    }
  } catch {
    // Share sheet dismissed.
  }
});

// "Try Quo" goes straight through when the browser is a good fit; otherwise it
// explains why first and offers a better route, without blocking anyone.
for (const el of $$('[data-try]')) {
  el.addEventListener('click', async event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (!document.getElementById('browser')) return;
    event.preventDefault();
    if (isMobile) return void open('mobile');
    const result = await gpuCheck;
    if (result.gpu) return void (location.href = LINKS.webapp);
    $('[data-browser-reason]').textContent = REASONS[result.reason];
    if (/Chrome|Edge/.test(browser)) $('#browser-title').textContent = 'Your graphics card isn’t available here';
    open('browser');
  });
}

$('[data-copy-link]')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText(LINKS.webapp);
    button.textContent = 'Copied. Paste it into Chrome or Edge.';
  } catch {
    button.textContent = LINKS.webapp;
  }
});
