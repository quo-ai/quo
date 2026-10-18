import { useCallback, useEffect, useRef, useState } from 'react';
import { Crown, PanelLeftOpen, SquarePen } from 'lucide-react';
import { allLocalModels, getLocalModel, LOCAL_MODELS, type LocalModel } from './catalog';
import { refreshCustomModels, useCustomModels } from './customModels';
import { nativeBridge } from './native';
import { deleteConversation, listConversations, saveConversation } from './chat/store';
import type { Conversation } from './chat/types';
import { getAccount, refreshAccount, subscribeAccount, type Account } from './cloud/account';
import { isUnlocked } from './cloud/access';
import { frontierModels } from './cloud/pro';
import { cachedCatalog, loadCatalog, type CloudCatalog, type CloudModel } from './cloud/catalog';
import { deviceNotice, getDeviceProfile, type DeviceProfile } from './device';
import { localEngine } from './engine/localEngine';
import { isAppInstalled } from './install';
import { choiceKey, type ModelChoice } from './models';
import { cancelDownload, initDownloads, startDownload, subscribeDownloads, type DownloadState } from './storage/downloads';
import { isPersisted } from './storage/persistence';
import { initSync, onSyncedChats } from './sync';
import { AccountSheet } from './ui/AccountSheet';
import { Chat, type ChatAction, type ChatHandle } from './ui/Chat';
import { DeviceBanner, isNoticeDismissed } from './ui/DeviceBanner';
import { GetAppSheet } from './ui/GetAppSheet';
import { InstallNudge, nudgeAllowed } from './ui/InstallNudge';
import { ModelPicker } from './ui/ModelPicker';
import { ModelsSheet } from './ui/ModelsSheet';
import { OfflineModelCard } from './ui/OfflineModelCard';
import { MOD_KEY, Sidebar } from './ui/Sidebar';
import { MemorySheet } from './ui/MemorySheet';
import { PaywallSheet } from './ui/PaywallSheet';
import { ProSheet } from './ui/ProSheet';
import { SyncSheet } from './ui/SyncSheet';
import { toast, Toasts } from './ui/Toasts';
import { Welcome } from './ui/Welcome';

const CHOICE_KEY = 'quo.choice';
/** Earlier versions stored only the local model id. */
const LEGACY_MODEL_KEY = 'quo.activeModel';
/** Set when the user chats in the cloud only until their offline model is ready. */
const CLOUD_UNTIL_OFFLINE_KEY = 'quo.cloudUntilOffline';
const SIDEBAR_KEY = 'quo.sidebarCollapsed';
const ACTIVE = ['downloading', 'waiting', 'verifying', 'moving'];
const isNarrow = () => window.matchMedia('(max-width: 820px)').matches;

const WANTED_KEY = 'quo.wantedModel';
const WANTED_FOR_MS = 30 * 60 * 1000;

/** The locked model someone chose and is going to unlock. Kept for a while, in case checkout leaves the page and comes back. */
function storedWanted(): string | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(WANTED_KEY) ?? 'null') as { key: string; at: number } | null;
    return saved && Date.now() - saved.at < WANTED_FOR_MS ? saved.key : null;
  } catch {
    return null;
  }
}

function storeWanted(key: string | null): void {
  try {
    if (key) sessionStorage.setItem(WANTED_KEY, JSON.stringify({ key, at: Date.now() }));
    else sessionStorage.removeItem(WANTED_KEY);
  } catch {
    // Private mode and the like: it just won't survive a reload.
  }
}

function storedChoiceKey(): string | null {
  const key = localStorage.getItem(CHOICE_KEY);
  if (key) return key;
  const legacy = localStorage.getItem(LEGACY_MODEL_KEY);
  return legacy ? `local:${legacy}` : null;
}

/**
 * The model chats run on. Offline first: a cloud model is only ever used when
 * the user picked it; otherwise the chosen (or first) installed offline model.
 */
function resolveChoice(key: string | null, installed: LocalModel[], catalog: CloudCatalog | null): ModelChoice | null {
  if (key?.startsWith('cloud:')) {
    const model = catalog?.models.find(m => `cloud:${m.id}` === key);
    if (model) return { kind: 'cloud', model };
  }
  const local = installed.find(m => `local:${m.id}` === key) ?? installed[0];
  return local ? { kind: 'local', model: local } : null;
}

