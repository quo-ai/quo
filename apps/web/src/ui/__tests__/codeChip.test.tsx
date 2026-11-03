import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CodeSession } from '../../agent/session';
import { CodeChip } from '../CodeChip';

const base = { starting: false, disabled: false, plan: false, onTogglePlan: () => {}, autonomy: 'ask' as const, onAutonomy: () => {}, onSwitchProject: () => {}, onChooseFolder: () => {}, onRemove: () => {} };
const session = { project: { id: 'p1', name: 'my-app', hint: '~/work' }, info: { git: { branch: 'main', changed: 3 }, hint: '~/work' } } as unknown as CodeSession;

describe('the folder next to the message box', () => {
  it('is there without any folder, saying so, and offers no Code switch or plan mode', () => {
    const html = renderToStaticMarkup(createElement(CodeChip, { ...base, session: null }));
    expect(html).toContain('No folder');
    expect(html).not.toContain('Plan');
    expect(html).not.toContain('Ask first');
    expect(html).not.toMatch(/>Code</);
  });

  it('shows the folder, its branch and changes, and plan mode, once there is one', () => {
    const html = renderToStaticMarkup(createElement(CodeChip, { ...base, session }));
    expect(html).toContain('my-app');
    expect(html).toContain('main');
    expect(html).toContain('+3');
    expect(html).toContain('Ask first'); // the mode menu, which also holds plan mode
    expect(html).not.toContain('No folder');
  });

  it('shows plan mode, or how much Quo does without asking, on the mode chip', () => {
    expect(renderToStaticMarkup(createElement(CodeChip, { ...base, session, plan: true }))).toContain('Plan');
    expect(renderToStaticMarkup(createElement(CodeChip, { ...base, session, autonomy: 'risky' }))).toContain('Ask if risky');
    const all = renderToStaticMarkup(createElement(CodeChip, { ...base, session, autonomy: 'all' }));
    expect(all).toContain('Don’t ask');
    expect(all).toContain('aria-pressed="true"');
  });
});

describe('the folder when the model cannot use it', () => {
  it('shows a disabled chip that says why, instead of nothing', () => {
    const reason = 'GPT-6 Luna can’t work in a project folder: choose a stronger model.';
    const html = renderToStaticMarkup(createElement(CodeChip, { ...base, session: null, unavailable: reason }));
    expect(html).toContain('No folder');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('choose a stronger model');
    expect(html).not.toContain('aria-haspopup');
  });
});
