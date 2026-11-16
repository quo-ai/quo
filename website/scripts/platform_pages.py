"""One page per place Quo runs (/windows/, /mac/, /linux/, /android/, /browser/), for people looking for private AI
that works offline on their own device. Only facts from the apps, their builds and installers (apps/desktop/README.md,
electron-builder.yml, install.sh, install.ps1, the pricing section); the models come from models.json, as on the model
pages. Each page's questions are also its structured data (structured_data.py)."""
import html
import json
from pathlib import Path

from model_pages import canonical, model_href
from structured_data import questions, trail

esc = html.escape
SITE = 'https://quo.computer'
RELEASES = 'https://github.com/quo-ai/quo/releases/latest'
DOWNLOAD = RELEASES + '/download/'
WEBAPP = 'https://app.quo.computer/'
PLAY = 'https://play.google.com/store/apps/details?id=com.quo.app'

# Every page, in the order the pages list each other: (address, name in links).
PLACES = [('/windows/', 'Windows'), ('/mac/', 'Mac'), ('/linux/', 'Linux'), ('/android/', 'Android'), ('/browser/', 'In your browser')]

SHOT = ('<div class="frame-img"><img class="for-light" src="/assets/shots/hero-light.webp" width="2560" height="1600" alt="{alt}" loading="lazy">'
        '<img class="for-dark" src="/assets/shots/hero-dark.webp" width="2560" height="1600" alt="{alt}" loading="lazy"></div>')
COMPUTER_SHOT = SHOT.format(alt='Quo running with Wi-Fi off: a chat planning a budget trip to Lisbon, answered by a model on the device itself')
PHONE_SHOTS = '''<div class="shots">
<figure><div class="shot"><img class="for-light" src="/assets/shots/phone-offline-light.webp" width="780" height="1688" alt="Quo answering on a phone with no internet connection" loading="lazy"><img class="for-dark" src="/assets/shots/phone-offline-dark.webp" width="780" height="1688" alt="Quo answering on a phone with no internet connection" loading="lazy"></div><figcaption>Works with no internet</figcaption></figure>
<figure><div class="shot"><img class="for-light" src="/assets/shots/phone-document-light.webp" width="780" height="1688" alt="Quo summarising a hotel booking PDF" loading="lazy"><img class="for-dark" src="/assets/shots/phone-document-dark.webp" width="780" height="1688" alt="Quo summarising a hotel booking PDF" loading="lazy"></div><figcaption>Ask about your documents</figcaption></figure>
<figure><div class="shot"><img class="for-light" src="/assets/shots/phone-vision-light.webp" width="780" height="1688" alt="Quo saying a photo shows an apple on a tree" loading="lazy"><img class="for-dark" src="/assets/shots/phone-vision-dark.webp" width="780" height="1688" alt="Quo saying a photo shows an apple on a tree" loading="lazy"></div><figcaption>Understands your photos</figcaption></figure>
<figure><div class="shot"><img class="for-light" src="/assets/shots/phone-thinking-light.webp" width="780" height="1688" alt="Quo working out an arrival time step by step" loading="lazy"><img class="for-dark" src="/assets/shots/phone-thinking-dark.webp" width="780" height="1688" alt="Quo working out an arrival time step by step" loading="lazy"></div><figcaption>Thinks it through</figcaption></figure>
</div>'''


def _install(title, where, command):
    """The one-line install, as on the home page (site.js copies it)."""
    return (f'<div class="install">\n<p class="install-title">{title}</p>\n<div class="install-row"><span class="install-os">{where}</span>'
            f'<code>{command}</code><button class="btn line small" type="button" data-copy-cmd>Copy</button></div>\n</div>')


UNIX = ('In Terminal', 'curl -fsSL https://quo.computer/install.sh | sh')
WINDOWS = ('In PowerShell', 'irm https://quo.computer/install.ps1 | iex')


