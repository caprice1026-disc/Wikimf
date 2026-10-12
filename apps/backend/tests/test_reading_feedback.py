from datetime import timedelta

from conftest import observation, send, web_headers
from wikimf.db import now


def test_manual_state_is_current_in_library_and_activity_without_rewriting_session(env):
    _, client, ids = env
    event = observation(ids, seconds=30)
    assert send(client, ids, event).json()['results'][0]['status'] == 'accepted'
    before = client.get('/api/v1/me/stats').json()['activity']
    path = '/api/v1/me/articles/'+ids['article_id']+'/state'
    assert client.put(path, json={'state':'completed'}, headers=web_headers(ids)).status_code == 200
    library = client.get('/api/v1/me/articles').json()['items'][0]
    activity = client.get('/api/v1/me/activities').json()['items'][0]
    assert library['effective_state'] == activity['article_state'] == 'completed'
    assert activity['article_manual_state'] == 'completed' and activity['article_evidence'] == 'self_reported'
    assert activity['state'] == 'partial'
    assert client.get('/api/v1/me/stats').json()['activity'] == before

    # Re-reading cannot silently replace a user's manual choice.
    later = observation(ids, start=now()-timedelta(minutes=2), seconds=30)
    assert send(client, ids, later).json()['results'][0]['status'] == 'accepted'
    assert all(a['article_state']=='completed' and a['article_manual_state']=='completed'
               for a in client.get('/api/v1/me/activities').json()['items'])

    # Lowering a manual state and returning to automatic state both propagate.
    assert client.put(path, json={'state':'viewed'}, headers=web_headers(ids)).status_code == 200
    assert client.get('/api/v1/me/activities').json()['items'][0]['article_state'] == 'viewed'
    assert client.delete(path, headers=web_headers(ids)).status_code == 200
    library = client.get('/api/v1/me/articles').json()['items'][0]
    assert library['manual_state'] is None and library['effective_state'] == 'partial'
    for activity in client.get('/api/v1/me/activities').json()['items']:
        assert activity['article_state'] == 'partial' and activity['article_manual_state'] is None
        assert activity['article_evidence'] == 'inferred'


def test_v1_and_v2_replay_uses_new_japanese_cap_without_changing_raw_time_or_events(env):
    from sqlalchemy import select
    from wikimf.db import ReadingEvent
    app, client, ids = env
    for offset, policy in enumerate(['reading-v1', 'reading-v2']):
        event = observation(ids, start=now()-timedelta(minutes=2+offset), seconds=30, chunks=tuple(range(40)))
        event['measurement_policy_version'] = policy
        event['document'].update(text_chars=10000, chunk_chars=[200]*50)
        assert send(client, ids, event).json()['results'][0]['status'] == 'accepted'
    with app.state.sessions() as db:
        original = [row.payload for row in db.scalars(select(ReadingEvent))]
    items = client.get('/api/v1/me/activities').json()['items']
    assert len(items) == 2 and all(a['state']=='completed' for a in items)
    assert all(a['coverage']==.8 and a['judgement_policy_version']=='reading-v2' for a in items)
    # Overlapping time is attributed once across devices/sessions; cap cannot inflate it.
    summary = client.get('/api/v1/me/stats').json()['activity']
    assert summary['active_ms'] <= 60000 and summary['estimated_unique_read_chars'] == 900
    with app.state.sessions() as db:
        assert [row.payload for row in db.scalars(select(ReadingEvent))] == original
    assert send(client, ids, event).json()['results'][0]['status'] == 'duplicate'
    assert client.get('/api/v1/me/stats').json()['activity'] == summary


def test_character_estimate_is_covered_body_capped_by_language_time_budget():
    from wikimf.projection import RATES, infer
    assert RATES == {'jawiki':1800, 'enwiki':1000}
    doc = {'text_chars':10000, 'chunk_chars':[200]*50}
    for wiki in RATES:
        assert infer(doc,set(range(40)),30000,wiki)=='completed'
        assert infer(doc,set(range(40)),29999,wiki)=='viewed'
        assert infer(doc,set(range(39)),30000,wiki)=='partial'
    assert min(8000,30000*RATES['jawiki']//60000)==900
    assert min(8000,30000*RATES['enwiki']//60000)==500
    assert min(200,30000*RATES['jawiki']//60000)==200
