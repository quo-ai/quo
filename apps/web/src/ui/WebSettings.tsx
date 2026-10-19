import { useFallbackSetting, setFallbackSetting, type Fallback } from '../net/settings';
import { webBridge } from '../native';
import { setWebSettings, useWebSettings } from '../web/settings';
import { Toggle } from './Toggle';
import { SearchServices } from './web/SearchServices';

const FALLBACK: { id: Fallback; label: string; detail: string }[] = [
  { id: 'switch', label: 'Switch', detail: 'Quo moves to your offline model by itself and runs your message there. You can undo it.' },
  { id: 'ask', label: 'Ask me', detail: 'Quo offers to switch and waits for you.' },
  { id: 'off', label: 'Do nothing', detail: 'The chat explains what happened and you decide.' },
];

/** Web search, and what Quo does when a cloud model can't be reached or used. */
export function WebSettings() {
  const settings = useWebSettings();
  const fallback = useFallbackSetting();
  const bridge = webBridge();
  return (
    <>
      <p className="note keys-intro">
        A model can search the web and read pages. What it searches for goes to the search service, and it can only open addresses a search found, you wrote, or a page it read links to.
        {' With Quo’s cloud models, each message is searched for on the web first (a few a day on the free model, credits on the others), and your message goes to a search service.'}
        {!bridge && ' In a browser, your own OpenRouter or Anthropic key can search too, using their built-in search. The desktop app adds more services and works with offline models.'}
      </p>
      <div className="toggle-list">
        <Toggle label="On by default with your own keys" detail="Quo’s cloud models always start with it off, because each message would search. Switches itself off when you’re offline." on={settings.online} onChange={online => setWebSettings({ online })} />
        <Toggle label="On by default with offline models" detail="Off keeps an offline chat fully offline, and keeps photos, documents and thinking." on={settings.offline} onChange={offline => setWebSettings({ offline })} />
      </div>
      {bridge && <SearchServices bridge={bridge} />}
      <div className="sheet-section-title">When a cloud model can’t be used</div>
      <p className="note">No internet, no free messages or credits left, or a key that was refused.</p>
      <div className="segmented" role="radiogroup" aria-label="When a cloud model can’t be used">
        {FALLBACK.map(option => <button key={option.id} type="button" role="radio" aria-checked={fallback === option.id} aria-selected={fallback === option.id} onClick={() => setFallbackSetting(option.id)}>{option.label}</button>)}
      </div>
      <p className="note">{FALLBACK.find(option => option.id === fallback)?.detail} It only ever moves to your offline model, never to a cloud one, and when you’re back online it only offers to switch back.</p>
    </>
  );
}
