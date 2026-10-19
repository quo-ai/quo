import { environmentNote, validLanguage, validOffset, type Capability, type Environment } from '../../shared/environment';
import { codeSupport } from '../agent/support';
import type { ModelChoice } from '../models';

/** What this device reports about itself: its clock's offset from UTC and its language, and which program (the desktop app or the web app) this is. */
export function deviceInfo(): Pick<Environment, 'utcOffset' | 'language' | 'app'> {
  const desktop = typeof window === 'undefined' ? undefined : window.quoDesktop;
  const platform = desktop?.platform === 'win32' || desktop?.platform === 'darwin' || desktop?.platform === 'linux' ? desktop.platform : undefined;
  return {
    // How far the clock is from UTC right now, and the language alone: no time zone name, no country.
    utcOffset: validOffset(-new Date().getTimezoneOffset()),
    language: validLanguage(typeof navigator === 'undefined' ? undefined : navigator.language),
    app: desktop ? { name: 'Quo Desktop', version: desktop.version, platform } : { name: 'Quo Web' },
  };
}

/** The environment for a model, with the time taken now: ask again for every request, so the clock is right. */
export function environmentFor(choice: ModelChoice, can: Capability[], extra: { project?: string; plan?: boolean; folderTool?: boolean } = {}): Environment {
  const support = codeSupport(choice);
  const desktop = typeof window !== 'undefined' && Boolean(window.quoDesktop?.agent);
  return {
    ...deviceInfo(),
    now: new Date(),
    model: { name: choice.model.name, provider: choice.kind === 'cloud' ? choice.model.provider : undefined },
    route: choice.kind === 'local' ? 'device' : choice.kind === 'cloud' ? 'quo-cloud' : 'own-key',
    ownProvider: choice.kind === 'own' ? choice.provider.name : undefined,
    can,
    brief: choice.kind === 'local',
    files: !desktop ? 'browser' : support.available ? 'folder' : 'model',
    ...extra,
  };
}

/** The note to add to the end of a prompt. */
export const noteFor = (choice: ModelChoice, can: Capability[], extra: { project?: string; plan?: boolean; folderTool?: boolean } = {}): string => environmentNote(environmentFor(choice, can, extra));
