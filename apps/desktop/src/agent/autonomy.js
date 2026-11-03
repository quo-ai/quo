'use strict';

// How much Quo Code may do without asking. A session starts at "ask"; only the person can change it, in a window the main
// process makes (ipc.js: agent:autonomy), and it lasts for that session only.
//
//   ask    every edit, command, commit, push, opened page and outside folder is asked about (read-only commands run, as
//          a setting allows).
//   risky  edits in the project, opened pages and commands that aren't risky run without asking. Risky commands (below),
//          commits, pushes and reading outside the project still ask.
//   all    everything runs without asking except pushes, which publish the work.
//
// No level changes the fixed limits: secrets files stay unreadable and well-known token formats redacted, settings that
// can run commands stay read-only, force pushes, amends and skipped hooks are refused, background commands are limited,
// and Code mode works only in the project the person chose.
//
// "Risky" is a list, so it can't know every risky command: it errs on asking (anything that deletes, moves, installs,
// downloads, reaches another computer, needs an administrator, changes the system, runs code it fetched, or names a path
// outside the project). The level is for projects the person trusts; "ask" is the safe one.

const LEVELS = ['ask', 'risky', 'all'];

const RISKY = [
  // Deletes or overwrites.
  /(^|[\s;&|(`])(rm|rmdir|rd|del|erase|unlink|shred|truncate|mv|move|ren|rename)(\s|$)/i,
  /\bRemove-Item\b|\bMove-Item\b|\bRename-Item\b|\bClear-Content\b|\bSet-Content\b|\bOut-File\b/i,
  /\bgit\s+(clean|reset|restore|push|rebase|filter-branch|gc)\b|\bgit\s+checkout\s+(--|\.)|\bgit\s+stash\s+(drop|clear)\b|\bgit\s+branch\s+-[dD]\b|\bgit\s+reflog\s+expire\b/i,
  /(^|[^2&])>(?!&)|>>/, // writing a file with the shell
  // Administrator rights and the system itself.
  /(^|[\s;&|(`])(sudo|su|doas|pkexec|runas|chmod|chown|chgrp|icacls|takeown|attrib|setx|reg|regedit|sc|net|netsh|bcdedit|diskpart|format|mkfs|fdisk|dd|mount|umount|shutdown|reboot|poweroff|halt|systemctl|service|launchctl|crontab|schtasks|wmic|kill|killall|pkill|taskkill)(\s|$)/i,
  /\bStart-Process\b.*-Verb\s+RunAs|\bSet-ExecutionPolicy\b|\bStop-Process\b|\bStop-Computer\b|\bRestart-Computer\b/i,
  // Installs software or runs code it fetched.
  /\b(npm|pnpm|yarn|bun)\s+(i|install|add|remove|uninstall|publish|link|exec|dlx|x|create|init)\b/i,
  /(^|[\s;&|(`])(npx|bunx|pnpx|pipx)(\s|$)/i,
  /\b(pip3?|python3?\s+-m\s+pip|uv\s+pip|gem|cargo|go|composer|dotnet|nuget|brew|apt|apt-get|dnf|yum|pacman|zypper|snap|flatpak|winget|choco|scoop|conda|mamba)\s+(install|add|uninstall|remove|publish|tool\s+install|get)\b/i,
  /\|\s*(sh|bash|zsh|fish|pwsh|powershell|cmd|python3?|node|perl|ruby|iex)\b|\b(iex|Invoke-Expression|eval|exec)\b|-enc(odedcommand)?\b|\bbase64\s+(-d|--decode)\b/i,
  // Reaches another computer.
  /(^|[\s;&|(`])(curl|wget|ssh|scp|sftp|rsync|ftp|tftp|nc|ncat|netcat|telnet|socat|aria2c)(\s|$)/i,
  /\b(Invoke-WebRequest|Invoke-RestMethod|iwr|irm|Start-BitsTransfer|New-Object\s+Net\.WebClient)\b/i,
  /\bgit\s+(clone|fetch|pull|remote\s+(add|set-url)|submodule)\b/i,
  // Paths outside the project: absolute paths, the home folder, a parent folder, another drive.
  /(^|[\s"'=;&|(`])(\/(?!dev\/null\b)|~|\.\.(\/|\\|$|\s)|[A-Za-z]:[\\/]|\\\\|%[A-Za-z_]+%|\$(HOME|env:|USERPROFILE|APPDATA|TEMP|TMP)\b)/i,
  /(^|[\s;&|(`])cd\s+\/d\b|(^|[\s;&|(`])(pushd|chdir)(\s|$)/i,
];

/** True when "risky" should still ask about this command. */
function isRiskyCommand(command) {
  const text = String(command ?? '');
  return text.length === 0 || RISKY.some(pattern => pattern.test(text));
}

/** Whether a step needs the person's answer at this level. `kind`: edit, command, open, commit, push, external. */
function needsAsking(level, kind, { command } = {}) {
  if (kind === 'push') return true;
  if (level === 'all') return false;
  if (level === 'risky') {
    if (kind === 'edit' || kind === 'open') return false;
    if (kind === 'command') return isRiskyCommand(command);
    return true; // commits and folders outside the project
  }
  return true;
}

/** What the person is told before choosing a level (ipc.js shows it in a native dialog). */
const DESCRIPTIONS = {
  risky: {
    message: 'Let Quo work without asking, except for risky steps?',
    detail: 'For this session, Quo edits files in the project and runs commands without asking you first.\n\nIt still asks before commands that delete, move or install anything, download or reach another computer, need administrator rights, or touch files outside the project, and before every commit and push. It can’t recognise every risky command, so use this for projects you trust.',
    button: 'Ask only for risky steps',
  },
  all: {
    message: 'Let Quo do everything without asking?',
    detail: 'For this session, Quo edits files, runs any command (including ones that delete files, install software or reach the internet), reads outside the project and commits, all without asking you first. It still asks before every push.\n\nSecrets files stay unreadable and force pushes stay refused, but a command can still do anything you could do in a terminal. Use this only for projects you trust, or a folder you can throw away.',
    button: 'Don’t ask',
  },
};

module.exports = { LEVELS, isRiskyCommand, needsAsking, DESCRIPTIONS };
