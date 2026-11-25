"""The site's files for programs, written by generate-pages.py: the sitemap, with each page dated by when its file last
changed, and llms.txt, a plain summary for AI tools."""
import subprocess
from datetime import date
from pathlib import Path


def last_changed(root: Path, file: str) -> str:
    """The day of the last commit that changed the file, or today when it differs from that commit. Search engines
    trust a sitemap's dates only when they are true, so they are never set by hand."""
    git = lambda *args: subprocess.run(['git', '-C', str(root), *args, '--', file], capture_output=True, text=True).stdout.strip()
    return (not git('status', '--porcelain') and git('log', '-1', '--format=%cs')) or date.today().isoformat()


def write_sitemap(root: Path, site: str, pages: list) -> None:
    """`pages` holds (address, file) for every page to list."""
    (root / 'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                                      + ''.join(f'  <url><loc>{site}{path}</loc><lastmod>{last_changed(root, file)}</lastmod></url>\n' for path, file in pages)
                                      + '</urlset>\n')


def write_llms(root: Path, site: str, company: str, email: str, places: list, features: list) -> None:
    """Facts only; prices stay on the pricing page so they can't drift. It says which Quo this is: another company's
    business phone app is also called Quo. `places` and `features` hold (name, address, one line) for each page."""
    get = ''.join(f'- [{name}]({url}): {line}\n' for name, url, line in places)
    does = ''.join(f'- [{name}]({url}): {line}\n' for name, url, line in features)
    (root / 'llms.txt').write_text(f'''# Quo AI

> Quo is a free, open-source AI assistant that runs on your own device: in the browser, on Mac, Windows and Linux, and on Android. It works offline, needs no account, and nothing you type leaves the device unless you choose a cloud model. Made by {company} in the United Kingdom. Not related to Quo, the business phone service formerly called OpenPhone.

Every page here is also available as Markdown: ask with `Accept: text/markdown`, or add `index.md` to its address (for example {site}/pricing/index.md).

## Using Quo
- [Home]({site}/): what Quo does, the models it runs, the desktop and phone apps, and common questions
- [Quo Web](https://app.quo.computer/): Quo in the browser, with offline models and optional cloud models
- [Download for desktop](https://github.com/quo-ai/quo/releases/latest): Mac, Windows and Linux
- [Android app](https://play.google.com/store/apps/details?id=com.quo.app)
- [Pricing]({site}/pricing/): free on the device; Quo Pro, Quo Sync and credit packs for cloud models
- [Models]({site}/models/): every model Quo runs on a computer, in a browser and on a phone, and what each needs
- [What's new]({site}/changelog/): every release

## Quo on each device
{get}
## In the desktop app
{does}
## About
- [Source code](https://github.com/quo-ai/quo): Apache 2.0
- [Privacy Policy]({site}/privacy/): what stays on the device and what is sent when you choose a cloud model
- [Terms]({site}/terms/), [Refunds]({site}/refunds/), [Support]({site}/support/), [Brand assets]({site}/brand/)
- Contact: {email}
''')
