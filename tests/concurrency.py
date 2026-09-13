"""Real multi-connection PostgreSQL checks. Run only against disposable CI DB."""
import concurrent.futures
import json
import os
import subprocess
import threading
import uuid
from urllib.parse import urlparse

URL = os.environ['TEST_DATABASE_URL']
assert urlparse(URL).path == '/leilao_test', 'Use a disposable leilao_test database'

def sql(statement, check=True):
    result = subprocess.run(['psql', URL, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', statement], text=True, capture_output=True)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result

def uid():
    return str(uuid.uuid4())

admin, p1, p2 = uid(), uid(), uid()
sql(f"insert into auth.users values('{admin}'); insert into admin_profiles(user_id,display_name) values('{admin}','CI'); insert into participants(id,display_name,whatsapp_id) values('{p1}','A','{p1}'),('{p2}','B','{p2}');")

def run_race(same_event=False):
    card, auction = uid(), uid()
    sql(f"insert into cards(id,name,starting_price,buyout_price) values('{card}','Race',1,100); insert into auctions(id,card_id,status,starting_price,buyout_price,started_at) values('{auction}','{card}','open',1,100,clock_timestamp());")
    first = {'type':'BUYOUT_CONFIRMED','eventId':uid(),'auctionId':auction,'participantId':p1}
    second = first if same_event else {**first,'eventId':uid(),'participantId':p2}
    barrier = threading.Barrier(2)
    def call(command):
        barrier.wait(timeout=10)
        payload = json.dumps(command).replace("'", "''")
        return sql(f"begin; set local role service_role; select process_auction_command('{payload}'::jsonb,'{admin}'); select pg_sleep(0.2); commit;", check=False)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(call, [first, second]))
    successes = sum(r.returncode == 0 for r in results)
    assert successes == (2 if same_event else 1), [r.stderr for r in results]
    for r in results:
        if r.returncode: assert 'auction_not_open' in r.stderr, r.stderr
    counts = sql(f"select (select count(*) from purchases where auction_id='{auction}'),(select count(*) from auctions where id='{auction}' and status='sold' and winner_participant_id is not null),(select count(*) from deliveries where purchase_id in (select id from purchases where auction_id='{auction}')); ").stdout.strip()
    assert counts == '1|1|1', counts

for _ in range(5):
    run_race()
run_race(same_event=True)
print('PASS: 5 competing buyout races and 1 duplicate-event race; one winner/purchase/delivery each.')