def _table(entries, place):
    """The models Quo offers in one place, each linked to its own page."""
    def row(m):
        name = f'<th scope="row"><a href="{model_href(m["name"])}">{esc(canonical(m["name"]))}</a></th>'
        cells = [f'{m["downloadGB"]:g} GB']
        if place == 'phone':
            cells.insert(0, esc(m['description']))
            cells.append('Free' if m.get('free') else 'Premium')
        else:
            cells.append(f'{m["memoryGB"]} GB')
            cells.insert(0, esc(m['description']))
        if place == 'browser':
            cells.append(f'<a href="{WEBAPP}?model={esc(m["id"])}">Try it</a>')
        return '<tr>' + name + ''.join(f'<td>{c}</td>' for c in cells) + '</tr>'
    head = ['Model', 'Good at', 'Download'] + (['Free or Premium'] if place == 'phone' else ['Memory it needs']) + (['In Quo Web'] if place == 'browser' else [])
    return ('<div class="table-wrap"><table class="model-table">\n<thead><tr>' + ''.join(f'<th scope="col">{h}</th>' for h in head)
            + '</tr></thead>\n<tbody>\n' + '\n'.join(row(m) for m in entries) + '\n</tbody></table></div>')


def _desktop_does(graphics):
    """What the desktop app does, the same on every system but for how it uses the graphics card."""
    return f'''<ul>
<li><strong>Works offline.</strong> Models run on your computer. After a model downloads, Quo needs no internet, and your chats, documents and photos stay on the computer.</li>
<li>{graphics}</li>
<li><strong>Reads documents and photos, and listens.</strong> Ask about a PDF or a photo, or talk instead of typing. Your voice is turned into text on the computer.</li>
<li><strong>Any GGUF model from Hugging Face.</strong> Search Hugging Face in Models &amp; storage, or use models you already downloaded with LM Studio or Ollama.</li>
<li><strong>Code mode.</strong> A model works in a project folder: it reads the code, makes changes, runs tests, commits and pushes. You approve every step.</li>
<li><strong>Makes pictures on your computer</strong> with an image model you download.</li>
<li><strong>Cloud models only when you choose them:</strong> Quo’s own, your own API key, or Claude Agent with your own Claude Code sign-in. Each is clearly marked.</li>
</ul>'''


OFFLINE_COMPUTER = ('Does Quo work without the internet?',
                    'Yes. Quo needs the internet to download the app and a model. After that, chats run on your computer with Wi-Fi off. Quo checks for updates when it starts; you can turn that off in the Help menu.')
FREE_COMPUTER = ('Is it free?',
                 'Yes. The app and every offline model are free, with no account and no limits. Cloud models are optional: see <a href="/pricing/">pricing</a>.')


