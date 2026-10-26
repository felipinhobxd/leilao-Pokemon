"""Maintenance yields immediately to an in-flight business write (CI DB only)."""
import json
import os
import subprocess
import time
from urllib.parse import urlparse

url = os.environ['TEST_DATABASE_URL']
assert urlparse(url).path == '/leilao_test', 'Disposable database required'

def sql(statement):
    return subprocess.run(['psql', url, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', statement],
                          capture_output=True, text=True, check=True).stdout.strip()

# Keep the writer transaction open without sleeps or timing-dependent races.
writer = subprocess.Popen(['psql', url, '-X', '-v', 'ON_ERROR_STOP=1', '-At'],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          text=True, bufsize=1)
try:
    writer.stdin.write("begin; lock table public.auctions in row exclusive mode; select 'writer_ready';\n")
    writer.stdin.flush()
    while writer.stdout.readline().strip() != 'writer_ready':
        assert writer.poll() is None, 'writer exited before locking'
    started = time.monotonic()
    result = json.loads(sql("begin; set local role service_role; select public.cleanup_old_auctions(); rollback;").splitlines()[-2])
    assert result['blocked'] and result['reason'] == 'maintenance_busy', result
    assert all(value == 0 for value in result['deleted'].values()), result
    assert time.monotonic() - started < 5, 'cleanup waited behind the writer'
    # The failed multi-table lock must also release earlier acquired locks.
    sql("begin; set local lock_timeout='1s'; lock table public.cards in row exclusive mode; rollback;")
finally:
    writer.stdin.write('rollback;\n\\q\n')
    writer.stdin.flush()
    writer.communicate(timeout=10)
print('PASS: automatic cleanup yields to business writes without deleting records.')
