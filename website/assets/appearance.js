// The page's appearance, set on <html> before the first paint (load it in <head>, ahead of the styles). The rules are
// the apps' (apps/web/src/theme.ts): the visitor picks Auto, Light or Dark in the footer; E-ink, High contrast and Black
// follow the device (E-ink over High contrast over Black; Black on phones, which mostly have OLED screens).
(() => {
  const KEY = 'quo.site.mode';
  const media = query => matchMedia(query).matches;
  let unsaved = null; // a choice that couldn't be stored (private mode): kept until the page reloads
  const read = () => {
    if (unsaved) return unsaved;
    try {
      const mode = localStorage.getItem(KEY);
      return mode === 'light' || mode === 'dark' ? mode : 'auto';
    } catch {
      return 'auto';
    }
  };

  function resolve(mode) {
    const dark = mode === 'auto' ? media('(prefers-color-scheme: dark)') : mode === 'dark';
    if (media('(update: slow), (monochrome)')) return 'eink';
    if (media('(prefers-contrast: more)')) return dark ? 'contrast-dark' : 'contrast';
    if (dark) return media('(pointer: coarse) and (hover: none)') ? 'black' : 'dark';
    return 'light';
  }

  const apply = () => { document.documentElement.dataset.env = resolve(read()); };
  apply();
  ['(prefers-color-scheme: dark)', '(prefers-contrast: more)', '(update: slow)', '(monochrome)'].forEach(query =>
    matchMedia(query).addEventListener('change', apply));

  // The footer's Auto, Light and Dark buttons.
  document.addEventListener('DOMContentLoaded', () => {
    const buttons = document.querySelectorAll('[data-look]');
    const mark = () => buttons.forEach(button => button.setAttribute('aria-checked', String(button.dataset.look === read())));
    buttons.forEach(button => button.addEventListener('click', () => {
      try {
        if (button.dataset.look === 'auto') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, button.dataset.look);
      } catch {
        unsaved = button.dataset.look;
      }
      apply();
      mark();
    }));
    mark();
  });
})();
