import { ACCENTS, DARK_STYLES, THEME_MODES, setAppearance, useAppearance, type Appearance } from '../theme';

/** One row of Settings → Appearance: a label and its choices, each with a small swatch of what it looks like. */
function Choices<K extends keyof Appearance>({ name, label, options, swatch }: { name: K; label: string; options: { id: Appearance[K]; label: string }[]; swatch?: boolean }) {
  const chosen = useAppearance()[name];
  return (
    <div className="appearance-row">
      <span className="appearance-label" id={`appearance-${name}`}>{label}</span>
      <div className="segmented" role="radiogroup" aria-labelledby={`appearance-${name}`}>
        {options.map(option => (
          <button key={option.id} type="button" role="radio" aria-checked={chosen === option.id} aria-selected={chosen === option.id} onClick={() => setAppearance({ [name]: option.id })}>
            {swatch && <span className={`swatch swatch-${option.id}`} aria-hidden="true" />}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AppearancePicker() {
  return (
    <div className="appearance">
      <Choices name="mode" label="Mode" options={THEME_MODES} />
      <Choices name="dark" label="Dark style" options={DARK_STYLES} swatch />
      <Choices name="accent" label="Accent" options={ACCENTS} swatch />
    </div>
  );
}
