'use strict';

// Draws one approval request. Everything the model influenced goes in through textContent, never as markup, and the page's
// content policy allows no inline script or remote anything, so none of it can act like a button.

const card = document.getElementById('card');
const SVG = 'http://www.w3.org/2000/svg';
const ICONS = {
  edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z'],
  command: ['m4 17 6-6-6-6', 'M12 19h8'],
  commit: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M3 12h6', 'M15 12h6'],
  push: ['M12 19V5', 'm5 12 7-7 7 7'],
  read: ['M6 14l1.5-2.4A2 2 0 0 1 9.2 10H20a2 2 0 0 1 1.9 2.6l-1.6 5.2a2 2 0 0 1-1.9 1.4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H18a2 2 0 0 1 2 2v1'],
  folder: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z', 'M12 10v6', 'M9 13h6'],
  open: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(kind) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of ICONS[kind] ?? ICONS.edit) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

function diffBlock(diff) {
  const pre = el('pre', 'diff');
  for (const line of diff.split('\n')) {
    const row = el('span', `line${line.startsWith('+') ? ' add' : line.startsWith('-') ? ' del' : line.startsWith('@@') ? ' hunk' : ''}`, line === '' ? ' ' : line);
    pre.appendChild(row);
  }
  return pre;
}

function body(request) {
  const view = request.view;
  const box = el('div', 'body');
  if (view.kind === 'edit') {
    const chips = el('div', 'chips');
    chips.appendChild(el('span', 'chip', view.file));
    if (view.added) chips.appendChild(el('span', 'chip add', `+${view.added}`));
    if (view.removed) chips.appendChild(el('span', 'chip del', `−${view.removed}`));
    box.appendChild(chips);
    if (view.diff) box.appendChild(diffBlock(view.diff));
  } else if (view.kind === 'command') {
    if (view.background || view.warning) {
      const chips = el('div', 'chips');
      if (view.warning) chips.appendChild(el('span', 'chip warn', view.warning));
      if (view.background) chips.appendChild(el('span', 'chip warn', 'Keeps running in the background until you end Code mode'));
      box.appendChild(chips);
    }
    const pre = el('pre', 'cmd');
    pre.appendChild(el('span', 'prompt', '$ '));
    pre.appendChild(document.createTextNode(view.command));
    box.appendChild(pre);
  } else if (view.kind === 'commit') {
    const chips = el('div', 'chips');
    if (view.branch) chips.appendChild(el('span', 'chip', `branch ${view.branch}`));
    if (view.author) chips.appendChild(el('span', 'chip', `by ${view.author}`));
    box.appendChild(chips);
    const list = el('ul', 'files');
    for (const file of view.files) list.appendChild(el('li', '', file));
    box.appendChild(list);
    const message = el('div', 'message');
    message.appendChild(document.createTextNode(view.message));
    if (view.credit) {
      message.appendChild(document.createTextNode('\n\n'));
      message.appendChild(el('span', 'credit', view.credit));
    }
    box.appendChild(message);
    box.appendChild(el('p', 'note', 'Nothing is pushed. The last line credits Quo as co-author; you can turn that off in Models & storage → Code.'));
  } else if (view.kind === 'push') {
    const chips = el('div', 'chips');
    chips.appendChild(el('span', 'chip', `${view.branch} → ${view.remote}/${view.remoteBranch}`));
    if (view.newBranch) chips.appendChild(el('span', 'chip', 'new branch'));
    if (view.toDefault) chips.appendChild(el('span', 'chip warn', `Straight to ${view.defaultBranch}, the default branch`));
    box.appendChild(chips);
    const list = el('ul', 'files');
    for (const line of view.commits) list.appendChild(el('li', '', line));
    if (view.count > view.commits.length) list.appendChild(el('li', '', `… and ${view.count - view.commits.length} more`));
    box.appendChild(list);
    box.appendChild(el('p', 'note', `To ${view.url}. Never forced: if the remote has changed, the push stops. You can turn pushing off in Models & storage → Code.`));
  } else if (view.kind === 'read') {
    const chips = el('div', 'chips');
    chips.appendChild(el('span', 'chip', view.folder));
    box.appendChild(chips);
    box.appendChild(el('p', 'note', 'It is outside the project. Quo can list, read and search there, and never change anything. Keys, credentials and .env files stay unreadable.'));
  } else if (view.kind === 'folder') {
    const chips = el('div', 'chips');
    chips.appendChild(el('span', 'chip', view.name));
    if (view.where) chips.appendChild(el('span', 'chip', view.where));
    box.appendChild(chips);
    box.appendChild(el('p', 'note', view.mode === 'new'
      ? 'Quo makes an empty folder here and works in it. It can read what it makes, and asks before every change or command. You can remove the folder from the chat at any time.'
      : 'Quo can read the files here. Nothing is changed or run without your OK, and files a cloud model reads are sent to its provider.'));
  } else if (view.kind === 'open') {
    const chips = el('div', 'chips');
    chips.appendChild(el('span', 'chip', view.target));
    box.appendChild(chips);
    box.appendChild(el('p', 'note', view.what === 'url' ? 'This address is on your own computer (a server Quo started). It opens in your default browser.' : 'It opens in your default browser or viewer. Pages can run scripts in the browser, so only open it if you expect it.'));
  }
  return box;
}

function show(request) {
  card.replaceChildren();
  const head = el('div', 'head');
  const mark = el('div', 'icon');
  mark.appendChild(icon(request.kind));
  head.appendChild(mark);
  const titles = el('div', 'titles');
  titles.appendChild(el('h1', '', request.title)).id = 'title';
  if (request.project) titles.appendChild(el('p', 'sub', `In the project ${request.project}`));
  head.appendChild(titles);
  card.appendChild(head);
  const box = body(request);
  card.appendChild(box);

  const foot = el('div', 'foot');
  foot.appendChild(el('span', 'hint', 'Esc to decline'));
  const deny = el('button', '', request.kind === 'command' ? 'Don’t run' : request.kind === 'commit' ? 'Don’t commit' : request.kind === 'push' ? 'Don’t push' : request.kind === 'open' ? 'Don’t open' : request.kind === 'folder' ? 'Not now' : 'Don’t allow');
  deny.type = 'button';
  deny.addEventListener('click', () => window.quoApproval.answer('deny'));
  foot.appendChild(deny);
  if (request.rememberLabel) {
    const remember = el('button', '', 'Allow for this session');
    remember.type = 'button';
    remember.addEventListener('click', () => window.quoApproval.answer('session'));
    foot.appendChild(remember);
  }
  const allow = el('button', 'primary', request.kind === 'command' ? 'Run it' : request.kind === 'commit' ? 'Commit' : request.kind === 'push' ? 'Push' : request.kind === 'open' ? 'Open' : request.kind === 'folder' ? (request.view.mode === 'new' ? 'Make the folder' : 'Work here') : 'Allow');
  allow.type = 'button';
  allow.addEventListener('click', () => window.quoApproval.answer('once'));
  foot.appendChild(allow);
  card.appendChild(foot);

  deny.focus(); // Enter means no
  // The card is height-capped (it scrolls inside), so measure what it wants: its parts, not itself.
  const wanted = () => head.offsetHeight + box.scrollHeight + foot.offsetHeight + 40;
  requestAnimationFrame(() => window.quoApproval.resize(wanted()));
}

document.addEventListener('keydown', event => {
  if (!event.isTrusted) return;
  if (event.key === 'Escape') window.quoApproval.answer('deny');
  else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) window.quoApproval.answer('once');
});

window.quoApproval.onShow(show);