def _pages(models):
    desktop, browser, phone = models['desktop'], models['browser'], models['phone']
    least = min(m['memoryGB'] for m in desktop)
    return [
        dict(path='/windows/', name='Windows', title='Offline AI for Windows: a private AI assistant on your PC — Quo',
             desc='Quo runs AI models on your Windows PC, on the graphics card, with no internet and no account. Free and open source. How to install it and which models fit.',
             h1='Private AI for Windows that works offline',
             lede='Quo is a free, open-source AI assistant that runs on your own PC. It runs open models such as Qwen, Gemma and Llama on your graphics card. After a model downloads, it works with no internet, and what you type stays on your computer.',
             actions=f'<a class="btn solid" href="{DOWNLOAD}Quo-windows-x64-setup.exe">Download for Windows</a><a class="btn line" data-link="webapp" href="{WEBAPP}">Try it in your browser first</a>',
             facts=['Windows 10 and 11', '64-bit (x64)', 'No admin rights needed', 'Updates itself'],
             shot=COMPUTER_SHOT,
             install=f'''<ol>
<li>Download <a href="{DOWNLOAD}Quo-windows-x64-setup.exe">Quo-windows-x64-setup.exe</a> and open it.</li>
<li>If Windows shows “Windows protected your PC”, choose <strong>More info › Run anyway</strong>.</li>
<li>Quo installs for you only, with no admin prompt, and opens. Find it in the Start menu any time.</li>
<li>Quo suggests a model that fits your PC. Download it once; after that it works offline.</li>
</ol>
{_install('Or install it in one line in PowerShell. It checks the download against the release’s checksum and needs no admin rights.', *WINDOWS)}''',
             does=_desktop_does('<strong>Runs on your graphics card.</strong> Quo uses llama.cpp with Vulkan, so most NVIDIA, AMD and Intel graphics work with their usual drivers. On an NVIDIA card you can add llama.cpp’s CUDA engine in Models &amp; storage. Without a graphics card, models run on the processor.'),
             models=('In the desktop app', desktop, 'desktop'),
             asked=[
                 ('Is Quo safe to install on Windows?',
                  'Quo is open source, and every installer is built from the code on GitHub by an automated release process. The installer isn’t signed with a certificate yet, so Windows says the publisher is unknown: choose More info › Run anyway. The one-line install checks the download against the release’s checksum before it runs it.'),
                 OFFLINE_COMPUTER,
                 ('What PC do I need?',
                  f'Windows 10 or 11 on a 64-bit (x64) PC. Quo checks your memory and graphics card and suggests a model that fits; the smallest need about {least} GB of memory. Windows on Arm runs the x64 app through emulation.'),
                 FREE_COMPUTER,
             ]),
        dict(path='/mac/', name='Mac', title='Offline AI for Mac: a private AI assistant on your Mac — Quo',
             desc='Quo runs AI models on your Mac, on Apple silicon’s graphics, with no internet and no account. Free and open source. How to install it and which models fit.',
             h1='Private AI for Mac that works offline',
             lede='Quo is a free, open-source AI assistant that runs on your own Mac. It runs open models such as Qwen, Gemma and Llama on Apple silicon’s graphics. After a model downloads, it works with no internet, and what you type stays on your Mac.',
             actions=f'<a class="btn solid" href="{DOWNLOAD}Quo-mac-universal.dmg">Download for Mac</a><a class="btn line" data-link="webapp" href="{WEBAPP}">Try it in your browser first</a>',
             facts=['Apple silicon and Intel Macs', 'One app for both', 'No account'],
             shot=COMPUTER_SHOT,
             install=f'''<ol>
<li>Download <a href="{DOWNLOAD}Quo-mac-universal.dmg">Quo-mac-universal.dmg</a> and open it.</li>
<li>Drag <strong>Quo</strong> into your Applications folder.</li>
<li>Open Quo. If macOS says it can’t check the app, go to System Settings › Privacy &amp; Security and choose <strong>Open Anyway</strong>. You do this once.</li>
<li>Quo suggests a model that fits your Mac. Download it once; after that it works offline.</li>
</ol>
{_install('Or install it in one line in Terminal. It checks the download against the release’s checksum and puts Quo in Applications. Run it again to update Quo.', *UNIX)}''',
             does=_desktop_does('<strong>Runs on Apple silicon’s graphics.</strong> On Macs with Apple silicon, Quo runs models with llama.cpp on the graphics (Metal), using the Mac’s shared memory. Intel Macs run them on the processor.'),
             models=('In the desktop app', desktop, 'desktop'),
             asked=[
                 ('Why does macOS ask before it opens Quo?',
                  'Quo isn’t notarised by Apple yet, so macOS asks once. Choose Open Anyway in System Settings › Privacy &amp; Security. Quo is open source, and the app is built from the code on GitHub by an automated release process.'),
                 ('Does Quo run on Intel Macs?',
                  f'Yes: the app is universal. Intel Macs run models on the processor, which is slower, so choose a smaller model. Macs with Apple silicon run them on the graphics. The smallest models need about {least} GB of memory.'),
                 ('How do I update Quo on a Mac?',
                  'Quo tells you when a new version is out. Download it again, or run the one-line install again. Your chats and models are kept.'),
                 OFFLINE_COMPUTER,
             ]),
        dict(path='/linux/', name='Linux', title='Offline AI for Linux: a private AI assistant, AppImage and .deb — Quo',
             desc='Quo runs AI models on your Linux computer with llama.cpp and Vulkan, with no internet and no account. AppImage and .deb for x64 and ARM. Free and open source.',
             h1='Private AI for Linux that works offline',
             lede='Quo is a free, open-source AI assistant that runs on your own computer. It runs open models such as Qwen, Gemma and Llama with llama.cpp on your graphics card. After a model downloads, it works with no internet, and what you type stays on your computer.',
             actions=f'<a class="btn solid" href="{DOWNLOAD}Quo-linux-x86_64.AppImage">Download the AppImage</a><a class="btn line" data-link="releases" href="{RELEASES}">All downloads (.deb, ARM)</a>',
             facts=['x64 and ARM64', 'AppImage and .deb', 'Updates itself', 'No account'],
             shot=COMPUTER_SHOT,
             install=f'''{_install('The quickest way is one line in a terminal. It picks the build for your computer, checks it against the release’s checksum, and installs the AppImage in <code>~/.local/bin</code> with a menu entry. It needs no root.', *UNIX)}
<h3>AppImage</h3>
<ol>
<li>Download <a href="{DOWNLOAD}Quo-linux-x86_64.AppImage">Quo-linux-x86_64.AppImage</a>, or <a href="{DOWNLOAD}Quo-linux-arm64.AppImage">the ARM64 build</a>.</li>
<li>Make it executable: <code>chmod +x Quo-linux-x86_64.AppImage</code></li>
<li>Open it. The AppImage needs FUSE 2: <code>sudo apt install libfuse2t64</code> on Ubuntu 24.04 and later, <code>libfuse2</code> on older releases.</li>
</ol>
<h3>.deb, for Debian and Ubuntu</h3>
<ol>
<li>Download <a href="{DOWNLOAD}Quo-linux-amd64.deb">Quo-linux-amd64.deb</a>, or <a href="{DOWNLOAD}Quo-linux-arm64.deb">the ARM64 build</a>.</li>
<li>Install it: <code>sudo apt install ./Quo-linux-amd64.deb</code></li>
</ol>''',
             does=_desktop_does('<strong>Runs on your graphics card.</strong> On x64, Quo uses llama.cpp with Vulkan, so most NVIDIA, AMD and Intel graphics work. On an NVIDIA card you can add llama.cpp’s CUDA engine in Models &amp; storage. ARM64 computers run models on the processor; NVIDIA ARM machines can add the CUDA engine.'),
             models=('In the desktop app', desktop, 'desktop'),
             asked=[
                 ('AppImage or .deb?',
                  'They are the same app, and both update themselves. The AppImage needs no root and runs on most distributions, but needs FUSE 2. The .deb is for Debian and Ubuntu, doesn’t need FUSE, and asks for your password to install updates.'),
                 ('Which graphics cards work?',
                  'On x64, Quo runs models with Vulkan, so most NVIDIA, AMD and Intel graphics work with their usual drivers. On an NVIDIA card you can also add llama.cpp’s CUDA engine. Without a usable graphics card, models run on the processor.'),
                 OFFLINE_COMPUTER,
                 ('Is Quo open source?',
                  'Yes, under Apache 2.0. The app is built from the code on <a href="https://github.com/quo-ai/quo">GitHub</a> by an automated release process, and its engine is llama.cpp’s official release build.'),
             ]),
        dict(path='/android/', name='Android', title='Offline AI for Android: a private AI assistant on your phone — Quo',
             desc='Quo runs AI on your Android phone with no internet and no account. A model comes built in, and your documents, photos and voice stay on the phone. Free on Google Play.',
             h1='Private AI for Android that works offline',
             lede='Quo is an AI assistant that runs on your phone. It comes with a model built in, so it’s ready the moment it installs, and it answers with no signal. Installed more than 11,000 times.',
             actions=f'<a class="btn solid" data-link="android" href="{PLAY}">Get it on Google Play</a>',
             facts=['Free, with a one-time upgrade', 'No account', 'A model built in'],
             shot=PHONE_SHOTS,
             install='''<ol>
<li>Install Quo from <a data-link="android" href="https://play.google.com/store/apps/details?id=com.quo.app">Google Play</a>.</li>
<li>Open it. The built-in model is ready, so you can start a chat straight away.</li>
<li>Choose more models in <strong>Settings → Models</strong>. Quo offers the ones that run well on your phone.</li>
</ol>''',
             does='''<ul>
<li><strong>Works offline.</strong> Answers come from the model on your phone, so Quo keeps working on planes, abroad and anywhere without signal.</li>
<li><strong>Reads your documents.</strong> Ask about a PDF or a text file without uploading it anywhere.</li>
<li><strong>Understands your photos</strong> with a model that reads photos.</li>
<li><strong>Thinks it through.</strong> Thinking models work a question through step by step, and you can read along.</li>
<li><strong>Keeps going in the background,</strong> with a notification, while it finishes an answer.</li>
</ul>''',
             models=('In the Android app', phone, 'phone'),
             asked=[
                 ('Is Quo free on Android?',
                  'Yes. It’s free with 3 models, including one that sees photos. Premium is a one-time upgrade sold by Google Play: it adds every model, voice input, read aloud, and unlimited chats and memories.'),
                 ('Does it need the internet?',
                  'Only to install it and to download more models. A model comes with the app, so Quo answers with no signal from the start, and your chats stay on the phone.'),
                 ('Which phones does it run on?',
                  'Quo checks your phone’s memory and offers the models that run well on it. The built-in model is small (about 530 MB) and runs on most phones from the last few years.'),
                 ('Is there an iPhone app?',
                  'Not yet: it’s coming soon. Until then, Quo Web runs on a computer in Chrome or Edge.'),
             ]),
        dict(path='/browser/', name='In your browser', title='Run AI in your browser, offline and private: Quo Web — Quo',
             desc='Quo Web runs AI models in Chrome or Edge on your own computer, on the graphics card with WebGPU. Nothing to install, no account, and it works offline.',
             h1='Private AI in your browser',
             lede='Quo Web runs open AI models inside your browser, on your own computer. There’s nothing to install and no account. You download a model once; after that it works with no internet, and what you type stays on your computer.',
             actions=f'<a class="btn solid" data-link="webapp" href="{WEBAPP}">Open Quo Web</a><a class="btn line" href="/#desktop">Get the desktop app</a>',
             facts=['Chrome or Edge on a computer', 'Nothing to install', 'No account'],
             shot=COMPUTER_SHOT,
             install=f'''<ol>
<li>Open <a data-link="webapp" href="{WEBAPP}">Quo Web</a> in Chrome or Edge on a computer.</li>
<li>Quo suggests a model that fits your computer. Download it once; it stays in the browser for next time.</li>
<li>Chat. It works with Wi-Fi off.</li>
</ol>
<p>Each model in the table below has a “Try it” link that opens Quo Web with that model chosen.</p>''',
             does='''<ul>
<li><strong>Runs on your graphics card.</strong> In Chrome and Edge, Quo runs models on the graphics card with WebGPU. Firefox and Safari run them on the processor, which is slower.</li>
<li><strong>Works offline.</strong> After a model downloads, Quo Web needs no internet, and your chats stay in the browser.</li>
<li><strong>Reads your documents, and listens.</strong> Ask about a PDF or a text file, or talk instead of typing. Your voice is turned into text in the browser.</li>
<li><strong>Installs as an app.</strong> Chrome and Edge can add Quo Web to your computer like an app, and it opens with no internet.</li>
<li><strong>Cloud models only when you choose them:</strong> Quo’s own, or your own API key. Each is clearly marked.</li>
</ul>''',
             models=('In Quo Web', browser, 'browser'),
             asked=[
                 ('Does anything I type leave my computer?',
                  'Not with offline models. The model runs inside your browser, and your chats are saved there. To check, open the browser’s developer tools (F12), go to Network and ask something: your message doesn’t appear. Cloud models are optional and clearly marked.'),
                 ('Which browser works best?',
                  'Chrome or Edge on a computer: they let Quo use your graphics card, which is much faster. Firefox and Safari run models on the processor. For the biggest models and the most speed, use the <a href="/#desktop">desktop app</a>.'),
                 ('Where are my chats and models kept?',
                  'In your browser’s storage on this computer. Downloaded models stay there for next time, and clearing the site’s data in your browser removes them.'),
                 ('Can I use Quo Web on my phone?',
                  'Phone browsers don’t have the memory for these models. On Android, use the <a href="/android/">Quo app</a>.'),
             ]),
    ]


