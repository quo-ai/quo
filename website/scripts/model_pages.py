"""One page per model Quo runs (/models/<name>/), built from models.json (the apps' catalogs, `npm run models` in apps/web)
and the facts below, for people searching how to run a model offline. Only facts: what the catalog says, and each
model's maker and licence as its original Hugging Face page states them (checked 3 November 2026)."""
import html
import json
import re
from pathlib import Path

esc = html.escape

# Each model's maker, its original repository on Hugging Face, and the licence that page gives.
FACTS = {
    'Qwen3.5 0.8B': ('Alibaba (Qwen)', 'Qwen/Qwen3.5-0.8B', 'Apache 2.0'),
    'Qwen3.5 2B': ('Alibaba (Qwen)', 'Qwen/Qwen3.5-2B', 'Apache 2.0'),
    'Qwen3.5 4B': ('Alibaba (Qwen)', 'Qwen/Qwen3.5-4B', 'Apache 2.0'),
    'Qwen3.5 9B': ('Alibaba (Qwen)', 'Qwen/Qwen3.5-9B', 'Apache 2.0'),
    'Qwen3.8 27B': ('Alibaba (Qwen)', 'Qwen/Qwen3.8-27B', 'Apache 2.0'),
    'Gemma 4 E2B': ('Google', 'google/gemma-4-E2B-it', 'Apache 2.0'),
    'Gemma 4 12B': ('Google', 'google/gemma-4-12B-it', 'Apache 2.0'),
    'Gemma 4 26B A4B': ('Google', 'google/gemma-4-26B-A4B-it', 'Apache 2.0'),
    'Gemma 3 4B': ('Google', 'google/gemma-3-4b-it', 'the Gemma Terms of Use'),
    'Gemma 3 1B': ('Google', 'google/gemma-3-1b-it', 'the Gemma Terms of Use'),
    'Llama 3.2 3B': ('Meta', 'meta-llama/Llama-3.2-3B-Instruct', 'the Llama 3.2 Community Licence'),
    'Phi-4 Mini': ('Microsoft', 'microsoft/Phi-4-mini-instruct', 'MIT'),
    'Ministral 3B': ('Mistral AI', 'mistralai/Ministral-3-3B-Instruct-2512', 'Apache 2.0'),
    'Ministral Reasoning 3B': ('Mistral AI', 'mistralai/Ministral-3-3B-Reasoning-2512', 'Apache 2.0'),
    'Nanbeige4 Thinking 3B': ('Nanbeige', 'Nanbeige/Nanbeige4-3B-Thinking-2511', 'Apache 2.0'),
    'SmolLM3 3B': ('Hugging Face', 'HuggingFaceTB/SmolLM3-3B', 'Apache 2.0'),
}
# The phone catalog writes some names differently.
ALIASES = {'Phi-4 Mini 3.8B': 'Phi-4 Mini'}
PLACES = {'desktop': 'computer', 'browser': 'browser', 'phone': 'Android phone'}
ORDER = ['desktop', 'browser', 'phone']


def canonical(name: str) -> str:
    plain = re.sub(r'\s*\(([^)]*)\)', r' \1', name).strip()
    return ALIASES.get(plain, plain)


def slug(name: str) -> str:
    return re.sub(r'[^a-z0-9.]+', '-', name.lower()).strip('-')


def model_href(name: str) -> str:
    return f'/models/{slug(canonical(name))}/'


def _models(data: dict) -> dict:
    """Every model by its plain name, with what each platform's catalog says about it."""
    found: dict = {}
    for place in ORDER:
        for entry in data[place]:
            found.setdefault(canonical(entry['name']), {})[place] = entry
    missing = sorted(name for name in found if name not in FACTS)
    if missing:
        raise SystemExit(f'model_pages.py: add the maker and licence for {", ".join(missing)} (from its Hugging Face page)')
    return found


def _list_words(words: list) -> str:
    return words[0] if len(words) == 1 else ', '.join(words[:-1]) + ' and ' + words[-1]