export function App() {
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(storedChoiceKey);
  const [catalog, setCatalog] = useState<CloudCatalog | null>(cachedCatalog);
  const [account, setAccount] = useState<Account | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [device, setDevice] = useState<DeviceProfile | null>(null);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [getAppOpen, setGetAppOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [paywall, setPaywall] = useState<CloudModel | null>(null);
  const [proOpen, setProOpen] = useState(false);
  const [wantedKey, setWanted] = useState<string | null>(storedWanted);
  const [noticeHidden, setNoticeHidden] = useState(false);
  const [collapsed, setCollapsed] = useState(() => isNarrow() || localStorage.getItem(SIDEBAR_KEY) === '1');
  const chatRef = useRef<ChatHandle>(null);
  const previousStatus = useRef<Record<string, string>>({});

  const closeModels = useCallback(() => setModelsOpen(false), []);
  const closeAccount = useCallback(() => {
    setAccountOpen(false);
    setWanted(null);
    storeWanted(null);
  }, []);
  const closeGetApp = useCallback(() => setGetAppOpen(false), []);
  const closeSync = useCallback(() => setSyncOpen(false), []);
  const closeMemories = useCallback(() => setMemoriesOpen(false), []);

  const select = useCallback((key: string) => {
    localStorage.setItem(CHOICE_KEY, key);
    setSelectedKey(key);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeDownloads(states => {
      setDownloads(states);
      // "Model ready" when a download finishes during this visit.
      for (const [id, state] of Object.entries(states)) {
        const before = previousStatus.current[id];
        if (state.status === 'installed' && before && !['installed', 'idle', 'partial'].includes(before)) {
          const model = getLocalModel(id);
          if (model && localStorage.getItem(CLOUD_UNTIL_OFFLINE_KEY)) {
            localStorage.removeItem(CLOUD_UNTIL_OFFLINE_KEY);
            select(`local:${id}`);
            toast(`${model.name} is ready. Switched to it, so chats stay on this device.`);
          } else if (model) {
            toast(`${model.name} is ready. It works offline now.`);
          }
        }
        previousStatus.current[id] = state.status;
      }
    });
    // Models the user added come first, so they count as installed from the start.
    void refreshCustomModels().then(initDownloads);
    void isPersisted().then(setPersisted);
    void listConversations().then(setConversations).catch(() => {});
    void getDeviceProfile().then(setDevice);
    void loadCatalog().then(setCatalog);
    void refreshAccount();
    void initSync();
    // Chats that arrived from another device.
    const unsubscribeSynced = onSyncedChats(() => void listConversations().then(setConversations).catch(() => {}));
    const unsubscribeAccount = subscribeAccount(setAccount);
    // The native engine can stop on its own (out of memory, a crash); the next message restarts it.
    const unsubscribeEngine = nativeBridge()?.engine.onEvent(event => {
      if (event.type === 'exit') toast('The AI engine stopped. It restarts with your next message.');
    });
    return () => {
      unsubscribe();
      unsubscribeSynced();
      unsubscribeAccount();
      unsubscribeEngine?.();
    };
  }, [select]);

  // Back from checkout (web), or from the browser after buying (desktop app).
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const result = params.get('checkout');
    if (result) {
      if (result === 'success') toast('Thanks! Your purchase is complete.');
      params.delete('checkout');
      params.delete('product');
      const query = params.toString();
      history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
    }
    const onFocus = () => {
      if (getAccount()) void refreshAccount();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  useCustomModels();
  const installed = allLocalModels().filter(m => downloads[m.id]?.status === 'installed');
  const choice = resolveChoice(selectedKey, installed, catalog);
  const current = conversations.find(c => c.id === currentId) ?? null;
  const freeCloud = catalog?.models.find(m => m.id === catalog.defaultModel && m.free) ?? null;

  const setSidebar = useCallback((value: boolean) => {
    setCollapsed(value);
    if (!isNarrow()) localStorage.setItem(SIDEBAR_KEY, value ? '1' : '0');
  }, []);

  const newChat = useCallback(() => {
    void localEngine.stop();
    setCurrentId(null);
    if (isNarrow()) setCollapsed(true);
    setTimeout(() => chatRef.current?.focus(), 0);
  }, []);

  // Keyboard: ⌘/Ctrl+Shift+O new chat, ⌘/Ctrl+B sidebar, "/" focuses the composer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const typing = event.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(event.target.tagName);
      if (mod && event.shiftKey && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        newChat();
      } else if (mod && !event.shiftKey && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setSidebar(!collapsed);
      } else if (event.key === '/' && !typing && !mod) {
        event.preventDefault();
        chatRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [collapsed, newChat, setSidebar]);

  function choose(key: string) {
    if (choice && key === choiceKey(choice)) return;
    if (key.startsWith('cloud:')) {
      // A model this person can't use yet: show what it takes, instead of switching to it.
      const model = catalog?.models.find(m => `cloud:${m.id}` === key);
      if (model && !isUnlocked(model, account)) {
        setPaywall(model);
        return;
      }
    }
    if (key.startsWith('local:') && !installed.some(m => `local:${m.id}` === key)) {
      setModelsOpen(true);
      return;
    }
    // Picking any model by hand ends "cloud until offline is ready".
    localStorage.removeItem(CLOUD_UNTIL_OFFLINE_KEY);
    select(key);
    const name = key.startsWith('cloud:')
      ? catalog?.models.find(m => `cloud:${m.id}` === key)?.name
      : getLocalModel(key.slice('local:'.length))?.name;
    if (name) toast(`Switched to ${name}`);
  }

  // They asked for a locked model, signed in or bought credits, and came back: switch to it.
  useEffect(() => {
    if (!wantedKey) return;
    const model = catalog?.models.find(m => `cloud:${m.id}` === wantedKey);
    if (!model || !isUnlocked(model, account)) return;
    setWanted(null);
    storeWanted(null);
    choose(wantedKey);
  });

  function continueFromPro() {
    setProOpen(false);
    setAccountOpen(true);
  }

  function continueFromPaywall() {
    if (!paywall) return;
    const key = `cloud:${paywall.id}`;
    setWanted(key);
    storeWanted(key);
    setPaywall(null);
    setAccountOpen(true);
  }

  function pickLocalModel(model: LocalModel) {
    choose(`local:${model.id}`);
  }

  function chatInCloudWhileWaiting() {
    if (!freeCloud) return;
    localStorage.setItem(CLOUD_UNTIL_OFFLINE_KEY, '1');
    select(`cloud:${freeCloud.id}`);
    setTimeout(() => chatRef.current?.focus(), 0);
  }

  function onChatAction(action: ChatAction) {
    if (action === 'use-offline' && installed[0]) choose(`local:${installed[0].id}`);
    else if (action === 'use-free' && freeCloud) choose(`cloud:${freeCloud.id}`);
    else setAccountOpen(true);
  }

  const onChange = useCallback((conversation: Conversation, persist: boolean, created?: boolean) => {
    setConversations(list => [conversation, ...list.filter(c => c.id !== conversation.id)]);
    if (created) setCurrentId(conversation.id);
    if (persist) void saveConversation(conversation).catch(() => {});
  }, []);

  function openConversation(id: string) {
    if (id !== currentId) {
      void localEngine.stop();
      setCurrentId(id);
    }
    if (isNarrow()) setCollapsed(true);
  }

  function removeConversation(conversation: Conversation) {
    if (conversation.id === currentId) newChat();
    setConversations(list => list.filter(c => c.id !== conversation.id));
    void deleteConversation(conversation.id).catch(() => {});
    toast('Chat deleted', {
      action: {
        label: 'Undo',
        run: () => {
          setConversations(list => [conversation, ...list]);
          void saveConversation(conversation).catch(() => {});
        },
      },
    });
  }

  const showWelcome = !choice && !current;
  // Anyone not on Pro, once the server has answered, is shown what Pro adds.
  const showProPromo = Boolean(account) && account!.plan !== 'pro' && frontierModels(catalog).length > 0;
  const notice = device ? deviceNotice(device) : null;
  const showNotice = Boolean(notice) && !noticeHidden && !isNoticeDismissed(notice!);

  // The offline download keeps going while the user chats in the cloud.
  const pendingOffline = choice?.kind === 'cloud'
    ? LOCAL_MODELS.find(m => ACTIVE.includes(downloads[m.id]?.status ?? '')) ?? LOCAL_MODELS.find(m => downloads[m.id]?.status === 'partial')
    : undefined;

  // Install / desktop app, offered once Quo has answered on this computer.
  // Firefox and Safari can't reach the graphics card; the desktop app can.
  const slowBrowser = Boolean(device && !device.gpu && (device.browser === 'firefox' || device.browser === 'safari'));
  const answered = conversations.some(c => c.messages.some(m => m.role === 'assistant' && m.content));
  const showNudge = Boolean(device && !device.mobile) && answered && !getAppOpen && !isAppInstalled() && nudgeAllowed();

  return (
    <>
      <div className="lightfield" />
      <div className={`app${collapsed ? ' sidebar-collapsed' : ''}`}>
        <Sidebar
          conversations={conversations}
          currentId={currentId}
          installedCount={installed.length}
          account={account}
          onOpenAccount={() => setAccountOpen(true)}
          onNewChat={newChat}
          onOpen={openConversation}
          onDelete={removeConversation}
          onCollapse={() => setSidebar(true)}
          onOpenModels={() => setModelsOpen(true)}
          onOpenSync={() => setSyncOpen(true)}
          onOpenMemories={() => setMemoriesOpen(true)}
          onOpenPro={() => setProOpen(true)}
          onGetApp={() => setGetAppOpen(true)}
        />
        <div className="drawer-scrim" onClick={() => setSidebar(true)} />

        <main className={`main${showNotice ? ' has-notice' : ''}`}>
          <div className="toolbar">
            {collapsed && (
              <div className="toolbar-cluster glass">
                <button className="icon-btn round press" onClick={() => setSidebar(false)} aria-label="Show sidebar" title={`Show sidebar (${MOD_KEY}+B)`}>
                  <PanelLeftOpen size={19} />
                </button>
                <button className="icon-btn round press" onClick={newChat} aria-label="New chat" title={`New chat (${MOD_KEY}+Shift+O)`}>
                  <SquarePen size={18} />
                </button>
              </div>
            )}
            {!showWelcome && (
              <ModelPicker
                choice={choice}
                catalog={catalog}
                account={account}
                downloads={downloads}
                onChoose={choose}
                onManage={() => setModelsOpen(true)}
                onOpenAccount={() => setAccountOpen(true)}
                onOpenPro={() => setProOpen(true)}
              />
            )}
            {!showWelcome && showProPromo && (
              <button className="pro-chip glass press" onClick={() => setProOpen(true)} aria-label="Frontier models with Quo Pro">
                <Crown size={15} /> <span className="pro-label">Frontier models</span> <span className="pro-tag">Pro</span>
              </button>
            )}
            <span className="spacer" />
            {pendingOffline && (
              <OfflineModelCard
                modelId={pendingOffline.id}
                state={downloads[pendingOffline.id]}
                onPause={() => cancelDownload(pendingOffline.id)}
                onResume={() => void startDownload(pendingOffline)}
              />
            )}
          </div>
          {showNotice && <DeviceBanner notice={notice!} onDismiss={() => setNoticeHidden(true)} onGetApp={() => setGetAppOpen(true)} />}

          {showWelcome
            ? <Welcome device={device} downloads={downloads} onBrowseModels={() => setModelsOpen(true)} cloudModel={freeCloud} onUseCloud={chatInCloudWhileWaiting} catalog={catalog} account={account} onOpenPro={() => setProOpen(true)} />
            : (
              <Chat
                ref={chatRef}
                choice={choice}
                account={account}
                offlineReady={installed.length > 0}
                conversation={current}
                onChange={onChange}
                onAction={onChatAction}
              />
            )}
        </main>
        {showNudge && <InstallNudge slowBrowser={slowBrowser} onMore={() => setGetAppOpen(true)} />}
      </div>

      {modelsOpen && (
        <ModelsSheet
          device={device}
          downloads={downloads}
          activeModelId={choice?.kind === 'local' ? choice.model.id : null}
          persisted={persisted}
          onUse={pickLocalModel}
          onClose={closeModels}
        />
      )}
      {accountOpen && <AccountSheet account={account} onClose={closeAccount} />}
      {memoriesOpen && <MemorySheet onClose={closeMemories} />}
      {proOpen && <ProSheet catalog={catalog} account={account} onClose={() => setProOpen(false)} onContinue={continueFromPro} />}
      {paywall && <PaywallSheet model={paywall} account={account} currentName={choice?.model.name ?? null} onClose={() => setPaywall(null)} onContinue={continueFromPaywall} />}
      {syncOpen && <SyncSheet account={account} onClose={closeSync} onOpenAccount={() => { setSyncOpen(false); setAccountOpen(true); }} />}
      {getAppOpen && <GetAppSheet slowBrowser={slowBrowser} onClose={closeGetApp} />}
      <Toasts />
    </>
  );
}
