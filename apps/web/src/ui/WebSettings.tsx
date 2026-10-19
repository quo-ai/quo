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
        A model can search the web and read pages whenever it decides it needs to: there is no switch in the chat. What it searches for goes to the search service, and it can only open addresses a search found, you wrote, or a page it read links to.
        {bridge ? ' These settings say whether models may search at all.' : ' In a browser, Quo’s cloud models search once per message when you turn Web on under the message box (a few a day on the free model, credits on the others), and your own OpenRouter or Anthropic key can search with their built-in search. The desktop app lets every model decide for itself, and works with offline models.'}
      </p>
      <div className="toggle-list">
        <Toggle label="Let online models search the web" detail="Quo’s cloud models and your own keys. In the desktop app the model decides when; in a browser it is the Web button. Switches itself off when you’re offline." on={settings.online} onChange={online => setWebSettings({ online })} />
        <Toggle label="Let offline models search the web" detail="Off keeps an offline chat fully offline, and keeps photos, documents and thinking." on={settings.offline} onChange={offline => setWebSettings({ offline })} />
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
