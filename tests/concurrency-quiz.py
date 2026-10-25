"""Real quiz races, only in the disposable PostgreSQL CI database."""
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

group, poll = str(uuid.uuid4()), str(uuid.uuid4())
people = [str(uuid.uuid4()) for _ in range(8)]
sql(f"insert into whatsapp_groups(id,group_jid,name,active) values('{group}','{group}@g.us','Quiz race',true); insert into whatsapp_quick_polls(id,group_id,title,options,external_event_id,game_kind,correct_index,prize_name,sent_at,poll_message_id) values('{poll}','{group}','Quiz race','[\"A\",\"B\"]','{poll}','quiz',1,'Pikachu',clock_timestamp(),'{poll}');")
for i, person in enumerate(people):
    sql(f"insert into participants(id,whatsapp_id,display_name) values('{person}','{person}','Player {i}');")
barrier = threading.Barrier(len(people))

def claim(person):
    barrier.wait(timeout=20)
    output = sql(f"begin; set local role service_role; select claim_quick_poll_prize('{poll}','{person}',1,'event-{person}',clock_timestamp()); select pg_sleep(0.05); commit;")
    return json.loads(next(line for line in output.splitlines() if line.startswith('{')))['won']

with concurrent.futures.ThreadPoolExecutor(max_workers=len(people)) as pool:
    results = list(pool.map(claim, people))
assert sum(results) == 1, results
counts = sql(f"select (select count(*) from whatsapp_quick_polls where id='{poll}' and winner_event_id is not null),(select count(*) from whatsapp_auction_notices where quick_poll_id='{poll}'),(select count(*) from auction_events where external_event_id='quick-prize:{poll}');")
assert counts == '1|1|1', counts
print('PASS: eight competing correct quiz answers produce one winner, one durable announcement and one audit event.')
