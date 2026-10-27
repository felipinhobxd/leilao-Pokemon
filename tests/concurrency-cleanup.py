"""Maintenance yields immediately to an in-flight business write (CI DB only)."""
import json
import os
import subprocess
import time
from urllib.parse import urlparse

url = os.environ['TEST_DATABASE_URL']
target = urlparse(url)
assert target.path == '/leilao_test' and target.hostname in {'localhost', '127.0.0.1', '::1'}, 'Local disposable database required'

def sql(statement):
    return subprocess.run(['psql', url, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', statement],
                          capture_output=True, text=True, check=True).stdout.strip()

# Locks late in the cleanup list also test release of earlier acquired locks.
# Fixed allowlist only; keep each writer open without timing-dependent sleeps.
for table in ('auctions', 'payments', 'payment_reminders'):
    writer = subprocess.Popen(['psql', url, '-X', '-v', 'ON_ERROR_STOP=1', '-At'],
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              text=True, bufsize=1)
    maintenance = None
    try:
        writer.stdin.write(f"begin; lock table public.{table} in row exclusive mode; select 'writer_ready';\n")
        writer.stdin.flush()
        while writer.stdout.readline().strip() != 'writer_ready':
            assert writer.poll() is None, 'writer exited before locking'
        maintenance = subprocess.Popen(['psql', url, '-X', '-v', 'ON_ERROR_STOP=1', '-At'],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       text=True, bufsize=1)
        started = time.monotonic()
        maintenance.stdin.write("begin; set local role service_role; select public.cleanup_old_auctions(); select 'cleanup_ready';\n")
        maintenance.stdin.flush()
        result = None
        while True:
            line = maintenance.stdout.readline().strip()
            if line == 'cleanup_ready':
                break
            assert maintenance.poll() is None, 'maintenance exited before returning a result'
            if line.startswith('{'):
                result = json.loads(line)
        assert result is not None, 'maintenance did not return JSON'
        assert result['blocked'] and result['reason'] == 'maintenance_busy', result
        assert all(value == 0 for value in result['deleted'].values()), result
        assert time.monotonic() - started < 5, 'cleanup waited behind the writer'
        # Keep BOTH transactions open: a rollback here would hide leaked locks.
        sql("begin; set local lock_timeout='1s'; lock table public.cards in row exclusive mode; rollback;")
    finally:
        if maintenance is not None:
            maintenance.stdin.write('rollback;\n\\q\n')
            maintenance.stdin.flush()
            maintenance.communicate(timeout=10)
        writer.stdin.write('rollback;\n\\q\n')
        writer.stdin.flush()
        writer.communicate(timeout=10)
    print(f'PASS: automatic cleanup yields to {table} writes without deleting records or retaining locks.')
