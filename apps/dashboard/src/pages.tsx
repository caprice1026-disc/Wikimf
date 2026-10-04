import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { mutate, safeWikipediaUrl } from './api';
import { useMutation, useResource } from './hooks';
import { dateTime, duration, number, periodQuery, shiftDate, sourceLabel, validTimezone, zonedMidnight } from './format';
import { ConfirmDialog, DailyBars, EmptyState, MutationNotice, PageHeader, ReadingRow, Resource, StatRail, StatusChip, TimezoneSelect, stateLabels } from './components';
import { LogoutButton, useAuth, useTimezone } from './App';
import { Icon } from './icons';
import type { Activity, Device, DeviceLink, Identity, Page, Privacy, ReadingRecord, ReadingState, Stats } from './types';

function useFilters() {
  const [params, setParams] = useSearchParams();
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params); next.delete('cursor');
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  };
  return { params, setParams, update };
}
function Pagination({ nextCursor, params, setParams }: { nextCursor: string | null; params: URLSearchParams; setParams: (params: URLSearchParams) => void }) {
  return <div className="pagination">{params.get('cursor') && <button className="secondary" onClick={() => { const next = new URLSearchParams(params); next.delete('cursor'); setParams(next); }}>最初のページに戻る</button>}{nextCursor && <button className="secondary" onClick={() => { const next = new URLSearchParams(params); next.set('cursor', nextCursor); setParams(next); window.scrollTo({ top: 0 }); }}>次のページ →</button>}</div>;
}
function WikiFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className="field compact">言語<select value={value} onChange={event => onChange(event.target.value)}><option value="">すべての言語</option><option value="jawiki">JA · 日本語</option><option value="enwiki">EN · 英語</option></select></label>;
}

export function LibraryPage() {
  const { params, setParams, update } = useFilters();
  const timezone = useTimezone();
  const query = new URLSearchParams(params); query.set('limit', '50');
  const value = useResource<Page<ReadingRecord>>(`/me/articles?${query}`);
  const [search, setSearch] = useState(params.get('query') || '');
  useEffect(() => setSearch(params.get('query') || ''), [params]);
  return <><PageHeader title="Library" description="読んだことのある記事を、一つずつ。再読の記録も、同じ記事にまとまります。" /><form className="filter-bar" onSubmit={event => { event.preventDefault(); update('query', search); }}><label className="field search-field">自分の Library を検索<div className="search-control"><input type="search" placeholder="記事タイトルを探す" value={search} onChange={event => setSearch(event.target.value)} maxLength={200} /><button className="secondary">検索</button></div></label><WikiFilter value={params.get('wiki') || ''} onChange={value => update('wiki', value)} /><label className="field compact">読書状態<select value={params.get('state') || ''} onChange={event => update('state', event.target.value)}><option value="">すべての状態</option>{Object.entries(stateLabels).map(([state, label]) => <option key={state} value={state}>{label}</option>)}</select></label><label className="field compact">並び順<select value={params.get('sort') || 'last_read'} onChange={event => update('sort', event.target.value)}><option value="last_read">最近読んだ順</option><option value="active_ms">読書時間の多い順</option><option value="title">タイトル順</option></select></label></form><Resource value={value}>{data => data.items.length ? <><div className="library-list"><div className="library-columns" aria-hidden="true"><span>ARTICLE</span><span>STATUS</span><span>LAST READ</span><span>READING</span></div>{data.items.map(item => <article className="library-row" key={item.article_id}><div><Link className="article-title" to={`/app/articles/${item.article_id}`}>{item.article.title}</Link><p className="muted small">{item.article.wiki === 'jawiki' ? 'JA · 日本語 Wikipedia' : 'EN · English Wikipedia'}</p></div><div><StatusChip state={item.effective_state} />{item.manual_state && <small className="manual-label">手動設定</small>}</div><time dateTime={item.last_read_at || undefined}>{dateTime(item.last_read_at, timezone, true)}</time><div><strong>{duration(item.active_ms)}</strong><small>{item.coverage === null ? '文字数の計測なし' : number(item.estimated_read_chars) + ' 推定文字'}</small></div></article>)}</div><Pagination nextCursor={data.next_cursor} params={params} setParams={setParams} /></> : <EmptyState title={params.size ? '条件に合う記事がありません。' : 'まだ Library に記事がありません。'} description={params.size ? '検索語やフィルターを変えて、もう一度お試しください。' : undefined} setup={!params.size} />}</Resource></>;
}

