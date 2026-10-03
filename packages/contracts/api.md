# MVP-A API contract v1

All paths start `/api/v1`. JSON errors: `{error:{code,message,retryable,request_id}}`. Personal responses use `Cache-Control: no-store`. Dashboard uses cookies with credentials included; mutating cookie requests need `X-CSRF-Token` returned by GET `/me`. Device auth uses `Authorization: Bearer …`; devices cannot perform management mutations.

GET `/config` (public): `{dashboard_url}` is the configured Dashboard origin, without user data or credentials. Native uses `/app`, `/app/library`, `/app/articles/{id}`, `/app/settings/privacy` on this origin for browser management. Device approval uses `/link-device/{id}`. Only debug emulator clients may map server loopback hosts to `10.0.2.2`; production clients require HTTPS.

GET `/me`: `{user_id,display_name,timezone,recording_epoch,collection_enabled,csrf_token,device_id}`; csrf_token null for device, device_id null for web.

POST `/device-links`: `{source:"android_reader"|"chrome_extension",display_name}` → `{link_id,device_secret,user_code,verification_url,expires_at,poll_interval_seconds:5}`. GET `/device-links/{id}` (web session) → `{link_id,display_name,source,user_code,scopes,expires_at,approved}`. POST `/device-links/{id}/approve` (web+csrf): `{user_code}` → `{approved:true}`. POST `/device-links/{id}/exchange`: `{device_secret}` → `{token,user_id,device_id,recording_epoch,display_name}`. Pending: HTTP409 `authorization_pending`; expired/already exchanged: terminal errors. Verification URL is Dashboard `/link-device/{id}`. Do not put device_secret in URL. Exchange consumes grant once.

GET `/me/recording-control`: `{user_id,device_id,recording_epoch,collection_enabled,deletion_markers:[{article_id,deleted_before}]}`.

Article-history deletion sets `deleted_before` to server time plus the accepted five-minute clock-skew allowance. Clients discard sessions starting on/before this cutoff. Recording that article can resume after the cutoff; the conservative delay prevents a clock-ahead old Outbox from resurrecting deletion. Full-history deletion advances the recording epoch immediately.

POST `/articles/resolve`: `{url}` OR `{wiki,page_id}` → public Article. Article: `{article_id,wiki,page_id,language,title,canonical_url,namespace,trackable,untrackable_reason,metadata_status,resolved_at,availability,latest_revision_id}`. GET `/articles/{id}`, `/wikis/{wiki}/pages/{page_id}` same shape. POST `/articles/batch-get` `{article_ids:[uuid]}` → `{items:[Article]}`.

POST `/reading-events/batch`: exact detailed-design §15.3 `{schema_version:1,events:[…]}`. Item `schema_version` optional 1; `time_only` document fingerprint/text_chars null, chunk_chars empty; progress covered_chunk_ids empty, reason_code required. Empty intervals allowed for opened and closed, observed must positive. ACK `{results:[{event_id,status:"accepted"|"duplicate"|"rejected"|"quarantined",code,retryable:false}],recording_epoch,server_time}`. Item rejection does not remove unrelated accepted events. Whole-request auth/size failures have error envelope. Retries use same event IDs/payloads.

Lists GET `/me/articles`, `/me/activities`: `{items:[…],next_cursor}`. Filters wiki (jawiki/enwiki), state (articles), from/to (UTC timestamps), cursor, limit<=100. ArticleRecord: `{article:Article,article_id,effective_state,inferred_state,manual_state,evidence,active_ms,estimated_read_chars,coverage,last_read_at,activity_count,pending_sync}`. Activity: `{session_id,article:Article,article_id,source,session_started_at,state,evidence:"inferred",active_ms,estimated_read_chars,coverage,measurement_status,pending_sync,quarantined,judgement_policy_version}`. GET `/me/articles/{id}` returns ArticleRecord plus activities. PUT `/me/articles/{id}/state` `{state:"viewed"|"partial"|"completed"}`; DELETE same restores auto. DELETE `/me/articles/{id}/history` → `{deleted:true,recording_epoch}`.

GET `/me/stats?from=…&to=…&wiki=…&timezone=…`: `{library:{recorded_article_count,qualified_article_count,state_counts:{viewed,partial,completed},completed_inferred_count,completed_self_reported_count},activity:{activity_count,qualified_article_count,active_ms,estimated_unique_read_chars},by_wiki:{jawiki:{activity_count,active_ms,estimated_unique_read_chars},enwiki:{…}},daily:[{date,active_ms,estimated_unique_read_chars}],pending_recalculation:false,as_of,timezone}`. Current library counts are not historical state counts; period activities selected by session_started_at, time by clipped union intervals, chars by chronological maximum increments.

GET `/me/achievements` → `{items:[{id,name,description,earned,progress,target}]}`. GET `/me/devices` → `{items:[{device_id,display_name,source,created_at,expires_at,last_used_at,revoked}]}`. DELETE `/me/devices/{id}` revokes.

GET `/me/identities` → `{items:[{provider,linked_at}]}`. POST `/me/identities/{provider}/link` returns `{authorization_url}`. DELETE refuses last identity. GET `/auth/{provider}/start` redirects to provider; callback redirects Dashboard `/home`. POST `/auth/logout` removes Web session.

Each user has one identity per provider. Explicit linking a different subject for an already connected provider returns HTTP409 `provider_already_linked`; same-identity callbacks remain idempotent. `identity_already_linked` rejects a subject already belonging to another user. Unlink removes that provider's identities and refuses removal of the last remaining provider.

GET/PATCH `/me/privacy`: `{collection_enabled,consent_version,profile_public,publish_total_time,publish_achievements,timezone,display_name}`. Collection defaults false, profile defaults private. PATCH allows any of these fields, cloud opt-in requires consent_version `privacy-v1`. GET `/profiles/{user_id}` anonymous → `{user_id,display_name,active_ms:null|number,achievements:null|[earned items]}`; HTTP404 if private. No article/history data.

DELETE `/me/history` → `{deleted:true,recording_epoch}`. POST `/me/export` returns JSON `{export_version:1,user:{…},privacy:{…},articles:[records],activities:[…],events:[…]}` with no tokens/identity subjects. DELETE `/me` requires `{confirmation:"DELETE"}` → `{deleted:true}` and invalidates sessions/devices.
