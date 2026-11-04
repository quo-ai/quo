"""Pages built from the project's own data, used by generate-pages.py: the model page (from models.json, which
`npm run models` in apps/web writes from the apps' catalogs) and the changelog (from CHANGELOG.md)."""
import html
import json
import re
from pathlib import Path

esc = html.escape


def _yes(flag):
    return 'Yes' if flag else 'No'


def _table(models, columns):
    head = ''.join(f'<th scope="col">{name}</th>' for name, _ in columns)
    rows = []
    for m in models:
        cells = []
        for i, (_, cell) in enumerate(columns):
            cells.append(f'<th scope="row">{cell(m)}</th>' if i == 0 else f'<td>{cell(m)}</td>')
        rows.append('<tr>' + ''.join(cells) + '</tr>\n')
    return f'<div class="table-wrap"><table class="model-table">\n<thead><tr>{head}</tr></thead>\n<tbody>\n{"".join(rows)}</tbody></table></div>'


def models_page(path: Path) -> str:
    data = json.loads(path.read_text())
    from model_pages import model_href
    name = ('Model', lambda m: f'<strong><a href="{model_href(m["name"])}">{esc(m["name"])}</a></strong>')
    good = ('Good at', lambda m: esc(m['description']))
    size = ('Download', lambda m: f'{m["downloadGB"]:g} GB')
    memory = ('Memory it needs', lambda m: f'{m["memoryGB"]} GB')
    photos = ('Reads photos', lambda m: _yes(m['photos']))
    thinks = ('Thinks first', lambda m: _yes(m['thinking']))
    code = ('Code mode', lambda m: 'Good' if m.get('codeMode') else 'Basic')
    plan = ('Free or Premium', lambda m: 'Free' if m.get('free') else 'Premium')
    return f'''<h1>Which AI model runs on my device?</h1>
<p>Quo runs open AI models on your own device. You download a model once. After that it works with no internet, and what you type stays on your device. Quo looks at your device and suggests a model that runs well; this page lists every model in Quo and what each one needs.</p>
<p>Memory decides which models run well. A bigger model gives better answers but needs more memory, and a model that doesn’t fit runs slowly or not at all.</p>

<h2>On a computer: the desktop app</h2>
<p>The desktop app runs models on your graphics card with llama.cpp, on Mac, Windows and Linux. It can also search Hugging Face and run almost any GGUF model. “Memory it needs” is the computer’s memory, or the graphics card’s own memory when the model runs there. The download includes the file for reading photos.</p>
{_table(data["desktop"], [name, good, size, memory, photos, thinks, code])}

<h2>In a browser: Quo Web</h2>
<p><a data-link="webapp" href="https://app.quo.computer/">Quo Web</a> runs smaller models in Chrome or Edge, on the graphics card. Firefox and Safari run them on the processor, which is slower. Phone browsers don’t have the memory: use the app.</p>
{_table(data["browser"], [name, good, size, memory, thinks])}

<h2>On a phone: the Android app</h2>
<p>The phone app checks your phone and offers the models that run well on it. Three are free; the others come with the one-time Premium upgrade. The iPhone app is coming soon.</p>
{_table(data["phone"], [name, good, size, photos, thinks, plan])}

<h2>Which one should I choose?</h2>
<ul>
<li><strong>Start with the model Quo suggests.</strong> It checks your device’s memory and graphics card first.</li>
<li><strong>To ask about photos,</strong> choose a model that reads photos.</li>
<li><strong>Models that think first</strong> work through a question step by step before they answer: slower, and better at maths and planning. You can read their thinking.</li>
<li><strong>For Code mode</strong> in the desktop app, choose a model rated Good for it, or a cloud model.</li>
</ul>
<p>Every model on this page runs on your own device, free, with no account. See <a href="/pricing/">pricing</a> for the optional cloud models.</p>
'''


def _inline(text: str) -> str:
    text = esc(text, quote=False)
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)
    return re.sub(r'\[([^\]]+)\]\((https?://[^)\s]+)\)', r'<a href="\2">\1</a>', text)


def changelog_page(path: Path, updated: str) -> str:
    """CHANGELOG.md as a page: each release a heading with its date, its sections and items as written."""
    out, items = [], []

    def close():
        if items:
            out.append('<ul>\n' + ''.join(f'<li>{_inline(i)}</li>\n' for i in items) + '</ul>')
            items.clear()

    for line in path.read_text().splitlines():
        if line.startswith('# '):
            continue
        release = re.match(r'^## \[([^\]]+)\](?: - (.+))?$', line)
        if release:
            close()
            name, date = release.group(1), (release.group(2) or '').strip()
            anchor = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
            out.append(f'<h2 id="{anchor}">Quo {esc(name)}</h2>' + (f'\n<p class="meta">{esc(date)}</p>' if re.match(r'\d{4}-\d{2}-\d{2}$', date) else ''))
        elif line.startswith('### '):
            close()
            out.append(f'<h3>{esc(line[4:])}</h3>')
        elif line.startswith('- '):
            items.append(line[2:])
        elif line.startswith('  ') and items:
            items[-1] += ' ' + line.strip()
        elif line.strip():
            close()
            out.append(f'<p>{_inline(line)}</p>')
        else:
            close()
    close()
    return f'<h1>What’s new in Quo</h1>\n<p class="meta">Last updated {updated}. Also on <a href="https://github.com/quo-ai/quo/blob/master/CHANGELOG.md">GitHub</a>.</p>\n' + '\n'.join(out) + '\n'