export function ActivityPage() {
  const { params, setParams, update } = useFilters();
  const timezone = useTimezone();
  const query = new URLSearchParams(params); query.set('limit', '50');
  for (const key of ['from', 'to']) {
    const value = params.get(key);
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))) query.set(key, zonedMidnight(key === 'to' ? shiftDate(value, 1) : value, timezone));
    else query.delete(key);
  }
  const value = useResource<Page<Activity>>(`/me/activities?${query}`);
  return <><PageHeader title="Activity" description="いつ、何を読んだか。同じ記事への再訪も、一つの読書として残ります。" /><div className="filter-bar"><label className="field compact">開始日<input type="date" value={params.get('from') || ''} onChange={event => update('from', event.target.value)} /></label><label className="field compact">終了日<input type="date" min={params.get('from') || undefined} value={params.get('to') || ''} onChange={event => update('to', event.target.value)} /></label><label className="field compact">計測元<select value={params.get('source') || ''} onChange={event => update('source', event.target.value)}><option value="">すべての端末</option><option value="android_reader">Android Reader</option><option value="chrome_extension">Chrome Extension</option></select></label><WikiFilter value={params.get('wiki') || ''} onChange={value => update('wiki', value)} />{params.size > 0 && <button className="text-button" onClick={() => setParams(new URLSearchParams())}>すべての期間に戻す</button>}</div><p className="muted small">日付は {timezone} で表示しています。</p><Resource value={value}>{data => data.items.length ? <><div className="reading-list activity-list">{data.items.map(item => <ReadingRow key={item.session_id} item={item} timezone={timezone} details />)}</div><Pagination nextCursor={data.next_cursor} params={params} setParams={setParams} /></> : <EmptyState title="この期間の読書活動はありません。" description="別の期間を選ぶか、すべての期間の記録を表示してください。" setup={false} />}</Resource></>;
}

export function StatsPage() {
  const { params, update } = useFilters();
  const defaultTimezone = useTimezone();
  const timezone = validTimezone(params.get('timezone'), defaultTimezone);
  const period = params.get('period') || '7d';
  const query = periodQuery(period, timezone);
  if (params.get('wiki')) query.set('wiki', params.get('wiki')!);
  const value = useResource<Stats>(`/me/stats?${query}`);
  return <><PageHeader title="Statistics" description="読書の積み重ねを、時間と言語で振り返る。" /><div className="filter-bar"><label className="field compact">期間<select value={period} onChange={event => update('period', event.target.value)}><option value="today">今日</option><option value="7d">直近 7 日</option><option value="30d">直近 30 日</option><option value="all">全期間</option></select></label><WikiFilter value={params.get('wiki') || ''} onChange={value => update('wiki', value)} /><TimezoneSelect value={timezone} onChange={value => update('timezone', value)} /></div><Resource value={value}>{data => <><StatRail stats={data} /><p className="rail-caption">Library の件数は現在の到達状態です。過去の期間でも「当時の読了数」は表示しません。</p>{data.pending_recalculation && <p className="warning-note" role="status">再集計しています。数字は更新される場合があります。</p>}<div className="stats-grid"><section className="panel"><h2>日ごとの読書時間</h2><DailyBars daily={data.daily} timezone={timezone} /></section><section className="panel"><h2>現在の読書状態</h2><div className="state-breakdown">{Object.entries(data.library.state_counts).map(([state, count]) => <div key={state}><StatusChip state={state as ReadingState} /><strong>{number(count)}</strong></div>)}</div><p className="muted small">読了のうち 自動 {number(data.library.completed_inferred_count)} / 手動 {number(data.library.completed_self_reported_count)}。手動だけの記事は自動計測の記事数に含みません。</p><hr /><h2>期間の活動</h2><dl className="data-list"><div><dt>読書活動</dt><dd>{number(data.activity.activity_count)} sessions</dd></div><div><dt>計測できた記事</dt><dd>{number(data.activity.qualified_article_count)} 記事</dd></div></dl></section></div><section className="panel"><h2>言語別</h2><dl className="data-list">{Object.entries(data.by_wiki).map(([wiki, item]) => <div key={wiki}><dt>{wiki === 'jawiki' ? 'JA · 日本語 Wikipedia' : 'EN · English Wikipedia'}</dt><dd>{duration(item.active_ms)} · {number(item.activity_count)} sessions</dd></div>)}</dl></section><p className="muted small">最終集計: {dateTime(data.as_of, data.timezone)} · {data.timezone}<br />時間は期間内の重複しない活動区間、推定文字数は再読を重複加算しない増分です。</p></>}</Resource></>;
}

