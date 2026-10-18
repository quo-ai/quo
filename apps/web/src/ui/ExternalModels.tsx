import { useState } from 'react';
import { FileUp, Search } from 'lucide-react';
import { addCustomModel, addCustomModelFile, findExternalModels, useCustomModels } from '../customModels';
import type { CustomModelEntry } from '../native';
import { formatBytes } from './format';
import { toast } from './Toasts';

const SOURCE_LABEL = { lmstudio: 'LM Studio', ollama: 'Ollama' } as const;

/**
 * Desktop app: use models that are already on this computer without copying
 * them, either one picked from disk or those LM Studio and Ollama downloaded.
 */
export function ExternalModels() {
  const added = useCustomModels();
  const [found, setFound] = useState<CustomModelEntry[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That didn’t work.');
    } finally {
      setBusy(false);
    }
  }

  const choose = () => run(async () => {
    const model = await addCustomModelFile();
    if (model) toast(`${model.name} added`);
  });

  const scan = () => run(async () => {
    const list = await findExternalModels();
    setFound(list);
    if (!list.length) toast('No models found from LM Studio or Ollama.');
  });

  const use = (entry: CustomModelEntry) => run(async () => {
    const model = await addCustomModel(entry);
    setFound(list => list?.filter(item => item.path !== entry.path) ?? null);
    toast(`${model.name} added`);
  });

  return (
    <div className="storage-box">
      <p>Already have models from LM Studio or Ollama, or a GGUF file? Quo can use them where they are, with no second download.</p>
      <div className="model-actions">
        <button className="btn btn-soft press" disabled={busy} onClick={() => void choose()}><FileUp size={15} /> Choose a model file…</button>
        <button className="btn btn-soft press" disabled={busy} onClick={() => void scan()}><Search size={15} /> Find my models</button>
      </div>
      {found && found.length > 0 && (
        <ul className="found-list">
          {found.map(entry => (
            <li key={entry.path}>
              <span className="found-name" title={entry.path}>
                <strong>{entry.name}</strong>
                <small>{entry.source ? SOURCE_LABEL[entry.source] : 'This computer'} · {formatBytes(entry.sizeBytes)}{entry.mmprojPath ? ' · reads images' : ''}</small>
              </span>
              <button className="btn btn-primary press" disabled={busy} onClick={() => void use(entry)}>Use</button>
            </li>
          ))}
        </ul>
      )}
      {added.length > 0 && <p className="note" style={{ marginTop: 10 }}>{added.length} added. They appear in the list above.</p>}
    </div>
  );
}
