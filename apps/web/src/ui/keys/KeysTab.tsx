import { useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { useProviders } from '../../providers/accounts';
import { useOwnModels } from '../../providers/ownModels';
import { CustomForm } from './CustomForm';
import { ProviderDetail } from './ProviderDetail';

type View = { page: 'list' } | { page: 'provider'; id: string } | { page: 'new' };

const STORAGE_NOTE = {
  system: 'Keys are saved encrypted by your operating system, and the app’s pages can store one but never read it back.',
  memory: 'This computer has no secure storage for keys, so Quo keeps them only until you quit it.',
  browser: 'Keys are saved in this browser only, and never sent to Quo. The desktop app keeps them in your system’s secure storage instead.',
} as const;

/** Use a model with your own API key: pick a provider, paste a key, choose models. No Quo account needed. */
export function KeysTab({ selectedKey, onChoose }: { selectedKey: string | null; onChoose: (key: string) => void }) {
  const { accounts, storage } = useProviders();
  const models = useOwnModels();
  const [view, setView] = useState<View>({ page: 'list' });
  const back = () => setView({ page: 'list' });
  const open = view.page === 'provider' ? accounts.find(account => account.info.id === view.id) : undefined;

  if (open) return <ProviderDetail key={open.info.id} account={open} selectedKey={selectedKey} onBack={back} onUse={onChoose} />;
  if (view.page === 'new') {
    return (
      <>
        <div className="keys-head"><h3>Add a server</h3></div>
        <CustomForm onSaved={provider => setView({ page: 'provider', id: provider.id })} onRemoved={back} onCancel={back} />
      </>
    );
  }

  const row = (account: (typeof accounts)[number]) => {
    const count = models.filter(model => model.provider === account.info.id).length;
    const status = account.configured ? `Connected · •••• ${account.last4}` : account.info.custom ? account.info.baseUrl : 'Not connected';
    return (
      <button key={account.info.id} className="menu-item press" onClick={() => setView({ page: 'provider', id: account.info.id })}>
        <span className="grow">
          <span className="title">{account.info.name}</span>
          <span className="sub">{status}{count ? ` · ${count} model${count === 1 ? '' : 's'}` : ''}</span>
        </span>
        <ChevronRight size={17} color="var(--text-3)" />
      </button>
    );
  };

  return (
    <>
      <p className="note keys-intro">Use your own account with a provider. Your messages go straight from this computer to them, not through Quo, and you don’t need a Quo account. {STORAGE_NOTE[storage]}</p>
      <div className="cloud-list">
        {accounts.filter(account => !account.info.custom).map(row)}
        {accounts.some(account => account.info.custom) && <div className="popover-section">Your own servers</div>}
        {accounts.filter(account => account.info.custom).map(row)}
        <button className="menu-item press" onClick={() => setView({ page: 'new' })}>
          <Plus size={17} color="var(--indigo)" />
          <span className="grow"><span className="title">Add a server</span><span className="sub">Ollama, LM Studio, or any OpenAI-style address</span></span>
        </button>
      </div>
    </>
  );
}