export function ArticlePage() {
  const { articleId } = useParams();
  const timezone = useTimezone();
  const value = useResource<ReadingRecord>(`/me/articles/${articleId}`);
  const mutation = useMutation();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [selection, setSelection] = useState<ReadingState>('viewed');
  useEffect(() => { if (value.data) setSelection(value.data.effective_state); }, [value.data]);
  return <div className="narrow-page"><Link className="back-link" to="/app/library">← Library</Link><Resource value={value}>{data => <><PageHeader title={data.article.title} description={`${data.article.wiki === 'jawiki' ? 'Japanese' : 'English'} Wikipedia · page ${data.article.page_id}`} action={safeWikipediaUrl(data.article.canonical_url) && <a className="button secondary" href={safeWikipediaUrl(data.article.canonical_url)!} target="_blank" rel="noopener noreferrer">Wikipedia で読む ↗</a>} /><p className="muted small">Chrome Extension または Android Reader で読むと、wikimf に記録されます。</p><section className="article-state"><StatusChip state={data.effective_state} /><span>{data.manual_state ? '手動設定' : '自動推定'}</span><p>読了は、表示状況と時間からの推定です。自分で変更できます。</p></section><div className="article-summary"><div><strong>{duration(data.active_ms)}</strong><span>総アクティブ時間</span></div><div><strong>{data.coverage === null ? '—' : number(data.estimated_read_chars)}</strong><span>推定読書文字数</span></div><div><strong>{number(data.activity_count)}</strong><span>読書 sessions</span></div></div><section className="panel"><h2>読書状態を変更</h2><p className="muted">表示する状態だけを変更します。読書時間と推定文字数は増えません。</p><fieldset className="state-options" disabled={mutation.busy}><legend className="sr-only">読書状態</legend>{Object.entries(stateLabels).map(([state, label]) => <label key={state}><input type="radio" name="state" value={state} checked={selection === state} onChange={() => setSelection(state as ReadingState)} />{label}</label>)}</fieldset><div className="inline"><button disabled={mutation.busy} onClick={async () => { if (await mutation.run(() => mutate(`/me/articles/${articleId}/state`, 'PUT', { state: selection }), '読書状態を更新しました。')) value.reload(); }}>手動設定を保存</button><button className="secondary" disabled={mutation.busy || !data.manual_state} onClick={async () => { if (await mutation.run(() => mutate(`/me/articles/${articleId}/state`, 'DELETE'), '自動推定に戻しました。')) { if (data.inferred_state) value.reload(); else navigate('/app/library', { replace: true }); } }}>自動推定に戻す</button></div></section><MutationNotice value={mutation} /><section><div className="section-heading"><h2>Reading history</h2></div>{data.activities?.length ? data.activities.map(item => <ReadingRow key={item.session_id} item={item} timezone={timezone} details />) : <p className="muted">自動計測した読書活動はありません。</p>}</section><section className="danger-zone"><h2>この記事の履歴を削除</h2><p>自分の読書活動、手動状態、統計への寄与を削除します。Wikipedia の記事は残ります。</p><button className="danger outline" onClick={() => setConfirm(true)}>この記事を履歴から削除</button></section></>}</Resource>{confirm && <ConfirmDialog title="この記事の履歴を削除しますか？" busy={mutation.busy} onClose={() => setConfirm(false)} onConfirm={async () => { if (await mutation.run(() => mutate(`/me/articles/${articleId}/history`, 'DELETE'))) { setConfirm(false); navigate('/app/library', { replace: true }); } }}><p>記事の読書活動、手動状態、時間と推定文字数への寄与が消えます。この操作は取り消せません。削除前の端末の未送信記録は、再送されても復活しません。</p><MutationNotice value={mutation} /></ConfirmDialog>}</div>;
}

