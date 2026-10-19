import { useEffect, useRef, useState } from 'react';
import { chatProject, CodeSession, createWorkspace, lastProjectId, pickProject, recentProjects } from '../../agent/session';
import type { CodeSupport } from '../../agent/support';
import { codeSettings } from '../../codeSettings';
import { NativeError, type CodeProject } from '../../native';
import { toast } from '../Toasts';

/**
 * Code mode's state for one chat: the running session (a project folder and its
 * tools), plan mode, and when it has to end. It belongs to one chat and one capable
 * model; leaving either ends it, along with whatever was allowed in it.
 */
export function useCodeMode({ support, conversationId, modelId }: { support: CodeSupport; conversationId: string | undefined; modelId: string | undefined }) {
  const { available, compact, gate, reason } = support;
  const [code, setCode] = useState<CodeSession | null>(null);
  const [starting, setStarting] = useState(false);
  const [plan, setPlan] = useState(false);
  // An offline model that isn't expected to do this well: ask first, once.
  const [caution, setCaution] = useState(false);
  const afterCaution = useRef<(() => Promise<void>) | null>(null);
  // The chat where the person said no to choosing a folder when asked: not asked again there.
  const declinedFolder = useRef<string | null>(null);

  const end = () =>
    setCode(session => {
      session?.end();
      return null;
    });

  useEffect(() => {
    if (!code || available) return;
    code.end();
    setCode(null);
  }, [code, available]);

  // Sending the first message creates the conversation (no id, then an id): that's the same chat, so it stays.
  const lastConversation = useRef(conversationId);
  useEffect(() => {
    const before = lastConversation.current;
    lastConversation.current = conversationId;
    if (before !== undefined && before !== conversationId) end();
  }, [conversationId]);
  useEffect(end, [modelId]);
  useEffect(() => setCaution(false), [modelId]);
  useEffect(() => () => code?.end(), [code]);

  async function start(project: CodeProject): Promise<CodeSession> {
    code?.end();
    const settings = codeSettings();
    const session = await CodeSession.start(project, { autoReadOnly: settings.autoReadOnly, compact, creditQuo: settings.creditQuo });
    if (settings.startInPlan) await session.setPlan(true);
    setPlan(session.plan);
    setCode(session);
    return session;
  }

  /** Runs `action` now, or after the person agrees to use this model for Code mode (an offline one that isn't expected to do well). */
  function guarded(action: () => Promise<void>, confirmed = false): Promise<void> {
    if (gate && !gate.allowed && !confirmed) {
      afterCaution.current = action;
      setCaution(true);
      return Promise.resolve();
    }
    return action();
  }

  /** Turns Code mode on or off (the /code command). On: the folder this chat used, else the last one, else ask. */
  async function toggle() {
    if (code) {
      code.end();
      return setCode(null);
    }
    await guarded(async () => {
      setStarting(true);
      try {
        const recent = await recentProjects();
        const remembered = recent.find(project => project.id === chatProject(conversationId)) ?? recent.find(project => project.id === lastProjectId());
        const project = remembered ?? (await pickProject());
        if (project) await start(project);
      } catch (error) {
        toast(error instanceof NativeError ? error.message : 'Couldn’t turn on Code mode.');
      } finally {
        setStarting(false);
      }
    });
  }

  /** The folder menu: work in this folder (one used before), or pick another in the system's folder dialog. */
  const switchProject = (project: CodeProject) =>
    guarded(async () => {
      try {
        await start(project);
      } catch (error) {
        toast(error instanceof NativeError ? error.message : 'Couldn’t use that folder.');
      }
    });
  const changeFolder = () =>
    guarded(async () => {
      try {
        const project = await pickProject();
        if (project) await start(project);
      } catch (error) {
        toast(error instanceof NativeError ? error.message : 'Couldn’t use that folder.');
      }
    });

  /** A chat that worked in a folder before goes back to it, with no question to anyone: the person already chose it here. */
  async function resume(): Promise<CodeSession | null> {
    if (code) return code;
    if (!available || starting || !codeSettings().autoStart || (gate && !gate.allowed)) return null;
    try {
      const ofThisChat = (await recentProjects()).find(project => project.id === chatProject(conversationId));
      return ofThisChat ? await start(ofThisChat) : null;
    } catch {
      return null;
    }
  }

  /**
   * The model asked for a folder (open_project): it decided, from the whole message, that the request needs the person's
   * files. 'existing' is their project: the folder used last, or, the first time, one they choose in the system dialog
   * (no is remembered for this chat). 'new' is for something built from scratch: a new empty folder under
   * Documents/Quo Projects. Always visible next to the message box and one click to remove. The note is what the model reads.
   */
  async function openProject(kind: 'existing' | 'new', name = ''): Promise<{ session: CodeSession | null; note: string }> {
    if (code) return { session: code, note: '' };
    if (!available || !codeSettings().autoStart || (gate && !gate.allowed)) {
      return { session: null, note: 'Working in a folder is off for this chat. If the person wants it, they can add a folder with the button next to the message box, or turn it on in Settings (Code).' };
    }
    setStarting(true);
    try {
      const recent = await recentProjects();
      const ofThisChat = recent.find(project => project.id === chatProject(conversationId));
      if (kind === 'new') {
        if (ofThisChat) return { session: await start(ofThisChat), note: '' };
        const made = await createWorkspace(name || 'project');
        const session = await start(made);
        toast(`Made a folder for this: Documents/Quo Projects/${made.name}.`);
        return { session, note: '' };
      }
      const known = ofThisChat ?? recent.find(project => project.id === lastProjectId());
      if (known) {
        const session = await start(known);
        toast(`Working in ${known.name}. You can change the folder next to the message box.`);
        return { session, note: '' };
      }
      if (declinedFolder.current === (conversationId ?? '')) return { session: null, note: 'The person already chose no folder in this chat. Carry on without their files.' };
      const picked = await pickProject();
      if (!picked) {
        declinedFolder.current = conversationId ?? '';
        return { session: null, note: 'The person chose no folder, so you can’t use their files. Carry on without, and say what you can still do.' };
      }
      return { session: await start(picked), note: '' };
    } catch (error) {
      return { session: null, note: error instanceof NativeError ? error.message : 'Couldn’t open a folder.' };
    } finally {
      setStarting(false);
    }
  }

  async function togglePlan() {
    if (!code) return;
    try {
      await code.setPlan(!code.plan);
      setPlan(code.plan);
    } catch (error) {
      toast(error instanceof NativeError ? error.message : 'Couldn’t switch plan mode.');
    }
  }

  /** "Turn it on anyway": remembered for this model, which can be changed in Models & storage → Code. */
  async function confirmCaution() {
    gate?.allow();
    setCaution(false);
    const action = afterCaution.current;
    afterCaution.current = null;
    await action?.();
  }

  return { code, available, unavailableReason: reason ?? null, gate, caution, dismissCaution: () => { afterCaution.current = null; setCaution(false); }, confirmCaution, starting, plan, toggle, resume, openProject, changeFolder, switchProject, togglePlan, end };
}

export type CodeMode = ReturnType<typeof useCodeMode>;
