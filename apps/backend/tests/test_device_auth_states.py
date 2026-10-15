from datetime import timedelta

import pytest

from wikimf.db import Device, now


@pytest.mark.parametrize("state,status,code", [
    ("expired", 401, "invalid_device_token"),
    ("revoked", 401, "invalid_device_token"),
    ("missing_scope", 403, "insufficient_scope"),
])
def test_device_auth_failure_cannot_fall_back_to_valid_web_session(env, state, status, code):
    app, client, ids = env
    with app.state.sessions() as db:
        device = db.get(Device, ids["device_id"])
        original_hash = device.token_hash
        if state == "expired":
            device.expires_at = now() - timedelta(seconds=1)
        elif state == "revoked":
            device.revoked_at = now()
        else:
            device.scopes = []
        db.commit()
    # The fixture already has a valid owner Web cookie; it is not a device renewal.
    response = client.get("/api/v1/me/recording-control", headers={"Authorization": "Bearer " + ids["token"]})
    assert response.status_code == status
    assert response.json()["error"]["code"] == code
    with app.state.sessions() as db:
        assert db.get(Device, ids["device_id"]).token_hash == original_hash
