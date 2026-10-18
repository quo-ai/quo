interface ToggleProps {
  label: string;
  detail?: string;
  on: boolean;
  onChange: (on: boolean) => void;
}

/** A setting with a switch: the label, a line of explanation, and the switch on the right. */
export function Toggle({ label, detail, on, onChange }: ToggleProps) {
  return (
    <button type="button" role="switch" aria-checked={on} className="toggle-row press" onClick={() => onChange(!on)}>
      <span className="grow">
        <span className="title">{label}</span>
        {detail && <span className="sub">{detail}</span>}
      </span>
      <span className="switch" aria-hidden="true" />
    </button>
  );
}
