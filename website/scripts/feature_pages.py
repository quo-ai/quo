"""Pages about three things the desktop app does that people search for: Claude Agent (/claude-agent/), Code mode
(/code-mode/) and running any GGUF model from Hugging Face (/models/hugging-face/). Only facts from
apps/desktop/README.md and the apps; the models rated for Code mode come from models.json and the number of model kinds
from the engine's own list (apps/web/src/models/architectures.ts). Each page's questions are also its structured data."""
import json
import re
from pathlib import Path

from model_pages import canonical, model_href
from structured_data import questions, trail

SITE = 'https://quo.computer'
ROOT = Path(__file__).resolve().parent.parent.parent  # the repository
DESKTOP = '<a class="btn solid" href="/#desktop">Get the desktop app</a>'
CODE_SHOT = ('<div class="frame-img"><img class="for-light" src="/assets/shots/code-light.webp" width="3200" height="1800" alt="{alt}" loading="lazy">'
             '<img class="for-dark" src="/assets/shots/code-dark.webp" width="3200" height="1800" alt="{alt}" loading="lazy"></div>').format(
    alt='Code mode in the desktop app: the steps it took, a test run, and the changed files beside the chat')

# (address, name in links, one line for llms.txt)
FEATURES = [
    ('/claude-agent/', 'Claude Agent', 'Use Claude in the Quo desktop app through your own Claude Code sign-in, on your own Claude plan.'),
    ('/code-mode/', 'Code mode', 'A coding agent in the desktop app: it reads, changes and tests your code, and you approve every step. Offline or cloud models.'),
    ('/models/hugging-face/', 'Any model from Hugging Face', 'Search Hugging Face from the desktop app and run almost any GGUF model offline.'),
]


def _architectures() -> int:
    """How many kinds of model the bundled llama.cpp loads, from the engine's own list."""
    text = (ROOT / 'apps' / 'web' / 'src' / 'models' / 'architectures.ts').read_text()
    return len(re.findall(r"'[^']+'", text[text.index('new Set(['):]))


def _code_models(models) -> str:
    good = [m for m in models['desktop'] if m.get('codeMode')]
    return ' and '.join(f'<a href="{model_href(m["name"])}">{canonical(m["name"])}</a>' for m in good)


