#!/usr/bin/env python3
"""Builds the brand page's "Download everything" zip inside a copy of the website (the zip isn't committed).

    python3 website/scripts/brand-kit.py <copy of website/>
"""
import os
import sys
import zipfile

site = sys.argv[1]
brand, shots = os.path.join(site, 'assets/brand'), os.path.join(site, 'assets/shots')
with zipfile.ZipFile(os.path.join(brand, 'quo-brand-kit.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
    for name in sorted(os.listdir(brand)):
        if not name.endswith('.zip'):
            z.write(os.path.join(brand, name), f'quo-brand-kit/logo/{name}')
    for name in sorted(os.listdir(shots)):
        z.write(os.path.join(shots, name), f'quo-brand-kit/screenshots/{name}')
