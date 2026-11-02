import { APPEARANCES } from '../styles/appearances';
import { SWITCH_NAMES, THEME_MODES, effective, setAppearance, useAppearance, type Appearance, type Automatic, type SwitchName } from '../theme';

const ABOUT: Record<SwitchName, { label: string; detail: string }> = {
  black: { label: 'Black background', detail: 'In dark mode: true black, dimmer text, no bright fills.' },
  contrast: { label: 'High contrast', detail: 'Heavier text, solid edges, stronger colours.' },
  eink: { label: 'E-ink', detail: 'Black on white, no motion. For e-ink screens.' },
};

/** What automatic chose for a switch, and why. */
function why(name: SwitchName, auto: Automatic): string {
  if (name === 'black') return auto.phone ? 'Automatic: on, because this is a phone. Most phones have OLED screens, where black pixels are off.' : 'Automatic: off on computers. Turn it on for an OLED screen or a dark room.';
  if (name === 'contrast') return `Automatic: ${auto.contrast ? 'on' : 'off'}, from your device’s contrast setting.`;
  return `Automatic: ${auto.eink ? 'on, because this is an e-ink screen' : 'off, because this is not an e-ink screen'}.`;
}

/**
 * Why a switch has no effect at the moment, if it hasn't: E-ink wins over High contrast, which wins over Black, and
 * Black is for dark mode only. (In Light mode Black isn't offered at all.)
 */
function idle(name: SwitchName, choice: Appearance, on: ReturnType<typeof effective>): string | null {
  if (name !== 'eink' && on.eink) return 'E-ink is on, so this has no effect now.';
  if (name === 'black' && on.contrast) return 'High contrast is on, and it has its own dark.';
  if (name === 'black' && choice.mode === 'system' && !on.dark) return 'Takes effect when your device is in dark mode.';
  return null;
}

/** Settings → Appearance: the mode, then the switches that can apply, each automatic until changed and back in one click. */
export function AppearancePicker() {
  const { choice, auto, look } = useAppearance();
  const on = effective(choice, auto);
  const shown = SWITCH_NAMES.filter(name => name !== 'black' || choice.mode !== 'light');
  return (
    <div className="appearance">
      <div className="segmented" role="radiogroup" aria-label="Mode">
        {THEME_MODES.map(mode => (
          <button key={mode.id} type="button" role="radio" aria-checked={choice.mode === mode.id} aria-selected={choice.mode === mode.id} onClick={() => setAppearance({ mode: mode.id })}>
            {mode.label}
          </button>
        ))}
      </div>
      <p className="appearance-note" aria-live="polite">
        {choice.mode === 'system' ? `Auto follows your device, which is in ${auto.dark ? 'dark' : 'light'} mode now.` : `Always ${choice.mode}.`} In use: {APPEARANCES[look].label}.
      </p>
      <div className="toggle-list">
        {shown.map(name => {
          const quiet = idle(name, choice, on);
          return (
            <div className={`appearance-switch${quiet && !quiet.startsWith('Takes') ? ' idle' : ''}`} key={name}>
              <button type="button" className="toggle-row" role="switch" aria-checked={on[name]} onClick={() => setAppearance({ [name]: on[name] ? 'off' : 'on' })}>
                <span className="grow">
                  <span className="title">{ABOUT[name].label}</span>
                  <span className="sub">{ABOUT[name].detail}</span>
                  <span className="sub">{choice[name] === 'auto' ? why(name, auto) : 'Set by you.'}{quiet ? ` ${quiet}` : ''}</span>
                </span>
                <span className="switch" aria-hidden="true" />
              </button>
              {choice[name] !== 'auto' && <button type="button" className="btn-link appearance-auto" onClick={() => setAppearance({ [name]: 'auto' })}>Use automatic</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