def _pages(models):
    kinds = _architectures()
    return [
        dict(path='/claude-agent/', name='Claude Agent', crumbs=[('Quo', '/')],
             title='Claude Agent: use your Claude plan in a desktop app — Quo',
             desc='The Quo desktop app can use Claude through your own Claude Code sign-in, on your own Claude plan. Chat and Code mode, with every step approved in Quo.',
             h1='Claude Agent: Claude on your own Claude plan',
             lede='Claude Agent lets the Quo desktop app use Claude through your own Claude Code sign-in: your Claude Pro or Max plan, an API key or a cloud account. Use it in chat and in Code mode. Quo charges nothing for it and never sees your login.',
             actions=DESKTOP + '<a class="btn line" href="https://code.claude.com/docs/en/overview">Get Claude Code</a>',
             facts=['Desktop app: Mac, Windows, Linux', 'Your own Claude plan', 'Free in Quo'],
             shot='',
             sections=[
                 ('Set it up', '''<ol>
<li>Install <a href="https://code.claude.com/docs/en/overview">Claude Code</a> from Anthropic, then sign in: run <code>claude auth login</code> in a terminal.</li>
<li>Install the <a href="/#desktop">Quo desktop app</a>.</li>
<li>In Quo, open <strong>Models &amp; storage → Your keys → Claude Agent</strong> and pick a model.</li>
</ol>
<p>On Windows, install Claude Code with Anthropic’s installer: Quo looks for <code>claude.exe</code>.</p>'''),
                 ('What stays yours', '''<ul>
<li><strong>Your sign-in.</strong> You sign in through Anthropic’s own flow. Quo never reads, stores or passes on your login or a token, and it runs only your own, unmodified copy of Claude Code.</li>
<li><strong>Your messages go from your computer to Anthropic,</strong> through your own Claude Code, not through Quo. What you use counts against your own Claude plan.</li>
<li><strong>Quo says who it is.</strong> Claude Code marks each request from Quo as coming from Quo.</li>
<li><strong>No transcripts left behind.</strong> The transcripts Claude Code keeps for Quo’s conversations are deleted when Quo is done with them, and when Quo quits.</li>
</ul>'''),
                 ('What it does', '''<ul>
<li><strong>Chat with the Claude models your plan includes,</strong> with the Thinking levels each one takes.</li>
<li><strong>Code mode.</strong> Claude works in your project through Quo’s tools. Claude Code’s own tools are off, so every edit, command, commit and push needs your OK in Quo, as with any model. <a href="/code-mode/">How Code mode works</a>.</li>
<li><strong>Your plan’s limits in view.</strong> The chat bar shows how much of each limit is used and when it resets, and tells you if replies start using usage credits.</li>
<li><strong>Photos and documents</strong> you attach go to Anthropic with your message, as with any cloud model. Quo doesn’t add your memories.</li>
</ul>'''),
             ],
             asked=[
                 ('Does Claude Agent cost anything in Quo?',
                  'No. Quo charges nothing for it. What you use counts against your own Claude plan, or your API or cloud account, as it does in Claude Code.'),
                 ('Does Quo see my Claude login?',
                  'No. Claude Code signs in through Anthropic’s own flow and keeps its own credentials. Quo never reads, stores or passes on your login or a token, and it never learns your account’s email.'),
                 ('Which Claude plans work?',
                  'Whatever Claude Code is signed in with: a Claude Pro or Max plan, an API key, or a cloud provider account.'),
                 ('Is Quo made by Anthropic?',
                  'No. Quo is made by Astra Labs Ltd and isn’t made or endorsed by Anthropic. Claude and Claude Code are Anthropic’s.'),
             ]),
        dict(path='/code-mode/', name='Code mode', crumbs=[('Quo', '/')],
             title='Code mode: an AI coding agent that works offline — Quo',
             desc='Quo’s Code mode lets a model work in your project: it reads code, makes changes, runs tests, commits and pushes, and you approve every step. Offline or cloud models.',
             h1='Code mode: a coding agent you approve step by step',
             lede='In the Quo desktop app, a model can work in a project folder: it reads the code, makes changes, runs tests, commits and pushes. You approve every step. It works with an offline model on your computer, a cloud model, your own API key, or Claude Agent.',
             actions=DESKTOP,
             facts=['Desktop app: Mac, Windows, Linux', 'Offline or cloud models', 'Open source'],
             shot=CODE_SHOT,
             sections=[
                 ('How it works', '''<ol>
<li>Ask for something that needs your files, or for something to be built. The model opens a project: a folder you choose in a dialog, or a new folder in <code>Documents/Quo Projects</code>.</li>
<li>It reads the code, then proposes changes and commands.</li>
<li>You approve each one in Quo’s approval window, which shows the exact change or command.</li>
<li>It runs the tests and fixes what fails. It commits and pushes when you approve.</li>
</ol>'''),
                 ('What it can do', '''<ul>
<li>Read, search and change files in the project, and undo a change.</li>
<li>Run commands and tests, and leave a dev server running while it works.</li>
<li>Read public GitHub repositories for reference, and search the web.</li>
<li>Commit the files it changed and push the branch. For GitHub, it gives a link to open a pull request.</li>
<li>Follow your project’s <code>AGENTS.md</code> or <code>CLAUDE.md</code>.</li>
</ul>'''),
                 ('You stay in control', '''<ul>
<li><strong>Three levels.</strong> Every session starts at <strong>Ask first</strong>: every edit, command, commit and push is asked about. <strong>Ask if risky</strong> runs edits and ordinary commands, and still asks before commands that delete, install, download or reach outside the project. <strong>Don’t ask</strong> runs everything and still asks before every push.</li>
<li><strong>Approvals are in a window of their own,</strong> made by the app. Nothing the model writes can press its buttons, and closing it means no.</li>
<li><strong>The model stays in the project.</strong> Every path it gives must lead inside the folder. Secrets files such as <code>.env</code> and keys are never read, and well-known token formats are removed from what it sees.</li>
<li><strong>Commits are made by Quo</strong> from the files the model lists. Quo never forces a push.</li>
<li><strong>Plan mode</strong> lets the model only read, to plan before it changes anything.</li>
</ul>'''),
                 ('Which models', f'''<ul>
<li><strong>Offline, on your computer:</strong> nothing leaves it. Models of 9B and up work best; Quo rates {_code_models(models)} Good for Code mode.</li>
<li><strong>Quo’s cloud models</strong> that can use tools, including a free one with a small daily allowance. See <a href="/pricing/">pricing</a>.</li>
<li><strong>Your own API key,</strong> or <a href="/claude-agent/">Claude Agent</a> with your own Claude Code sign-in.</li>
</ul>'''),
             ],
             asked=[
                 ('Does Code mode work offline?',
                  'Yes, with a model on your computer. Nothing leaves it. Small models have small windows, so Quo keeps their sessions compact; models of 9B and up work best.'),
                 ('Can it change things without asking?',
                  'Not at the level every session starts at: each edit, command, commit and push is asked about. A command you approve can do whatever that command does, so read it before you say yes.'),
                 ('What does it cost?',
                  'Nothing with an offline model. Quo’s cloud models use credits for each step, and the free one has a small daily allowance. With your own API key or Claude Agent, your provider bills you.'),
                 ('Does it read my AGENTS.md or CLAUDE.md?',
                  'Yes. A project’s AGENTS.md or CLAUDE.md goes to the model as notes, cleaned of secrets. They can’t override Quo’s rules.'),
             ]),
        dict(path='/models/hugging-face/', name='Any model from Hugging Face', crumbs=[('Quo', '/'), ('Models', '/models/')],
             title='Run any GGUF model from Hugging Face offline — Quo',
             desc='Quo’s desktop app searches Hugging Face, checks which GGUF models its llama.cpp engine can load, picks a file that fits your computer and runs it offline. Free.',
             h1='Run any GGUF model from Hugging Face',
             lede=f'Besides its own list, the Quo desktop app can search Hugging Face and run almost any GGUF model on your computer, offline, with llama.cpp. It checks which models its engine can load ({kinds} kinds of model) before anything downloads, and suggests a file that fits.',
             actions=DESKTOP + '<a class="btn line" href="/models/">Quo’s own models</a>',
             facts=['Desktop app: Mac, Windows, Linux', 'Runs offline', 'Free'],
             shot='',
             sections=[
                 ('How it works', '''<ol>
<li>In <strong>Models &amp; storage</strong>, open <strong>Any model from Hugging Face</strong> and search.</li>
<li>Quo marks the models its engine can’t load, and the ones that only embed text or speak, before anything downloads.</li>
<li>It suggests a file that fits your computer: a 4-bit file where it fits, never under 3 bits.</li>
<li>Press <strong>Add and download</strong>. The download is checked like any other, and the model then runs offline like Quo’s own.</li>
</ol>'''),
                 ('Models you already have', '''<ul>
<li>Models you downloaded with LM Studio or Ollama, or a GGUF file you pick, run where they are. Quo never copies them, and forgetting one in Quo never deletes the file.</li>
<li>Split (multi-part) GGUF files and files under 3 bits aren’t offered.</li>
</ul>'''),
             ],
             asked=[
                 ('Which models can Quo run from Hugging Face?',
                  f'Any GGUF model whose kind the bundled llama.cpp loads ({kinds} kinds at present). Quo checks before anything downloads and says when a model can’t run.'),
                 ('Does it work without the internet?',
                  'Yes, after the download. The model runs on your computer, and your chats stay there.'),
                 ('Where are the files kept?',
                  'In Quo’s own folder for models. Models you already have from LM Studio or Ollama are used where they are, never copied.'),
                 ('Is it free?',
                  'Yes. Running models on your computer is free, with no account and no limits.'),
             ]),
    ]


