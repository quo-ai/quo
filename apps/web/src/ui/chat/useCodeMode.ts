import { useEffect, useRef, useState } from 'react';
import { CodeSession, lastProjectId, pickProject, recentProjects } from '../../agent/session';
import { NativeError, type CodeProject } from '../../native';
import { toast } from '../Toasts';

/**
 * Code mode's state for one chat: the running session (a project folder and its
 * tools), plan mode, and when it has to end. It belongs to one chat and one capable
 * model; leaving either ends it, along with whatever was allowed in it.
 */
export function useCodeMode({ available, conversationId, modelId }: { available: boolean; conversationId: string | undefined; modelId: string | undefined }) {
  const [code, setCode] = useState<CodeSession | null>(null);
  const [starting, setStarting] = useState(false);
  const [plan, setPlan] = useState(false);

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
  useEffect(() => () => code?.end(), [code]);

  async function start(project: CodeProject) {
    code?.end();
    const session = await CodeSession.start(project);
    setPlan(false);
    setCode(session);
  }

  async function toggle() {
    if (code) {
      code.end();
      return setCode(null);
    }
    setStarting(true);
    try {
      const last = (await recentProjects()).find(project => project.id === lastProjectId());
      const project = last ?? (await pickProject());
      if (project) await start(project);
    } catch (error) {
      toast(error instanceof NativeError ? error.message : 'Couldn’t turn on Code mode.');
    } finally {
      setStarting(false);
    }
  }

  async function changeFolder() {
    try {
      const project = await pickProject();
      if (project) await start(project);
    } catch (error) {
      toast(error instanceof NativeError ? error.message : 'Couldn’t use that folder.');
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

  return { code, starting, plan, toggle, changeFolder, togglePlan, end };
}

export type CodeMode = ReturnType<typeof useCodeMode>;
