// At most one prompt (analytics consent, review request or upgrade nudge) per app
// session, so users are never hit with two in a row.
let shownThisSession = false;

export function canShowSessionPrompt(): boolean {
  return !shownThisSession;
}

export function markSessionPromptShown(): void {
  shownThisSession = true;
}
