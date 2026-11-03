"""The comparison page (/compare/): Quo next to the local AI apps people weigh it against. Facts only, as of the date
below, including where the others are ahead; change a row when either side changes."""
import html

esc = html.escape
CHECKED = 'November 2026'

APPS = ['Quo', 'LM Studio', 'Jan', 'GPT4All', 'Ollama']
# (what, Quo, LM Studio, Jan, GPT4All, Ollama). "Yes", "No", or a few words.
ROWS = [
    ('Source code', 'Open (Apache 2.0)', 'Closed (free to use)', 'Open', 'Open (MIT)', 'Open (MIT)'),
    ('Works offline', 'Yes, by default', 'Yes', 'Yes', 'Yes', 'Yes'),
    ('In a browser, no install', 'Yes', 'No', 'No', 'No', 'No'),
    ('Phone app', 'Android', 'No', 'No', 'No', 'No'),
    ('Runs GGUF models from Hugging Face', 'Yes', 'Yes', 'Yes', 'Some', 'Its own library, and GGUF'),
    ('Makes images on your computer', 'Yes', 'No', 'No', 'No', 'No'),
    ('Coding agent in your project folder', 'Yes, asks before each step', 'Agent features (new)', 'Agents (preview)', 'No', 'No (other tools use it)'),
    ('Chats synced between devices, end-to-end encrypted', 'Yes (Quo Sync)', 'No', 'No', 'No', 'No'),
    ('Cloud models in the same app, clearly marked', 'Yes', 'No', 'Your own keys', 'No', 'Separate service'),
    ('Local server for other apps (OpenAI-style API)', 'No', 'Yes', 'Yes', 'Yes', 'Yes'),
    ('MCP tool servers', 'No', 'Yes', 'Yes', 'No', 'Through other apps'),
    ('Mac engine', 'llama.cpp (Metal)', 'MLX and llama.cpp', 'llama.cpp, MLX in testing', 'llama.cpp', 'llama.cpp, some MLX'),
]


def compare_page() -> str:
    head = ''.join(f'<th scope="col">{esc(app)}</th>' for app in APPS)
    rows = ''.join(
        '<tr>' + f'<th scope="row">{esc(row[0])}</th>' + ''.join(f'<td>{esc(cell)}</td>' for cell in row[1:]) + '</tr>\n'
        for row in ROWS
    )
    return f'''<h1>Quo compared with LM Studio, Jan, GPT4All and Ollama</h1>
<p>All five run AI models on your own computer, so your chats can stay private. They differ in where they run, what else they do, and whether you can read their code. This table is how they compare as of {CHECKED}; tell us if something has changed.</p>
<div class="table-wrap"><table class="model-table">
<thead><tr><th scope="col"></th>{head}</tr></thead>
<tbody>
{rows}</tbody></table></div>

<h2>When another app may suit you better</h2>
<ul>
<li><strong>LM Studio</strong> has the most polished model browser and, on a Mac, the MLX engine, which is often the fastest there. It is free but not open source.</li>
<li><strong>Ollama</strong> is the usual choice for developers who want a command line and a local server that other tools connect to.</li>
<li><strong>Jan</strong> is open source and adds tool servers (MCP) and a local server, on the desktop.</li>
<li><strong>GPT4All</strong> is simple, and its LocalDocs feature answers questions from a folder of documents.</li>
</ul>

<h2>What Quo adds</h2>
<ul>
<li><strong>One app on every device:</strong> in the browser with nothing to install, on Mac, Windows and Linux, and on Android, with your chats synced end-to-end encrypted if you choose.</li>
<li><strong>Images made on your computer</strong>, with open models (Z-Image Turbo, FLUX.2 klein), or your own SDXL or Stable Diffusion file.</li>
<li><strong>A coding agent</strong> that works in your project folder and asks before every change, command, commit and push, in windows the model can’t touch.</li>
<li><strong>Voice</strong> in and out, and <strong>cloud models</strong> beside the offline ones when you want them, each reply showing where it ran.</li>
</ul>
<p>Quo is free and open source (Apache 2.0). <a data-link="webapp" href="https://app.quo.computer/">Try it in your browser</a>, or <a href="/#desktop">get the desktop app</a>. See <a href="/models/">which models run on your device</a>.</p>
'''
