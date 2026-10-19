export type PlanStatus = 'completed' | 'in_progress' | 'pending';
export interface PlanItem {
  step: string;
  status: PlanStatus;
}

const MARK: Record<PlanStatus, string> = { completed: '[x]', in_progress: '[>]', pending: '[ ]' };

/** The plan as lines of text, one per step, to keep with a chat step. */
export const planToText = (items: PlanItem[]): string => items.map(item => `${MARK[item.status]} ${item.step}`).join('\n');

/** The lines back as steps (anything that isn't a plan line is left out). */
export function planFromText(text: string): PlanItem[] {
  return text.split('\n').flatMap((line): PlanItem[] => {
    const match = /^\[(x|>| )\] (.+)$/.exec(line);
    return match ? [{ step: match[2], status: match[1] === 'x' ? 'completed' : match[1] === '>' ? 'in_progress' : 'pending' }] : [];
  });
}
