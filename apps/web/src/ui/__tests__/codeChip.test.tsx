import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CodeSession } from '../../agent/session';
import { CodeChip } from '../CodeChip';

const base = { starting: false, disabled: false, plan: false, onTogglePlan: () => {}, onSwitchProject: () => {}, onChooseFolder: () => {}, onRemove: () => {} };
const session = { project: { id: 'p1', name: 'my-app', hint: '~/work' }, info: { git: { branch: 'main', changed: 3 }, hint: '~/work' } } as unknown as CodeSession;

describe('the folder next to the message box', () => {
  it('is there without any folder, saying so, and offers no Code switch or plan mode', () => {
    const html = renderToStaticMarkup(createElement(CodeChip, { ...base, session: null }));
    expect(html).toContain('No folder');
    expect(html).not.toContain('Plan');
    expect(html).not.toMatch(/>Code</);
  });

  it('shows the folder, its branch and changes, and plan mode, once there is one', () => {
    const html = renderToStaticMarkup(createElement(CodeChip, { ...base, session }));
    expect(html).toContain('my-app');
    expect(html).toContain('main');
    expect(html).toContain('+3');
    expect(html).toContain('Plan');
    expect(html).not.toContain('No folder');
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
