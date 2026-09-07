"""Run in Ubuntu 24 with Python, strace, tmux, and the extracted release."""
import hashlib
import json
import os
from pathlib import Path
import shlex
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request

binary = str(Path(sys.argv[1]).resolve())
launcher = str(Path(sys.argv[2]).resolve())
root = Path(tempfile.mkdtemp(prefix='opencode-trial-check-'))
old = root / 'existing-home'
trial = root / 'trial profile'
for directory in ['.config/opencode', '.cache/opencode', '.local/share/opencode', '.local/state/opencode', 'project']:
    (old / directory).mkdir(parents=True)
for name in ['opencode.db', 'opencode-dev.db', 'custom.db']:
    with sqlite3.connect(old / '.local/share/opencode' / name) as db:
        db.execute('CREATE TABLE existing_data (value TEXT)')
        db.execute("INSERT INTO existing_data VALUES ('keep my old data')")
for name in ['.config/opencode/opencode.json', '.config/opencode/tui.json', '.local/share/opencode/auth.json']:
    (old / name).write_text(json.dumps({'model': 'never-use-this/old-model'}))
(old / '.cache/opencode/sentinel').write_text('old cache')
(old / '.local/state/opencode/sentinel').write_text('old state')

def snapshot():
    return {str(p.relative_to(old)): (hashlib.sha256(p.read_bytes()).hexdigest(), p.stat().st_mtime_ns)
            for p in old.rglob('*') if p.is_file()}

before = snapshot()
env = {**os.environ, 'HOME': str(old), 'PWD': str(old / 'project'),
       'XDG_CONFIG_HOME': str(old / '.config'), 'XDG_CACHE_HOME': str(old / '.cache'),
       'XDG_DATA_HOME': str(old / '.local/share'), 'XDG_STATE_HOME': str(old / '.local/state'),
       'OPENCODE_DB': str(old / '.local/share/opencode/custom.db'),
       'OPENCODE_CONFIG': str(old / '.config/opencode/opencode.json'),
       'OPENCODE_CONFIG_DIR': str(old / '.config/opencode'),
       'OPENCODE_CONFIG_CONTENT': '{"model":"never-use-this/env-model"}',
       'OPENCODE_TUI_CONFIG': str(old / '.config/opencode/tui.json'),
       'OPENCODE_TEST_HOME': str(old), 'OPENCODE_SERVER_PASSWORD': 'old-server-password',
       'OPENCODE_TRIAL_DIR': str(trial), 'TERM': 'xterm-256color'}
count = 0

def command(*args):
    global count
    count += 1
    return ['strace', '-f', '-e', 'trace=%file', '-o', str(root / f'trace-{count}.log'),
            'bash', launcher, binary, *args]

def run(*args):
    result = subprocess.run(command(*args), env=env, cwd=old / 'project', input='',
                            text=True, capture_output=True, timeout=120)
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout

assert run('db', 'path').strip() == str(trial / 'data/opencode/trial.db')
paths = run('debug', 'paths')
assert str(old) not in paths, paths
config = run('debug', 'config')
assert 'never-use-this' not in config, config
schema = json.loads(run('db', 'SELECT COUNT(*) AS count FROM migration', '--format', 'json'))
assert schema[0]['count'] > 0, schema
assert snapshot() == before
print('Isolated database/config/home/cache/state paths: passed', flush=True)
print('New trial database schema initialized; existing files unchanged: passed', flush=True)

with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
url = f'http://127.0.0.1:{port}/session'
with (root / 'server.log').open('w') as log:
    server = subprocess.Popen(command('serve', '--hostname', '127.0.0.1', '--port', str(port)),
                              env=env, cwd=old / 'project', stdout=log, stderr=subprocess.STDOUT)
    try:
        for attempt in range(300):
            try:
                with urllib.request.urlopen(url, timeout=2) as response:
                    assert json.load(response) == []
                break
            except OSError:
                time.sleep(0.2)
        else:
            raise AssertionError((root / 'server.log').read_text())
        request = urllib.request.Request(url, data=b'{"title":"isolated trial session"}',
                                         headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(request, timeout=10) as response:
            session = json.load(response)
        assert session['title'] == 'isolated trial session', session
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait()
rows = json.loads(run('db', 'SELECT title FROM session', '--format', 'json'))
assert rows == [{'title': 'isolated trial session'}], rows
print('Real server creates session; second launch reads trial session: passed', flush=True)

tmux = ['tmux', '-S', str(root / 'tmux.sock')]
subprocess.run([*tmux, 'new-session', '-d', '-s', 'trial', '-x', '120', '-y', '35',
                shlex.join(command())], env=env, cwd=old / 'project', check=True)
try:
    for attempt in range(120):
        screen = subprocess.check_output([*tmux, 'capture-pane', '-p', '-t', 'trial'], text=True)
        if 'Ask anything' in screen:
            break
        time.sleep(1)
    assert 'Ask anything' in screen, screen
    (root / 'tui.txt').write_text(screen)
finally:
    subprocess.run([*tmux, 'kill-server'], check=True)
    time.sleep(1)
assert snapshot() == before, 'Existing files changed'
for trace in root.glob('trace-*.log'):
    # Bash checks the inherited working directory before the launcher changes it.
    # Profile directories must never be accessed, including read-only access.
    for directory in ['.config', '.cache', '.local']:
        assert str(old / directory) not in trace.read_text(), f'Existing profile accessed: {trace}'
print('TUI startup passed; no existing-profile file accesses in syscall traces', flush=True)
print(f'PASS: {len(before)} existing files retain contents and modification times. Evidence: {root}', flush=True)