export function AccountPage() {
  const { user, privacy, refresh } = useAuth();
  const identities = useResource<Page<Identity>>('/me/identities');
  const devices = useResource<Page<Device>>('/me/devices');
  const timezone = useTimezone();
  const mutation = useMutation();
  const [name, setName] = useState(user.data?.display_name || '');
  const [confirmation, setConfirmation] = useState<{ type: 'identity' | 'device'; id: string; name: string }>();
  const [authParams] = useSearchParams();
  useEffect(() => { if (authParams.get('reauth') === 'required') setConfirmation(undefined); }, [authParams]);
  return <div className="narrow-page"><PageHeader title="Account & devices" description="ログイン方法と、あなたの読書を記録する端末。" /><nav className="settings-tabs"><NavLinkLocal to="/app/settings/account">Account</NavLinkLocal><Link to="/app/settings/privacy">Privacy & data</Link></nav><Resource value={identities}>{data => <ReauthenticationPanel providers={data.items} />}</Resource><section className="panel"><h2>あなたの名前</h2><form className="inline profile-form" onSubmit={async event => { event.preventDefault(); if (await mutation.run(() => mutate('/me/privacy', 'PATCH', { display_name: name.trim() }), '表示名を保存しました。')) refresh(); }}><label className="field">表示名<input value={name} required maxLength={80} onChange={event => setName(event.target.value)} /></label><button disabled={mutation.busy || !name.trim()}>保存</button></form>{privacy.data?.profile_public && <p className="muted small">公開プロフィール: <Link to={`/u/${user.data?.user_id}`}>公開ページを確認 ↗</Link></p>}</section><section className="panel"><h2>ログイン方法</h2><p className="muted">追加する方法で再認証して、同じアカウントに連携します。メールによる自動結合はしません。</p><Resource value={identities}>{data => <div className="management-list">{(['google', 'github'] as const).map(provider => { const connected = data.items.find(item => item.provider === provider); return <div className="management-row" key={provider}><div><strong>{provider === 'google' ? 'Google' : 'GitHub'}</strong><p>{connected ? `連携済み · ${dateTime(connected.linked_at, timezone, true)}` : '未連携'}</p></div>{connected ? <button className="secondary" disabled={mutation.busy || data.items.length < 2} title={data.items.length < 2 ? '最後のログイン方法は解除できません' : undefined} onClick={() => setConfirmation({ type: 'identity', id: provider, name: provider })}>解除</button> : <button className="secondary" disabled={mutation.busy} onClick={() => mutation.run(async () => { const result = await mutate<{ authorization_url: string }>(`/me/identities/${provider}/link`, 'POST'); window.location.assign(result.authorization_url); })}>連携する ↗</button>}</div>; })}</div>}</Resource></section><section className="panel" id="devices"><h2>連携端末</h2><p className="muted">Android Reader または Chrome Extension で「アカウント連携」を選び、表示された確認ページを開いてください。</p><Resource value={devices}>{data => data.items.length ? <div className="management-list">{data.items.map(device => <div className="management-row" key={device.device_id}><div><strong>{device.display_name}</strong><p>{sourceLabel(device.source)} · {device.revoked ? '解除済み' : `最終利用 ${dateTime(device.last_used_at, timezone)}`}</p></div><button className="secondary" disabled={mutation.busy || device.revoked} onClick={() => setConfirmation({ type: 'device', id: device.device_id, name: device.display_name })}>{device.revoked ? '解除済み' : '端末を解除'}</button></div>)}</div> : <EmptyState title="まだ端末が連携されていません。" description="Reader または拡張から連携すると、ここで確認できます。" setup={false} />}</Resource></section><MutationNotice value={mutation} /><section className="panel"><h2>このブラウザからログアウト</h2><p className="muted">Web セッションを終了します。連携端末の記録停止は Privacy または端末解除から行えます。</p><LogoutButton /></section>{confirmation && <ConfirmDialog title={confirmation.type === 'device' ? `${confirmation.name} を解除しますか？` : `${confirmation.name} のログイン連携を解除しますか？`} label="解除する" busy={mutation.busy} onClose={() => setConfirmation(undefined)} onConfirm={async () => { const path = confirmation.type === 'device' ? `/me/devices/${confirmation.id}` : `/me/identities/${confirmation.id}`; if (await mutation.run(() => mutate(path, 'DELETE'), '連携を解除しました。')) { setConfirmation(undefined); devices.reload(); identities.reload(); } }}><p>{confirmation.type === 'device' ? 'この端末のトークンを失効します。端末は新しい記録を送信できなくなります。未送信キューは端末側で破棄または再連携が必要です。すでにある読書履歴は残ります。' : 'この方法ではログインできなくなります。ほかのログイン方法と、既存の読書履歴は残ります。'}</p><MutationNotice value={mutation} /></ConfirmDialog>}</div>;
}
function NavLinkLocal({ to, children }: { to: string; children: string }) { return <Link className="active" to={to}>{children}</Link>; }

