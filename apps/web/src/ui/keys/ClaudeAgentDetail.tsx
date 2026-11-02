import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import type { ClaudeStatus } from '../../native';
import { refreshProviders } from '../../providers/accounts';
import { CLAUDE_AGENT, listedModel } from '../../providers/claudeAgent';
import { refreshClaudeModels, useClaudeModels } from '../../providers/claudeCatalog';
import { useClaudeUsage } from '../../providers/claudeUsage';
import { PlanUsageDetails } from '../chat/PlanUsage';
import { ProviderModels } from './ProviderModels';

interface ClaudeAgentDetailProps {
  selectedKey: string | null;
  onBack: () => void;
  onUse: (key: string) => void;
}

const SETUP_URL = 'https://code.claude.com/docs/en/setup';

const KIND_NOTE = {
  subscription: 'Usage counts against your Claude plan',
  api_key: 'Claude Code uses an API key, which is billed for usage',
  cloud: 'Claude Code uses your cloud provider account',
} as const;

function summary(status: ClaudeStatus | null): { title: string; sub: string } {
  if (!status) return { title: 'Checking Claude Code…', sub: 'This sends no message.' };
  if (!status.installed) return { title: 'Claude Code isn’t installed', sub: 'Install it, sign in, then check again.' };
  if (status.problem) return { title: 'Claude Code needs attention', sub: status.problem };
  if (!status.signedIn) return { title: 'Claude Code isn’t signed in', sub: 'Run `claude auth login` in a terminal, then check again.' };
  const note = status.kind ? KIND_NOTE[status.kind] : '';
  return { title: `Signed in${status.plan ? ` (${status.plan})` : ''}`, sub: [note, status.version ? `Claude Code ${status.version}` : ''].filter(Boolean).join('. ') };
}

/** Claude Agent: Claude through your own Claude Code login. There is no key: Claude Code signs itself in, and Quo never sees it. */
export function ClaudeAgentDetail({ selectedKey, onBack, onUse }: ClaudeAgentDetailProps) {
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const offered = useClaudeModels();
  const usage = useClaudeUsage();

  async function check() {
    setChecking(true);
    try {
      // The sign-in shows at once; the specific versions take a few seconds more to check.
      setStatus(await refreshClaudeModels(found => {
        setStatus(found);
        void refreshProviders();
      }));
    } catch (error) {
      setStatus({ installed: true, problem: error instanceof Error ? error.message : 'Something went wrong. Try again.' });
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void check();
  }, []);

  const { title, sub } = summary(status);
  const ready = Boolean(status?.signedIn && !status.problem);
  const listed = ready ? offered.map(listedModel) : null;

  return (
    <>
      <div className="keys-head">
        <button type="button" className="icon-btn round press" onClick={onBack} aria-label="Back to all providers"><ArrowLeft size={18} /></button>
        <h3>{CLAUDE_AGENT.name}</h3>
      </div>
      <p className="note keys-intro">
        Use Claude with your own Claude Code login. Every model it offers is in the model menu. Quo runs Claude Code on this computer with its own tools turned off, so in Code mode every change still needs your OK in Quo. Quo never sees your login. Your messages go from this computer to Anthropic, not through Quo.
      </p>
      <div className="keys-saved">
        <span className="grow"><span className="title">{title}</span><span className="sub">{sub}</span></span>
        <button type="button" className="btn btn-soft press small" onClick={() => void check()} disabled={checking}>{checking ? 'Checking…' : 'Check again'}</button>
      </div>
      {status && !ready && (
        <p className="note">
          Install Claude Code, then run <code>claude auth login</code> in a terminal.{' '}
          <a className="btn-link" href={SETUP_URL} target="_blank" rel="noreferrer noopener">How to install <ExternalLink size={12} /></a>
        </p>
      )}
      {ready && status?.kind === 'subscription' && (
        <>
          <div className="sheet-section-title">Plan usage</div>
          {usage?.windows.length ? <div className="plan-usage"><PlanUsageDetails usage={usage} /></div> : <p className="note">Shows here after your first reply from Claude Agent.</p>}
        </>
      )}
      {ready && <ProviderModels provider={CLAUDE_AGENT} listed={listed} loading={checking} problem={null} selectedKey={selectedKey} onLoad={() => void check()} onUse={onUse} />}
      {ready && status?.checking && <p className="note">Checking which specific versions your plan can use…</p>}
    </>
  );
}
