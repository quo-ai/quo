import { useEffect, useRef, useState } from 'react';
import { chatProject, CodeSession, lastProjectId, pickProject, recentProjects } from '../../agent/session';
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
  const { available, compact, gate } = support;
  const [code, setCode] = useState<CodeSession | null>(null);
  const [starting, setStarting] = useState(false);
  const [plan, setPlan] = useState(false);
  // An offline model that isn't expected to do this well: ask first, once.
  const [caution, setCaution] = useState(false);

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

  async function start(project: CodeProject) {
    code?.end();
    const settings = codeSettings();
    const session = await CodeSession.start(project, { autoReadOnly: settings.autoReadOnly, compact });
    if (settings.startInPlan) await session.setPlan(true);
    setPlan(session.plan);
    setCode(session);
  }

  async function toggle(confirmed = false) {
    if (code) {
      code.end();
      return setCode(null);
    }
    if (gate && !gate.allowed && !confirmed) return setCaution(true);
    setCaution(false);
    setStarting(true);
    try {
      // The folder this chat used, else the last one used anywhere, else ask.
      const recent = await recentProjects();
      const remembered = recent.find(project => project.id === chatProject(conversationId)) ?? recent.find(project => project.id === lastProjectId());
      const project = remembered ?? (await pickProject());
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

  /** Switches to another folder from the recent ones. */
  async function switchProject(project: CodeProject) {
    try {
      await start(project);
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

  /** "Turn it on anyway": remembered for this model, which can be changed in Models & storage → Code. */
  async function confirmCaution() {
    gate?.allow();
    await toggle(true);
  }

  return { code, available, gate, caution, dismissCaution: () => setCaution(false), confirmCaution, starting, plan, toggle: () => toggle(), changeFolder, switchProject, togglePlan, end };
}

export type CodeMode = ReturnType<typeof useCodeMode>;
