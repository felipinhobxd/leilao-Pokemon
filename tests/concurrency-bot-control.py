"""Supervisor claims race only in the disposable PostgreSQL CI database."""
import concurrent.futures
import json
import os
import subprocess
import threading
import uuid
from urllib.parse import urlparse

url = os.environ['TEST_DATABASE_URL']
assert urlparse(url).path == '/leilao_test', 'Use disposable leilao_test only'

def sql(statement):
    result = subprocess.run(['psql', url, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', statement], text=True, capture_output=True)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()

worker = 'control-race-' + str(uuid.uuid4())
sql(f"insert into whatsapp_bot_workers(worker_id) values('{worker}'); insert into whatsapp_bot_commands(worker_id,command) values('{worker}','reconnect');")
try:
    def race():
        barrier = threading.Barrier(8)
        def claim(_):
            barrier.wait(timeout=20)
            output = sql(f"begin; set local role service_role; select claim_whatsapp_bot_control('{worker}'); select pg_sleep(0.02); commit;")
            return json.loads(next(line for line in output.splitlines() if line.startswith('{')))
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            return list(pool.map(claim, range(8)))
    results = race()
    assert sum(r['command'] is not None for r in results) == 1, results
    sql(f"update whatsapp_bot_commands set status='pending',claimed_at=null where worker_id='{worker}'; update whatsapp_bot_workers set logout_requested=true where worker_id='{worker}';")
    results = race()
    assert all(r == {'logout_requested': True, 'command': None} for r in results), results
    assert sql(f"select count(*) from whatsapp_bot_commands where worker_id='{worker}' and status='pending';") == '1'
    assert sql(f"select logout_requested from whatsapp_bot_workers where worker_id='{worker}';") == 't'
    print('PASS: eight concurrent supervisor polls claim a command once; pending logout wins and remains durable.')
finally:
    sql(f"delete from whatsapp_bot_workers where worker_id='{worker}';")
