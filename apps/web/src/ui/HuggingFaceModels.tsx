import { useRef, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { engineMemoryGB, type DeviceProfile } from '../device';
import { addHfModel } from '../models/hfStore';
import { parameterCount, repoFiles, searchModels, suggestFile, toLocalModel, type RepoFile, type RepoFiles, type RepoResult } from '../models/huggingface';
import { startDownload } from '../storage/downloads';
import { formatBytes } from './format';
import { toast } from './Toasts';

const SUPPORT_NOTE = {
  yes: null,
  'not-chat': 'Makes embeddings or speech, not chat.',
  'newer-engine': 'Needs a newer version of Quo.',
  unknown: 'Hugging Face doesn’t say what kind of model this is; it may not load.',
} as const;

const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

const projectorOf = (files: RepoFiles): RepoFile | null => files.projectors.find(file => /f16/i.test(file.path) && !/bf16/i.test(file.path)) ?? files.projectors[0] ?? null;

/** Desktop app: search Hugging Face for any GGUF model the engine can run, pick a size, and download it like a catalog model. */
export function HuggingFaceModels({ device }: { device: DeviceProfile | null }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RepoResult[] | null>(null);
  const [open, setOpen] = useState<{ result: RepoResult; files: RepoFiles; file: RepoFile | null; vision: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const memory = device ? engineMemoryGB(device) ?? device.memoryGB : null;

  async function run(task: (signal: AbortSignal) => Promise<void>) {
    controller.current?.abort();
    const current = (controller.current = new AbortController());
    setBusy(true);
    try {
      await task(current.signal);
    } catch (error) {
      if (!current.signal.aborted) toast(error instanceof Error ? error.message : 'That didn’t work.');
    } finally {
      if (controller.current === current) setBusy(false);
    }
  }

  const search = () => query.trim() && run(async signal => {
    setOpen(null);
    const list = await searchModels(query, signal);
    setResults(list);
    if (!list.length) toast('No GGUF models found for that.');
  });

  const choose = (result: RepoResult) => run(async signal => {
    const files = await repoFiles(result.repo, signal);
    if (!files.models.length) throw new Error('That repository has no single-file GGUF model Quo can use.');
    setOpen({ result, files, file: suggestFile(files.models, memory), vision: files.projectors.length > 0 });
  });

  const add = () => {
    if (!open?.file) return;
    const model = addHfModel(toLocalModel(open.result, open.file, open.vision ? projectorOf(open.files) : null));
    void startDownload(model);
    toast(`Downloading ${model.name}`);
    setOpen(null);
  };

  const suggested = open ? suggestFile(open.files.models, memory) : null;
  return (
    <div className="storage-box hf-models">
      <p>Search Hugging Face for any GGUF model. Quo’s engine runs about 160 kinds (Llama, Qwen, Gemma, Mistral, DeepSeek, GLM, Phi and more), and checks which kind a model is before you download it.</p>
      <form className="hf-search" onSubmit={event => { event.preventDefault(); void search(); }}>
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search models, e.g. “Mistral” or “Qwen coder”" aria-label="Search Hugging Face" maxLength={100} />
        <button className="btn btn-soft press" disabled={busy || !query.trim()}><Search size={15} /> Search</button>
      </form>
      {open && (
        <div className="hf-pick">
          <strong>{open.result.repo}</strong>
          <label>
            Size
            <select value={open.file?.path ?? ''} onChange={event => setOpen({ ...open, file: open.files.models.find(file => file.path === event.target.value) ?? null })}>
              {open.files.models.map(file => (
                <option key={file.path} value={file.path}>
                  {file.quant ?? file.path.split('/').pop()} · {formatBytes(file.sizeBytes)}{file === suggested ? ' · suggested' : ''}
                </option>
              ))}
            </select>
          </label>
          {open.files.projectors.length > 0 && (
            <label className="hf-check">
              <input type="checkbox" checked={open.vision} onChange={event => setOpen({ ...open, vision: event.target.checked })} />
              Read images too (+{formatBytes(projectorOf(open.files)!.sizeBytes)})
            </label>
          )}
          <div className="model-actions">
            <button className="btn btn-primary press" disabled={!open.file} onClick={add}><Download size={15} /> Add and download</button>
            <button className="btn btn-ghost press" onClick={() => setOpen(null)}>Back</button>
          </div>
        </div>
      )}
      {!open && results && results.length > 0 && (
        <ul className="found-list">
          {results.map(result => {
            const note = SUPPORT_NOTE[result.support];
            return (
              <li key={result.repo}>
                <span className="found-name" title={result.repo}>
                  <strong>{result.repo}</strong>
                  <small>
                    {[result.architecture, result.parameters ? `${parameterCount(result.parameters)} parameters` : null, `${short(result.downloads)} downloads`, result.thinking ? 'thinks' : null].filter(Boolean).join(' · ')}
                    {note ? ` · ${note}` : ''}
                  </small>
                </span>
                <button className="btn btn-soft press" disabled={busy || result.support === 'not-chat' || result.support === 'newer-engine'} onClick={() => void choose(result)}>Choose</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