function ReauthenticationPanel({ providers }: { providers: Identity[] }) {
  const { user } = useAuth();
  const timezone = useTimezone();
  const [params] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState(providers[0]?.provider || 'google');
  const availableProvider = providers.some(identity => identity.provider === provider) ? provider : providers[0]?.provider;
  const mutation = useMutation();
  const navigate = useNavigate();
  const privacyPage = window.location.pathname.includes('/privacy');
  const returnTo = privacyPage ? '/app/settings/privacy' : '/app/settings/account';
  const errors: Record<string, string> = {
    reauthentication_cancelled: '本人確認をキャンセルしました。設定や履歴は変更していません。',
    reauthentication_identity_mismatch: '連携済みのアカウントと一致しませんでした。同じアカウントを選んでやり直してください。',
    reauthentication_session_changed: 'ログイン状態が変わりました。この画面から本人確認をやり直してください。',
    reauthentication_failed: '本人確認を完了できませんでした。もう一度お試しください。',
  };
  const until = user.data?.recent_auth_until;
  useEffect(() => {
    if (params.get('reauth') || params.get('reauth_error') || params.get('reauthenticated')) {
      const panel = document.getElementById('reauthentication');
      panel?.scrollIntoView({ block: 'start' });
      panel?.focus({ preventScroll: true });
    }
  }, [params]);
  return <section className="panel reauth-panel" id="reauthentication" tabIndex={-1}>
    <div className="inline"><h2><Icon name="shield" />重要な操作の本人確認</h2><button className="secondary" onClick={() => setOpen(true)} disabled={!providers.length}>本人確認を始める</button></div>
    <p className="muted small">アカウントや全履歴の削除、ログイン方法の変更、公開範囲の拡大には、10分以内の認証が必要です。</p>
    {until && <p className="muted small">直近の認証の有効期限: {dateTime(until, timezone)}。操作時にサーバーで確認します。</p>}
    {params.get('reauth') === 'required' && <p className="warning-note" role="status">本人確認が終わったら、元の操作をもう一度実行してください。</p>}
    {params.get('reauthenticated') === '1' && <p className="success-notice" role="status">✓ 本人確認が完了しました。操作をもう一度実行してください。</p>}
    {params.get('reauth_error') && <p className="warning-note" role="alert">{errors[params.get('reauth_error')!] || errors.reauthentication_failed}</p>}
    {open && <ConfirmDialog title="連携済みの方法で本人確認" label="選んだ方法で本人確認" destructive={false} busy={mutation.busy} onClose={() => setOpen(false)} onConfirm={() => { if (availableProvider) mutation.run(async () => { const result = await mutate<{ authorization_url: string }>(`/auth/${availableProvider}/reauthenticate?return_to=${encodeURIComponent(returnTo)}`, 'POST'); window.location.assign(result.authorization_url); }); }}>
      <p>ログイン先で、現在のアカウントに連携したものと同じアカウントを選んでください。</p>
      <label className="field">本人確認に使うログイン方法<select value={availableProvider || ''} onChange={event => setProvider(event.target.value as Identity['provider'])}>{providers.map(identity => <option key={identity.provider} value={identity.provider}>{identity.provider === 'google' ? 'Google' : 'GitHub'}</option>)}</select></label>
      <p>本人確認だけを行います。戻ってから、削除や設定変更を自分で実行してください。</p><MutationNotice value={mutation} />
    </ConfirmDialog>}
    {params.get('reauth_error') && <button className="text-button" onClick={() => navigate(returnTo, { replace: true })}>案内を閉じる</button>}
  </section>;
}