def _page(p):
    heading, entries, place = p['models']
    others = [f'<li><a href="{path}">{name}</a></li>' for path, name in PLACES if path != p['path']]
    body = f'''<h1>{p["h1"]}</h1>
<div class="summary"><p>{p["lede"]}</p></div>
<div class="actions">{p["actions"]}</div>
<ul class="facts-line">{''.join(f"<li>{fact}</li>" for fact in p["facts"])}</ul>
{p["shot"]}

<h2>Install it</h2>
{p["install"]}

<h2>What it does</h2>
{p["does"]}

<h2>Models that run on it</h2>
<p>{heading}, Quo checks your device and suggests a model that runs well. Bigger models give better answers but need more memory. Each model has its own page with what it needs and its licence.</p>
{_table(entries, place)}
<p>See <a href="/models/">every model and what it needs</a>.</p>

<h2>Questions</h2>
{chr(10).join(f'<h3>{q}</h3>{chr(10)}<p>{a}</p>' for q, a in p["asked"])}

<h2>Quo on your other devices</h2>
<ul class="facts-line">{''.join(others)}</ul>

{questions(p["asked"])}
{trail([('Quo', SITE + '/'), (p["name"], SITE + p["path"])])}
'''
    return (p['path'].strip('/') + '/index.html', p['path'], p['title'], p['desc'], body, 'doc wide')


def platform_pages(path: Path) -> list:
    return [_page(p) for p in _pages(json.loads(path.read_text()))]


def platform_links() -> list:
    """(name, address, one line) for each page, for llms.txt."""
    return [(name, SITE + path, page['desc']) for (path, name), page in zip(PLACES, _pages(json.loads((Path(__file__).parent / 'models.json').read_text())))]
