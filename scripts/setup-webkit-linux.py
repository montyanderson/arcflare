"""Optional local libraries for the Ubuntu WebKit build on Arch Linux.

No system installation or package scripts. Requires Python 3, ar and bsdtar.
"""
import hashlib
import json
import pathlib
import shlex
import subprocess
import urllib.request

repo = pathlib.Path(__file__).resolve().parent.parent
target = repo / '.reference/webkit-libs'
target.mkdir(parents=True, exist_ok=True)
for package in json.loads((repo / 'scripts/webkit-linux-libraries.json').read_text()):
    archive = target / (package['package'] + '.deb')
    data = archive.read_bytes() if archive.exists() else urllib.request.urlopen(package['url']).read()
    if hashlib.sha256(data).hexdigest() != package['sha256']:
        raise RuntimeError('Library checksum mismatch: ' + package['package'])
    archive.write_bytes(data)
    members = subprocess.check_output(['ar', 't', str(archive)], text=True).splitlines()
    payload = next(member for member in members if member.startswith('data.tar'))
    content = subprocess.check_output(['ar', 'p', str(archive), payload])
    subprocess.run(['bsdtar', '-xf', '-', '-C', str(target)], input=content, check=True)
    print('Verified and extracted ' + package['package'])

executable = subprocess.check_output(['node', '--input-type=module', '-e',
    "import {webkit} from '@playwright/test'; console.log(webkit.executablePath())"], cwd=repo, text=True).strip()
browser = pathlib.Path(executable).parent / 'minibrowser-wpe'
if not (browser / 'bin/MiniBrowser').exists():
    raise RuntimeError('Run pnpm exec playwright install webkit first.')
env = {
    'WEBKIT_EXEC_PATH': str(browser / 'bin'),
    'WEBKIT_INJECTED_BUNDLE_PATH': str(browser / 'lib'),
    'WEBKIT_INSPECTOR_RESOURCES_PATH': str(browser / 'share'),
    'LD_LIBRARY_PATH': ':'.join(map(str, [target / 'usr/lib/x86_64-linux-gnu', browser / 'lib', browser / 'sys/lib'])),
}
wrapper = repo / '.reference/webkit-browser'
wrapper.write_text('#!/bin/sh\n' + ''.join('export ' + key + '=' + shlex.quote(value) + '\n' for key, value in env.items())
                   + 'exec ' + shlex.quote(str(browser / 'bin/MiniBrowser')) + ' "$@"\n')
wrapper.chmod(0o755)
print('WebKit wrapper: ' + str(wrapper))
