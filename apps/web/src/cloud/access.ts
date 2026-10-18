import type { Account } from './account';
import type { CloudModel } from './catalog';

/**
 * Who can use which cloud model. The free model is for everyone. Every other
 * model is paid for with credits (from Quo Pro or a credit pack), so it's locked
 * until the person is signed in and has enough for a typical message with it.
 * Locked models stay visible: the picker shows them with a lock, and choosing
 * one opens the paywall instead.
 */

export type Lock = 'sign_in' | 'credits';

/** Why a model is locked for this person, or null if they can use it. */
export function lockOf(model: Pick<CloudModel, 'free' | 'creditsPerMessage'>, account: Account | null): Lock | null {
  if (model.free) return null;
  if (!account?.user) return 'sign_in';
  return (account.credits ?? 0) >= model.creditsPerMessage ? null : 'credits';
}

export const isUnlocked = (model: Pick<CloudModel, 'free' | 'creditsPerMessage'>, account: Account | null): boolean => lockOf(model, account) === null;