def _page(name: str, places: dict, everyone: list) -> tuple:
    maker, repo, licence = FACTS[name]
    where = [PLACES[place] for place in ORDER if place in places]
    first = next(places[place] for place in ORDER if place in places)
    photos = any(entry.get('photos') for entry in places.values())
    thinks = any(entry.get('thinking') for entry in places.values())
    source = f'<a href="https://huggingface.co/{esc(repo)}">{esc(maker)}’s page for it on Hugging Face</a>'

    rows = []
    for place in ORDER:
        entry = places.get(place)
        if not entry:
            continue
        label = {'desktop': 'Desktop app (Mac, Windows, Linux)', 'browser': 'Quo Web (Chrome or Edge on a computer)', 'phone': 'Android app'}[place]
        memory = f'{entry["memoryGB"]} GB' if entry.get('memoryGB') else 'Quo checks your phone'
        cost = 'Free' if place != 'phone' or entry.get('free') else 'Premium (one-time)'
        rows.append(f'<tr><th scope="row">{label}</th><td>{entry["downloadGB"]:g} GB</td><td>{memory}</td><td>{cost}</td></tr>')

    steps = []
    if 'desktop' in places:
        steps.append('<h3>On a computer</h3>\n<ol><li>Install the desktop app: <a href="/#desktop">download it</a>, or run the one-line install shown there.</li>'
                     f'<li>Open <strong>Models &amp; storage → Offline</strong> and press <strong>Download</strong> next to {esc(name)}.</li>'
                     '<li>When it’s downloaded, start a chat. It works with Wi-Fi off.</li></ol>')
    if 'browser' in places:
        # A link that opens Quo Web with this model chosen (apps/web/src/models/preselect.ts); it never starts a download.
        try_it = f'https://app.quo.computer/?model={places["browser"]["id"]}'
        steps.append(f'<h3>In a browser</h3>\n<p><a class="btn line" href="{try_it}">Try {esc(name)} in your browser</a></p>\n'
                     f'<ol><li>That link opens Quo Web with {esc(name)} chosen. Use Chrome or Edge on a computer.</li>'
                     f'<li>Press <strong>Download {esc(name)}</strong>. It stays in the browser for next time.</li>'
                     '<li>Chat. Nothing you type leaves the computer.</li></ol>')
    if 'phone' in places:
        premium = '' if places['phone'].get('free') else ' It comes with the one-time Premium upgrade.'
        steps.append('<h3>On an Android phone</h3>\n<ol><li>Install Quo from <a data-link="android" href="https://play.google.com/store/apps/details?id=com.quo.app">Google Play</a>.</li>'
                     f'<li>Open <strong>Settings → Models</strong> and choose {esc(name)}.{premium}</li>'
                     '<li>After the download, it answers with no signal.</li></ol>')

    others = [other for other in everyone if other != name]
    apps = [{'desktop': 'the desktop app', 'browser': 'Quo Web'}[place] for place in ORDER if place in places and place != 'phone']
    free_answer = f'Yes. In {_list_words(apps)} it’s free, with no account and no limits.' if apps else ''
    if 'phone' in places:
        phone_free = places['phone'].get('free')
        free_answer += ' ' + ('On the phone it’s one of the free models.' if phone_free else 'On the phone it comes with the one-time Premium upgrade.') if free_answer else ('Yes: on the phone it’s one of the free models.' if phone_free else 'It comes with the one-time Premium upgrade in the phone app.')

    body = f'''<p><a href="/models/">All models</a></p>
<h1>Run {esc(name)} offline</h1>
<p>{esc(name)} is an open AI model made by {esc(maker)}. Quo runs it on your own {_list_words(where)}. You download it once. After that it works with no internet, and what you type stays on your device.</p>
<ul>
<li><strong>Good at:</strong> {esc(first['description'])}</li>
<li><strong>Reads photos:</strong> {'Yes' if photos else 'No'}</li>
<li><strong>Thinks first:</strong> {'Yes: it works a question through step by step, and you can read its thinking.' if thinks else 'No: it answers straight away.'}</li>
{f'<li><strong>Code mode:</strong> {"Good" if places["desktop"].get("codeMode") else "Basic"} (desktop app)</li>' if 'desktop' in places else ''}
<li><strong>Licence:</strong> {esc(licence)} (see {source})</li>
</ul>

<h2>Where it runs in Quo</h2>
<div class="table-wrap"><table class="model-table">
<thead><tr><th scope="col">Where</th><th scope="col">Download</th><th scope="col">Memory it needs</th><th scope="col">Cost</th></tr></thead>
<tbody>
{chr(10).join(rows)}
</tbody></table></div>
<p>“Memory it needs” is the computer’s memory, or the graphics card’s own memory when the model runs there. A model that doesn’t fit runs slowly or not at all; Quo checks your device and suggests one that runs well.</p>

<h2>How to run it</h2>
{chr(10).join(steps)}

<h2>Questions</h2>
<h3>Does {esc(name)} work without the internet?</h3>
<p>Yes. Quo needs the internet only to download it. After that, {esc(name)} runs on your device, and your chats, documents and photos stay there.</p>
<h3>Is it free?</h3>
<p>{free_answer}</p>
<h3>Can I use it for my own work?</h3>
<p>{esc(name)} is released under {esc(licence)}. The full terms are on {source}. Quo itself is open source under Apache 2.0.</p>

<h2>Other models in Quo</h2>
<ul class="facts-line">
{chr(10).join(f'<li><a href="{model_href(other)}">{esc(other)}</a></li>' for other in others)}
</ul>
<p>See <a href="/models/">every model and what it needs</a>.</p>
'''
    size = f'{first["downloadGB"]:g} GB download'
    title = f'Run {name} offline on your {_list_words(where)} — Quo'
    desc = f'{name} by {maker} runs offline in Quo on your {_list_words(where)}: {size}, free and private, no account. How to run it, what it needs and its licence.'
    return (f'models/{slug(name)}/index.html', f'/models/{slug(name)}/', title, desc, body, 'doc wide')


def model_pages(path: Path) -> list:
    models = _models(json.loads(path.read_text()))
    names = list(models)
    return [_page(name, places, names) for name, places in models.items()]
