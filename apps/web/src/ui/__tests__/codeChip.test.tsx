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
