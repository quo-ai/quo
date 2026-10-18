import { describe, expect, it } from 'vitest';
import { desktopOS, mobileStoreUrl, PLAY_STORE_URL } from '../platform';
import { nudgeAllowed } from '../ui/InstallNudge';

const UA = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0',
  linux: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36',
};

describe('desktopOS', () => {
  it('maps computers to their desktop build', () => {
    expect(desktopOS(UA.mac)).toBe('mac');
    expect(desktopOS(UA.windows)).toBe('windows');
    expect(desktopOS(UA.linux)).toBe('linux');
  });

  it('never offers a desktop build to phones (Android user agents mention Linux)', () => {
    expect(desktopOS(UA.android)).toBeNull();
    expect(desktopOS(UA.iphone)).toBeNull();
  });
});

describe('mobileStoreUrl', () => {
  it('points Android to Google Play and computers nowhere', () => {
    expect(mobileStoreUrl(UA.android)).toBe(PLAY_STORE_URL);
    expect(mobileStoreUrl(UA.mac)).toBeNull();
  });
});

describe('nudgeAllowed', () => {
  const day = 86_400_000;
  const now = 100 * day;

  it('shows the first time', () => {
    expect(nudgeAllowed(now, {})).toBe(true);
  });

  it('rests for two weeks after "Not now"', () => {
    expect(nudgeAllowed(now, { dismissedAt: now - 3 * day, dismissals: 1 })).toBe(false);
    expect(nudgeAllowed(now, { dismissedAt: now - 15 * day, dismissals: 1 })).toBe(true);
  });

  it('stops for good after two dismissals or an install', () => {
    expect(nudgeAllowed(now, { dismissedAt: now - 60 * day, dismissals: 2 })).toBe(false);
    expect(nudgeAllowed(now, { done: true })).toBe(false);
  });
});