export function PrivacyPage() {
  const { privacy, refresh } = useAuth();
  const identities = useResource<Page<Identity>>('/me/identities');
  const mutation = useMutation();
  const [draft, setDraft] = useState<Privacy>();
  const [confirm, setConfirm] = useState<'history' | 'account'>();
  const navigate = useNavigate();
  const [authParams] = useSearchParams();
  useEffect(() => { if (authParams.get('reauth') === 'required') setConfirm(undefined); }, [authParams]);
  useEffect(() => { if (privacy.data) setDraft(privacy.data); }, [privacy.data]);
  const update = (key: keyof Privacy, value: boolean | string) => setDraft(current => current ? { ...current, [key]: value } : current);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const { consent_version, ...settings } = draft;
    const payload = { ...settings, ...(draft.collection_enabled ? { consent_version: 'privacy-v1' } : consent_version ? { consent_version } : {}) };
    if (await mutation.run(() => mutate('/me/privacy', 'PATCH', payload), 'プライバシー設定を保存しました。')) privacy.reload();
  }
  return <div className="narrow-page"><PageHeader title="Privacy & data" description="記録するか、何を公開するか。いつでも、自分で選べます。" /><nav className="settings-tabs"><Link to="/app/settings/account">Account</Link><NavLinkLocal to="/app/settings/privacy">Privacy & data</NavLinkLocal></nav><Resource value={identities}>{data => <ReauthenticationPanel providers={data.items} />}</Resource><Resource value={privacy}>{() => draft && <form onSubmit={save}><section className="panel"><h2>Recording</h2><label className="toggle-row"><span><strong>全端末からのクラウド記録</strong><small>ON にすると、連携端末が読書活動をサーバーへ送信できます。</small></span><input type="checkbox" role="switch" checked={draft.collection_enabled} onChange={event => update('collection_enabled', event.target.checked)} /></label><div className="quiet-note plain"><p>非公開でも、同意した記録はサーバーに同期されます。端末内の最近の記事、クラウドの読書履歴、他人への公開は別の設定です。</p><p>ここで OFF にすると、全端末からの新しい記録受付を止めます。各端末の「記録を一時停止」は、その端末だけを止めます。停止前の未送信記録は、端末で送信または破棄を選んでください。</p><p>収集するのは記事 ID、表示状況、時間などの読書記録です。本文全文、入力内容、Wikipedia 以外の閲覧履歴は収集しません。<br /><small>同意文書: privacy-v1</small></p></div><TimezoneSelect value={draft.timezone} onChange={value => update('timezone', value)} /></section><section className="panel"><h2>Visibility</h2><p className="muted">履歴と記事一覧は非公開です。公開プロフィールでも、選んだ情報だけを表示します。</p>{([['profile_public', '公開プロフィール', 'あなたの表示名のページを公開します。'], ['publish_total_time', '総読書時間を公開', 'プロフィールが公開のとき、この合計値を表示します。'], ['publish_achievements', '称号を公開', 'プロフィールが公開のとき、獲得した称号を表示します。']] as const).map(([key, label, description]) => <label className="toggle-row" key={key}><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" role="switch" checked={draft[key]} onChange={event => update(key, event.target.checked)} /></label>)}</section><button disabled={mutation.busy}>設定を保存</button><MutationNotice value={mutation} /></form>}</Resource><section className="panel export-panel"><h2>Data export</h2><p className="muted">自分の読書履歴と状態を JSON で保存できます。認証トークンなどの秘密情報は含まれません。</p><button className="secondary" disabled={mutation.busy} onClick={() => mutation.run(async () => { const data = await mutate<unknown>('/me/export', 'POST'); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `wikimf-export-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }, 'JSON export を保存しました。')}>JSON をダウンロード ↓</button></section><section className="danger-zone"><h2>読書履歴をすべて削除</h2><p>読書活動、手動状態、統計、称号の根拠を削除します。アカウントとログイン方法は残ります。削除前の端末キューは受け付けません。</p><button className="danger outline" onClick={() => setConfirm('history')}>履歴をすべて削除</button></section><section className="danger-zone"><h2>アカウントを削除</h2><p>読書履歴とアカウントを削除し、すべての Web セッションと端末トークンを失効します。</p><button className="danger outline" onClick={() => setConfirm('account')}>アカウントを削除</button></section>{confirm && <ConfirmDialog title={confirm === 'history' ? 'すべての読書履歴を削除しますか？' : 'アカウントを削除しますか？'} busy={mutation.busy} requireWord={confirm === 'account'} onClose={() => setConfirm(undefined)} onConfirm={async () => { if (await mutation.run(() => mutate(confirm === 'history' ? '/me/history' : '/me', 'DELETE', confirm === 'account' ? { confirmation: 'DELETE' } : undefined))) { const deletingAccount = confirm === 'account'; setConfirm(undefined); refresh(); navigate(deletingAccount ? '/login' : '/app', { replace: true }); } }}><p>{confirm === 'history' ? '読書活動、手動状態、時間・文字数・称号への寄与が消えます。アカウントは残ります。端末が再送する古い履歴は復活しません。' : 'すべての個人記録を削除し、このブラウザと連携端末をログアウトします。'}</p><p>この操作は取り消せません。</p><MutationNotice value={mutation} /></ConfirmDialog>}</div>;
}

export function PairingPage() {
  const { linkId } = useParams();
  const [params] = useSearchParams();
  const id = linkId || params.get('id') || '';
  const value = useResource<DeviceLink>(id ? `/device-links/${encodeURIComponent(id)}` : null);
  const mutation = useMutation();
  const [code, setCode] = useState('');
  const [approved, setApproved] = useState(false);
  const timezone = useTimezone();
  return <div className="pairing-page"><Link to="/app" className="wordmark">wikimf<span>·</span></Link><PageHeader title="端末を連携する" description="元の端末に表示された内容と、一致しているか確認してください。" />{!id ? <EmptyState title="連携リクエストがありません。" description="Reader または Chrome Extension でアカウント連携を始め、表示された確認ページを開いてください。" setup={false} /> : <Resource value={value}>{data => data.approved || approved ? <div className="panel pairing-approved" role="status"><span>✓</span><h2>端末の連携を承認しました。</h2><p>元の端末に戻り「連携を確認」を選んでください。記録を始める前に、端末で同意を確認します。</p><Link className="button secondary" to="/app/settings/account">連携端末を確認 →</Link></div> : <form className="panel" onSubmit={async event => { event.preventDefault(); if (await mutation.run(() => mutate(`/device-links/${id}/approve`, 'POST', { user_code: code.trim() }))) setApproved(true); }}><h2>{data.display_name}</h2><p className="muted">{sourceLabel(data.source)} · 期限 {dateTime(data.expires_at, timezone)}</p><p>この端末に許可する操作:</p><ul>{data.scopes.map(scope => <li key={scope}>{scope === 'reading:write' ? '読書活動の送信' : scope === 'reading:read' ? '自分の読書記録の取得' : scope === 'profile:read' ? 'アカウントの基本情報の取得' : scope}</li>)}</ul><label className="field">端末に表示された確認コード<input value={code} onChange={event => setCode(event.target.value)} autoComplete="off" required maxLength={32} placeholder="例: ABCD-1234" /></label><p className="muted small">自分が開始した端末のリクエストだけを承認してください。このページを開いただけでは承認されません。</p><button disabled={mutation.busy || !code.trim()}>この端末を承認する</button><MutationNotice value={mutation} /></form>}</Resource>}<Link className="back-link" to="/app">← Dashboard に戻る</Link></div>;
}
