import { environmentNote, validOffset, type Environment } from '../../shared/environment';
import type { ModelChoice } from '../models';

/** What this device tells the model about the moment: the offset of its clock from UTC (never a place). */
export function deviceInfo(): Pick<Environment, 'utcOffset'> {
  return { utcOffset: validOffset(-new Date().getTimezoneOffset()) };
}

/** The environment for a model, with the time taken now: ask again for every request, so the clock is right. */
export function environmentFor(choice: ModelChoice): Environment {
  return {
    ...deviceInfo(),
    now: new Date(),
    model: { name: choice.model.name, provider: choice.kind === 'cloud' ? choice.model.provider : undefined },
    route: choice.kind === 'local' ? 'device' : choice.kind === 'cloud' ? 'quo-cloud' : 'own-key',
    ownProvider: choice.kind === 'own' ? choice.provider.name : undefined,
  };
}

/** The note to add to the end of a prompt. */
export const noteFor = (choice: ModelChoice): string => environmentNote(environmentFor(choice));
