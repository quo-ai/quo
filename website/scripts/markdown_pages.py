"""A Markdown copy of each page, for AI agents and other programs that ask for one (`Accept: text/markdown`, or the
page's address with index.md added). The server chooses by the Accept header (ops/server/apache.conf); browsers keep
getting the HTML. The text is the page's own: nothing is added for machines that people don't see.

`to_markdown(html)` turns the pages' own HTML (headings, paragraphs, lists, links, tables, code) into Markdown and drops
what only draws the page (icons, scripts, styles, pictures without a description).
"""
import re
from html.parser import HTMLParser

SKIP = {'script', 'style', 'svg', 'template', 'noscript', 'button', 'dialog', 'picture', 'video', 'nav', 'form'}
BLOCK = {'p', 'div', 'section', 'article', 'header', 'footer', 'figure', 'figcaption', 'details', 'summary', 'address', 'main', 'tr', 'thead', 'tbody', 'table', 'ul', 'ol', 'dl', 'dt', 'dd', 'blockquote', 'hr'}


class _Markdown(HTMLParser):
    def __init__(self, site: str):
        super().__init__(convert_charrefs=True)
        self.site = site
        self.out: list[str] = []
        self.skip = 0          # inside something that isn't text
        self.lists: list = []  # 'ul' or a number, per open list
        self.href: list = []
        self.pre = False
        self.cells: list | None = None
        self.rows: list | None = None
        self.spaced = False    # the next text follows a styled piece: keep them apart
        self.alt = ''

    # -- output -----------------------------------------------------------------------------------------------------
    def write(self, text: str) -> None:
        if self.cells is not None:
            self.cells[-1] += text
        else:
            self.out.append(text)

    def last(self) -> str:
        text = self.cells[-1] if self.cells else (self.out[-1] if self.out else '')
        return text[-1:] if text else ''

    def gap(self) -> None:
        """A space where the page put two pieces side by side with only styling between them."""
        if self.last() and not self.last().isspace() and self.last() not in '([':
            self.write(' ')
        self.spaced = False

    def block(self) -> None:
        if self.cells is None:
            self.out.append('\n\n')

    # -- tags -------------------------------------------------------------------------------------------------------
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if self.skip or tag in SKIP:
            if tag not in ('br', 'img', 'hr', 'input', 'source', 'meta', 'link', 'use', 'path'):
                self.skip += 1
            return
        if tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self.block()
            self.write('#' * int(tag[1]) + ' ')
        elif tag == 'br':
            self.write('\n' if self.cells is None else ' ')
        elif tag == 'hr':
            self.block(); self.write('---'); self.block()
        elif tag in ('ul', 'ol'):
            self.block()
            self.lists.append('ul' if tag == 'ul' else 1)
        elif tag == 'li':
            marker = '-'
            if self.lists and self.lists[-1] != 'ul':
                marker = f'{self.lists[-1]}.'
                self.lists[-1] += 1
            self.write('\n' + '  ' * max(0, len(self.lists) - 1) + marker + ' ')
        elif tag in ('strong', 'b'):
            self.gap(); self.write('**')
        elif tag in ('em', 'i'):
            self.gap(); self.write('*')
        elif tag == 'code' and not self.pre:
            self.gap(); self.write('`')
        elif tag == 'span':
            self.spaced = self.last().isalnum() or self.last() in '.,:;!?%*`)'
        elif tag == 'pre':
            self.block(); self.write('```\n'); self.pre = True
        elif tag == 'a':
            href = a.get('href') or ''
            if href.startswith('/'):
                href = self.site + href
            self.href.append(href if re.match(r'https?://|mailto:', href) else '')
            if self.href[-1]:
                self.write('[')
        elif tag == 'img':
            # Light and dark versions of one picture say the same thing: once is enough.
            if a.get('alt') and a['alt'] != self.alt:
                self.gap(); self.write(a['alt']); self.alt = a['alt']
        elif tag == 'table':
            self.block(); self.rows = []
        elif tag == 'tr' and self.rows is not None:
            self.cells = []
        elif tag in ('td', 'th') and self.cells is not None:
            self.cells.append('')
        elif tag in BLOCK:
            self.block()

    def handle_endtag(self, tag):
        if self.skip:
            self.skip -= 1
            return
        if tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self.block()
        elif tag in ('ul', 'ol'):
            if self.lists:
                self.lists.pop()
            self.block()
        elif tag in ('strong', 'b'):
            self.write('**'); self.spaced = True
        elif tag in ('em', 'i'):
            self.write('*'); self.spaced = True
        elif tag == 'code' and not self.pre:
            self.write('`'); self.spaced = True
        elif tag == 'span':
            self.spaced = True
        elif tag == 'pre':
            self.pre = False; self.write('\n```'); self.block()
        elif tag == 'a':
            href = self.href.pop() if self.href else ''
            if href:
                self.write(f']({href})')
        elif tag == 'tr' and self.rows is not None and self.cells is not None:
            self.rows.append([re.sub(r'\s+', ' ', cell).strip().replace('|', '\\|') for cell in self.cells])
            self.cells = None
        elif tag == 'table' and self.rows is not None:
            rows, self.rows = [row for row in self.rows if row], None
            if rows:
                width = max(len(row) for row in rows)
                rows = [row + [''] * (width - len(row)) for row in rows]
                lines = ['| ' + ' | '.join(rows[0]) + ' |', '|' + ' --- |' * width] + ['| ' + ' | '.join(row) + ' |' for row in rows[1:]]
                self.out.append('\n'.join(lines))
            self.block()
        elif tag in BLOCK:
            self.block()

    def handle_data(self, data):
        if self.skip:
            return
        if self.pre:
            return self.write(data)
        text = re.sub(r'\s+', ' ', data)
        if self.spaced and text[:1].isalnum() and self.last() and not self.last().isspace():
            text = ' ' + text
        self.spaced = False
        self.write(text)


def to_markdown(html: str, site: str) -> str:
    parser = _Markdown(site)
    parser.feed(html)
    text = ''.join(parser.out)
    text = re.sub(r'[ \t]+\n', '\n', text)                 # no spaces at line ends
    text = re.sub(r'\n[ \t]+(?=[^\s\-\d])', '\n', text)    # nor at line starts (list items keep theirs)
    text = re.sub(r'\*\*\s*\*\*|``|\[\s*\]\([^)]*\)', '', text)  # emphasis, code or links left empty by a dropped icon
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip() + '\n'


def markdown_page(title: str, desc: str, body_html: str, url: str, site: str) -> str:
    """The page as Markdown: its own heading and text, with where it lives and its one-line description on top."""
    body = to_markdown(body_html, site)
    head = '' if re.search(r'^# ', body, re.M) else f'# {title}\n\n'
    return f'{head}{body}\n---\n{desc}\nThis page: {url}\n'
