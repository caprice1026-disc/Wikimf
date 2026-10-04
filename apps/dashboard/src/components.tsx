import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ApiError, errorMessage } from './api';
import { dateTime, duration, number, shiftDate, sourceLabel } from './format';
import { Icon } from './icons';
import type { Achievement, Activity, ReadingState, Stats } from './types';

export const stateLabels: Record<ReadingState, string> = { viewed: '○ 閲覧', partial: '◐ 途中まで', completed: '✓ 読了' };
export function StatusChip({ state }: { state: ReadingState }) { return <span className={`status-chip ${state}`}>{stateLabels[state]}</span>; }
export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <header className="page-header"><div><p className="eyebrow">YOUR READING LEDGER</p><h1>{title}</h1>{description && <p className="muted">{description}</p>}</div>{action}</header>;
}
export function EmptyState({ title = 'まだ読書記録がありません。', description = 'Android Reader または Chrome Extension で Wikipedia を読むと、ここに記録が積み上がります。', setup = true }: { title?: string; description?: string; setup?: boolean }) {
  return <div className="empty-state"><span className="empty-mark"><Icon name="book" /></span><h3>{title}</h3><p>{description}</p>{setup && <Link className="button secondary" to="/app/settings/account#devices">端末の設定を見る <Icon name="arrow" /></Link>}</div>;
}
export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  const location = useLocation();
  const reauth = error instanceof ApiError && error.code === 'reauthentication_required';
  const settings = location.pathname.includes('/privacy') ? '/app/settings/privacy' : '/app/settings/account';
  return <div className={`error-notice ${reauth ? 'reauth-notice' : ''}`} role="alert"><Icon name={reauth ? 'shield' : 'globe'} /><div><p>{errorMessage(error)}</p><div className="inline">{retry && <button className="secondary" onClick={retry}>再試行</button>}<Link to={reauth ? `${settings}?reauth=required#reauthentication` : '/login'}>{reauth ? '本人確認へ進む →' : 'ログインを確認'}</Link></div></div></div>;
}
export function Resource<T>({ value, children }: { value: { data?: T; error?: unknown; loading: boolean; reload: () => void }; children: (data: T) => ReactNode }) {
  if (value.loading) return <div className="skeleton-list" role="status" aria-label="読み込み中"><span /><span /><span /></div>;
  if (value.error) return <ErrorNotice error={value.error} retry={value.reload} />;
  return value.data !== undefined ? children(value.data) : null;
}
export function MutationNotice({ value }: { value: { error?: unknown; notice: string } }) {
  return <>{value.error && <ErrorNotice error={value.error} />}{value.notice && <p className="success-notice" role="status">✓ {value.notice}</p>}</>;
}
export function StatRail({ stats }: { stats: Stats }) {
  return <div className="stat-rail"><div><strong>{number(stats.library.recorded_article_count)}</strong><span>記録した記事</span></div><div><strong>{number(stats.library.state_counts.completed)}</strong><span>現在の読了記事</span></div><div><strong>{duration(stats.activity.active_ms)}</strong><span>期間の読書時間</span></div><div><strong>{number(stats.activity.estimated_unique_read_chars)}</strong><span>期間の推定文字数</span></div></div>;
}
export function ReadingRow({ item, timezone, details = false }: { item: Activity; timezone: string; details?: boolean }) {
  return <article className="reading-row"><div className="reading-main"><span className="reading-mark"><Icon name="book" /></span><div className="reading-copy"><div className="reading-title-line"><Link className="article-title" to={`/app/articles/${item.article_id}`}>{item.article.title}</Link><span className="wiki-badge">{item.article.wiki === 'jawiki' ? 'JA' : 'EN'}</span></div><div className="reading-meta"><StatusChip state={item.state} /><span><Icon name="clock" />{duration(item.active_ms)} active</span><span>{item.measurement_status === 'time_only' ? '本文計測なし' : number(item.estimated_read_chars) + ' 推定文字'}</span><span><Icon name={item.source === 'android_reader' ? 'phone' : 'globe'} />{sourceLabel(item.source)}</span>{item.pending_sync && <span className="pending-label">同期を確認中</span>}</div>{item.coverage != null && <div className="reading-coverage"><span className="coverage-track" role="meter" aria-label="本文の表示カバー率" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.coverage * 100)}><span style={{ width: `${item.coverage * 100}%` }} /></span><span>{Math.round(item.coverage * 100)}% 表示</span></div>}</div></div><time dateTime={item.session_started_at}>{dateTime(item.session_started_at, timezone)}</time>{details && <details className="measurement"><summary>計測の詳細</summary><p>カバー率 {item.coverage == null ? '計測なし' : Math.round(item.coverage * 100) + '%'} · 自動推定{item.measurement_status === 'time_only' && ' · 本文を計測できなかったため、時間のみ記録'}{item.quarantined && ' · 整合性の確認中'}</p><p className="muted">判定ルール: {item.judgement_policy_version || '不明'}</p></details>}</article>;
}
export function DailyBars({ daily, timezone, columns = false }: { daily: Stats['daily']; timezone: string; columns?: boolean }) {
  if (columns) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const today = ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
    const days = Array.from({ length: 7 }, (_, index) => { const date = shiftDate(today, index - 6); return { date, active_ms: daily.find(day => day.date === date)?.active_ms || 0 }; });
    const maximum = Math.max(...days.map(day => day.active_ms), 1);
    return <><div className="daily-columns" aria-label={`${timezone} の直近7日間の読書時間`}>{days.map(day => <div className="daily-column" key={day.date} title={`${day.date}: ${duration(day.active_ms)}`}><strong>{duration(day.active_ms)}</strong><div className="column-track"><span style={{ height: `${day.active_ms / maximum * 100}%` }} /></div><time dateTime={day.date}>{new Intl.DateTimeFormat('ja-JP', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${day.date}T12:00:00Z`))}</time></div>)}</div><p className="chart-range">{dateTime(`${days[0].date}T12:00:00Z`, 'UTC', true)} — {dateTime(`${today}T12:00:00Z`, 'UTC', true)}</p></>;
  }
  const maximum = Math.max(...daily.map(day => day.active_ms), 1);
  return <div className="daily-bars" aria-label={`${timezone} の日別読書時間`}>{daily.length === 0 ? <p className="muted">この期間の読書時間はまだありません。</p> : daily.map(day => <div className="daily-bar" key={day.date}><span>{dateTime(`${day.date}T12:00:00Z`, 'UTC', true)}</span><div><span style={{ width: `${day.active_ms / maximum * 100}%` }} /></div><strong>{duration(day.active_ms)}</strong></div>)}</div>;
}
export function Achievements({ items }: { items: Achievement[] }) {
  return <div className="achievement-grid">{items.map(item => <article className={`achievement ${item.earned ? 'earned' : ''}`} key={item.id}><span className="achievement-icon"><Icon name={item.earned ? 'spark' : 'book'} /></span><p className="eyebrow">{item.earned ? 'ACHIEVED' : 'NEXT CHAPTER'}</p><h3>{item.name}</h3><p>{item.description}</p>{!item.earned && <><progress aria-label={item.name} value={item.progress} max={item.target} /><small>{number(item.progress)} / {number(item.target)}</small></>}</article>)}</div>;
}
export function ConfirmDialog({ title, children, label = '削除する', busy, onConfirm, onClose, requireWord = false, destructive = true }: { title: string; children: ReactNode; label?: string; busy: boolean; onConfirm: () => void; onClose: () => void; requireWord?: boolean; destructive?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} aria-labelledby="confirm-title"><form ref={form} onSubmit={event => { event.preventDefault(); if (form.current?.reportValidity()) onConfirm(); }}><p className="eyebrow">PLEASE CONFIRM</p><h2 id="confirm-title">{title}</h2><div className="dialog-copy">{children}</div>{requireWord && <label className="field">確認のため DELETE と入力してください<input autoComplete="off" pattern="DELETE" required aria-label="削除の確認" /></label>}<div className="dialog-actions"><button type="button" className="secondary" disabled={busy} onClick={onClose} autoFocus>キャンセル</button><button className={destructive ? 'danger' : undefined} disabled={busy}>{busy ? '処理中…' : label}</button></div></form></dialog>;
}
export function TimezoneSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = [...new Set([value, browser, 'Asia/Tokyo', 'UTC', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Australia/Sydney'])];
  return <label className="field compact">タイムゾーン<select value={value} onChange={event => onChange(event.target.value)}>{zones.map(zone => <option key={zone}>{zone}</option>)}</select></label>;
}
