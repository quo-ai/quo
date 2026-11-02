// Puts the chosen appearance on <html> before the first paint, so a choice made in Settings → Appearance never shows the
// device's look first. A plain script in <head>, ahead of the styles. The rules are src/theme.ts's (resolve, readChoice);
// src/__tests__/appearanceBoot.test.ts checks the two agree. theme.ts takes over once the app runs.
(function () {
  try {
    var get = function (key) {
      try { return localStorage.getItem(key); } catch (e) { return null; }
    };
    var media = function (query) { return typeof matchMedia === 'function' && matchMedia(query).matches; };
    var choice = function (key) { var value = get(key); return value === 'on' || value === 'off' ? value : 'auto'; };
    var pick = function (value, automatic) { return value === 'on' ? true : value === 'off' ? false : automatic; };

    var mode = get('quo.theme');
    if (mode !== 'light' && mode !== 'dark') mode = 'system';
    var black = choice('quo.theme.black');
    if (get('quo.theme.black') === null) {
      var style = get('quo.theme.dark');
      if (style === 'black') black = 'on';
      if (style === 'midnight') black = 'off';
    }
    var phone = !window.quoDesktop && media('(pointer: coarse) and (hover: none)');
    var dark = mode === 'system' ? media('(prefers-color-scheme: dark)') : mode === 'dark';
    var look = pick(choice('quo.theme.eink'), media('(update: slow), (monochrome)')) ? 'eink'
      : pick(choice('quo.theme.contrast'), media('(prefers-contrast: more)')) ? (dark ? 'contrast-dark' : 'contrast')
      : dark ? (pick(black, phone) ? 'black' : 'dark') : 'light';
    document.documentElement.setAttribute('data-env', look);
  } catch (e) {
    // The media rules in tokens.css follow the device until the app runs.
  }
})();