def _page(p):
    others = [f'<li><a href="{path}">{name}</a></li>' for path, name, _ in FEATURES if path != p['path']]
    body = f'''<h1>{p["h1"]}</h1>
<div class="summary"><p>{p["lede"]}</p></div>
<div class="actions">{p["actions"]}</div>
<ul class="facts-line">{''.join(f"<li>{fact}</li>" for fact in p["facts"])}</ul>
{p["shot"]}
{chr(10).join(f"{chr(10)}<h2>{heading}</h2>{chr(10)}{html}" for heading, html in p["sections"])}

<h2>Questions</h2>
{chr(10).join(f'<h3>{q}</h3>{chr(10)}<p>{a}</p>' for q, a in p["asked"])}

<h2>More in the desktop app</h2>
<ul class="facts-line">{''.join(others)}<li><a href="/windows/">Windows</a></li><li><a href="/mac/">Mac</a></li><li><a href="/linux/">Linux</a></li></ul>

{questions(p["asked"])}
{trail([(name, SITE + path) for name, path in p["crumbs"]] + [(p["name"], SITE + p["path"])])}
'''
    return (p['path'].strip('/') + '/index.html', p['path'], p['title'], p['desc'], body, 'doc wide')


def feature_pages(path: Path) -> list:
    return [_page(p) for p in _pages(json.loads(path.read_text()))]


def feature_links() -> list:
    """(name, address, one line) for each page, for llms.txt."""
    return [(name, SITE + path, line) for path, name, line in FEATURES]
