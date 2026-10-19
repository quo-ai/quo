import { useMemo, useState } from 'react';
import { Boxes, Crown, MonitorDown, PanelLeftClose, Plus, Search, Settings, Trash2, UserRound } from 'lucide-react';
import type { Account } from '../cloud/account';
import { groupConversations } from '../chat/groups';
import type { Conversation } from '../chat/types';
import { useSyncStatus } from '../sync';
import { QuoMark } from './QuoMark';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD_KEY = isMac ? '⌘' : 'Ctrl';

interface SidebarProps {
  conversations: Conversation[];
  currentId: string | null;
  installedCount: number;
  account: Account | null;
  onOpenAccount: () => void;
  onNewChat: () => void;
  onOpen: (id: string) => void;
  onDelete: (conversation: Conversation) => void;
  onCollapse: () => void;
  onOpenModels: () => void;
  onOpenSettings: () => void;
  /** What Quo Pro is (shown to people who aren't signed in or on Pro). */
  onOpenPro: () => void;
  onGetApp: () => void;
}

export function Sidebar({ conversations, currentId, installedCount, account, onOpenAccount, onNewChat, onOpen, onDelete, onCollapse, onOpenModels, onOpenSettings, onOpenPro, onGetApp }: SidebarProps) {
  const sync = useSyncStatus();
  const [query, setQuery] = useState('');
  const syncNeedsAttention = sync.phase === 'error' && sync.error?.code !== 'offline';
  const groups = useMemo(() => groupConversations(conversations, Date.now(), query), [conversations, query]);

  return (
    <aside className="sidebar glass" aria-label="Chats">
      <div className="sidebar-inner">
        <div className="brand-row">
          <a className="brand" href="/"><QuoMark />Quo</a>
          <button className="icon-btn press" onClick={onCollapse} aria-label="Hide sidebar" title={`Hide sidebar (${MOD_KEY}+B)`}>
            <PanelLeftClose size={19} />
          </button>
        </div>

        <button className="btn btn-primary btn-block press" onClick={onNewChat}>
          <Plus size={18} strokeWidth={2.4} /> New chat <span className="kbd">{MOD_KEY}⇧O</span>
        </button>

        {conversations.length > 0 && (
          <label className="search">
            <Search size={16} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats" />
          </label>
        )}

        <nav className="chat-list">
          {conversations.length === 0 && <p className="chat-empty">Your chats appear here. They’re saved on this device only.</p>}
          {conversations.length > 0 && groups.length === 0 && <p className="chat-empty">No chats match “{query}”.</p>}
          {groups.map(group => (
            <div key={group.label}>
              <div className="chat-group-label">{group.label}</div>
              {group.items.map(conversation => (
                <div key={conversation.id} className={`chat-item${conversation.id === currentId ? ' active' : ''}`}>
                  <button className="chat-open" onClick={() => onOpen(conversation.id)} aria-current={conversation.id === currentId}>
                    {conversation.title}
                  </button>
                  <button className="icon-btn" onClick={() => onDelete(conversation)} aria-label={`Delete “${conversation.title}”`}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="footer-btn press" onClick={onOpenModels}>
            <Boxes size={18} /> Offline models
            <span className="count">{installedCount ? `${installedCount} on device` : 'None yet'}</span>
          </button>
          <button className="footer-btn press" onClick={onOpenSettings}>
            <Settings size={18} /> Settings
            {syncNeedsAttention && <span className="count attention" title="Quo Sync needs attention">Sync needs attention</span>}
          </button>
          <button className="footer-btn press" onClick={onGetApp}>
            <MonitorDown size={18} /> Get the app
          </button>
          {/* Shown whenever the API is reachable; a service that isn't set up yet explains itself when used. */}
          {account?.user ? (
            <button className="footer-btn account-btn press" onClick={onOpenAccount}>
              <span className="avatar">{account.user.email[0].toUpperCase()}</span>
              <span className="account-text">
                <span className="account-email">{account.user.email}</span>
                <span className="account-credits">{Math.floor(account.credits ?? 0).toLocaleString()} credits</span>
              </span>
              {account.plan === 'pro' && <span className="badge"><Crown size={11} /> Pro</span>}
            </button>
          ) : account && (
            <div className="signin-row">
              <button className="footer-btn press" onClick={onOpenAccount}><UserRound size={18} /> Sign in</button>
              <button className="btn btn-primary press get-pro" onClick={onOpenPro}>Get Pro</button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
