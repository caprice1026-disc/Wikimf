"""The UI formats minutes, while server goal/evidence remains milliseconds."""
import pytest
from wikimf.projection import achievements


@pytest.mark.parametrize('ms,earned', [(0,False),(90_000,False),(3_599_999,False),(3_600_000,True)])
def test_reading_hour_uses_active_time_not_estimated_characters(ms,earned):
    projection={'records':[], 'activities':[], 'spans':[(1_760_000_000_000,1_760_000_000_000+ms,'fixture','jawiki','session')] if ms else [], 'increments':[(1_760_000_000_000,'fixture','jawiki',999_999)]}
    hour=next(x for x in achievements(projection) if x['id']=='reading-hour')
    assert hour['progress']==ms
    assert hour['target']==3_600_000
    assert hour['earned'] is earned
