"""Structured data (schema.org JSON-LD) for the pages: the same words the page shows, in the form search engines and AI
answers read exactly. Only what is on the page goes in: a question here is a question a visitor can read there.
"""
import json
import re
from html import unescape


def _text(html: str) -> str:
    """The words of a piece of the page, without its tags."""
    return re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]+>', '', html))).strip()


def _script(data: dict) -> str:
    return '<script type="application/ld+json">' + json.dumps({'@context': 'https://schema.org', **data}, ensure_ascii=False).replace('</', '<\\/') + '</script>'


def questions(pairs: list) -> str:
    """A page's questions and answers (FAQPage). `pairs` holds (question, answer) as the page's own HTML."""
    return _script({'@type': 'FAQPage', 'mainEntity': [
        {'@type': 'Question', 'name': _text(q), 'acceptedAnswer': {'@type': 'Answer', 'text': _text(a)}} for q, a in pairs]})


def trail(steps: list) -> str:
    """Where a page sits in the site (BreadcrumbList). `steps` holds (name, address) from the home page down."""
    return _script({'@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': at, 'name': name, 'item': url} for at, (name, url) in enumerate(steps, 1)]})
