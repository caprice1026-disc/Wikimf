import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiUrl, ApiError, mutate, safeRedirect, setCsrfToken } from './api';
import { Achievements, DailyBars, EmptyState, ErrorNotice, MutationNotice, PageHeader, Resource, StatRail } from './components';
import { useMutation, useResource } from './hooks';
import { periodQuery } from './format';
import { AccountPage, ActivityPage, ArticlePage, LibraryPage, PairingPage, PrivacyPage, StatsPage } from './pages';
import type { Achievement, Activity, Page, Privacy, PublicProfile, Stats, User } from './types';
import { ReadingRow } from './components';
import { Icon, type IconName } from './icons';

type AuthContextValue = {
  user: ReturnType<typeof useResource<User>>;
  privacy: ReturnType<typeof useResource<Privacy>>;
  refresh: () => void;
};
const AuthContext = createContext<AuthContextValue | null>(null);
export function useAuth() { return useContext(AuthContext)!; }
export function useTimezone() { const auth = useAuth(); return auth.privacy.data?.timezone || auth.user.data?.timezone || 'Asia/Tokyo'; }

const navigation: [string, string, IconName][] = [
  ['/app', 'Overview', 'home'], ['/app/library', 'Library', 'book'], ['/app/activity', 'Activity', 'clock'],
  ['/app/stats', 'Statistics', 'chart'], ['/app/achievements', 'Achievements', 'spark'],
];

export function App() {
  const location = useLocation();
  const needsAuth = location.pathname !== '/' && !location.pathname.startsWith('/u/');
  const user = useResource<User>(needsAuth ? '/me' : null);
  const privacy = useResource<Privacy>(user.data ? '/me/privacy' : null);
  useEffect(() => { setCsrfToken(user.data?.csrf_token || ''); }, [user.data]);
  useEffect(() => {
    const expired = () => { setCsrfToken(''); user.reload(); privacy.reload(); };
    window.addEventListener('wikimf:auth-expired', expired);
    return () => window.removeEventListener('wikimf:auth-expired', expired);
  }, []);
  return <AuthContext.Provider value={{ user, privacy, refresh: () => { user.reload(); privacy.reload(); } }}><Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/u/:userId" element={<PublicProfilePage />} />
    <Route element={<RequireAuth />}>
      <Route path="/device-link" element={<PairingPage />} />
      <Route path="/link-device/:linkId" element={<PairingPage />} />
      <Route path="/home" element={<Navigate to="/app" replace />} />
      <Route path="/app" element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="articles/:articleId" element={<ArticlePage />} />
        <Route path="achievements" element={<AchievementsPage />} />
        <Route path="settings" element={<MorePage />} />
        <Route path="settings/account" element={<AccountPage />} />
        <Route path="settings/privacy" element={<PrivacyPage />} />
      </Route>
    </Route>
    <Route path="*" element={<BasicShell><EmptyState title="ページが見つかりません。" description="URL を確認するか、Overview へ戻ってください。" setup={false} /><Link className="button" to="/app">Overview へ</Link></BasicShell>} />
  </Routes></AuthContext.Provider>;
}

function RequireAuth() {
  const { user } = useAuth();
  const location = useLocation();
  if (user.loading) return <BasicShell><Resource value={user}>{() => null}</Resource></BasicShell>;
  if (user.error instanceof ApiError && user.error.status === 401) return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (user.error) return <BasicShell><ErrorNotice error={user.error} retry={user.reload} /></BasicShell>;
  return user.data ? <Outlet /> : <Navigate to="/login" replace />;
}

function BasicShell({ children }: { children: ReactNode }) {
  return <div className="basic-shell"><header><Link to="/" className="wordmark">wikimf<span>·</span></Link><Link to="/app">My reading ledger →</Link></header><main>{children}</main><footer>Last.fm for Wikipedia · 記録は、あなたのもの。</footer></div>;
}

function AppShell() {
  const { user, privacy } = useAuth();
  const [theme, setTheme] = useState(() => localStorage.getItem('wikimf-theme') || 'light');
  const location = useLocation();
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('wikimf-theme', theme); }, [theme]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.querySelector<HTMLElement>('#main-content')?.focus({ preventScroll: true });
  }, [location.pathname]);
  const mobileNavigation: [string, string, IconName][] = [...navigation.slice(0, 3), ['/app/settings', 'More', 'shield']];
  return <div className="app-shell">
    <a href="#main-content" className="skip-link">本文へ移動</a>
    <header className="global-header"><Link className="wordmark mobile-wordmark" to="/app"><Icon name="book" />wikimf</Link><p className="brand-caption">A PERSONAL KNOWLEDGE LEDGER</p><div className="global-actions"><span className={`collection-indicator ${(privacy.data?.collection_enabled ?? user.data?.collection_enabled) ? 'enabled' : ''}`}><i />{privacy.loading ? '確認中' : (privacy.data?.collection_enabled ?? user.data?.collection_enabled) ? '記録受付中' : '記録停止中'}</span><button className="theme-toggle" aria-label={theme === 'light' ? 'ダークモードに切り替え' : 'ライトモードに切り替え'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button><Link to="/app/settings/account" className="avatar" aria-label="アカウント設定">{user.data?.display_name.slice(0, 1) || 'W'}</Link></div></header>
    <aside className="sidebar"><Link className="wordmark sidebar-wordmark" to="/app"><Icon name="book" />wikimf</Link><p className="eyebrow">YOUR SPACE</p><nav aria-label="メインナビゲーション">{navigation.map(([to, label, icon]) => <NavLink key={to} to={to} end={to === '/app'}><Icon name={icon} />{label}</NavLink>)}</nav><div className="sidebar-bottom"><NavLink to="/app/settings/account"><Icon name="phone" />Account & devices</NavLink><NavLink to="/app/settings/privacy"><Icon name="shield" />Privacy & data</NavLink><p>Wikipedia を読み歩いた跡を、<br />少しずつ積み上げていく。</p></div></aside>
    <main id="main-content" className="main-content" tabIndex={-1}><Outlet /><footer className="ledger-footer"><Icon name="book" /><span>記録は、あなたのもの。</span><Link to="/app/settings/privacy">Privacy & data <Icon name="arrow" /></Link></footer></main>
    <nav className="mobile-nav" aria-label="モバイルナビゲーション">{mobileNavigation.map(([to, label, icon]) => <NavLink key={to} to={to} end={to === '/app'}><Icon name={icon} />{label}</NavLink>)}</nav>
  </div>;
}

function LandingPage() {
  return <BasicShell><section className="landing-hero"><p className="eyebrow">LAST.FM FOR WIKIPEDIA</p><h1>読み歩いた先に、<br />あなたの知識ログ。</h1><p className="landing-description">Wikipedia の寄り道を、忘れない。<br />読んだ記事、費やした時間、小さな発見。<br />日々の読書が、自分だけのライブラリに育ちます。</p><Link className="button" to="/login">読書ログをはじめる <span aria-hidden="true">→</span></Link><p className="privacy-note">🔒 読書履歴は、最初から非公開。</p></section><section className="landing-features"><article><span>01 / READ</span><h2>いつもの Wikipedia を読む</h2><p>Android Reader または Chrome Extension から。日本語と英語の記事に対応しています。</p></article><article><span>02 / REMEMBER</span><h2>読んだ跡が、残る</h2><p>閲覧、途中まで、読了。時間と表示状況から推定した記録を、いつでも振り返れます。</p></article><article><span>03 / YOURS</span><h2>公開も削除も、自分で選ぶ</h2><p>記録は本人だけのもの。収集の停止、JSON export、履歴の削除を自分で管理できます。</p></article></section><aside className="editorial-note"><span aria-hidden="true">¶</span><p>読了は推定です。数字は競争のためではなく、<br />あなたの興味がたどった道を眺めるために。</p></aside></BasicShell>;
}

function LoginPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const returnTo = params.get('returnTo') || '/app';
  const allowedReturn = safeRedirect(returnTo) || (returnTo.startsWith('/link-device/') || returnTo.startsWith('/device-link') ? returnTo : '/app');
  if (user.data) return <Navigate to={allowedReturn} replace />;
  return <BasicShell><section className="login-panel"><p className="eyebrow">WELCOME TO YOUR LEDGER</p><h1>続きは、あなたのページで。</h1><p>Google または GitHub でログインしてください。<br />Wikipedia のアカウントは必要ありません。</p><div className="login-buttons">{['google', 'github'].map(provider => <a className="button secondary" href={apiUrl(`/auth/${provider}/start?return_to=${encodeURIComponent(allowedReturn)}`)} key={provider}>{provider === 'google' ? 'Google' : 'GitHub'} で続ける <span aria-hidden="true">↗</span></a>)}</div>{params.get('error') && <p role="alert" className="error-notice">ログインを完了できませんでした。もう一度お試しください。</p>}<p className="muted small">すでに別のログイン方法を使っている場合は、その方法でログインしてから Account で追加してください。メールアドレスが同じでも、自動で結合しません。</p><p className="privacy-note">🔒 クラウドへの記録と公開は、ログイン後に選べます。</p></section></BasicShell>;
}

function OverviewPage() {
  const { user, privacy } = useAuth();
  const timezone = useTimezone();
  const stats = useResource<Stats>(`/me/stats?${periodQuery('7d', timezone)}`);
  const recent = useResource<Page<Activity>>('/me/activities?limit=12');
  const achievements = useResource<Page<Achievement>>('/me/achievements');
  return <><header className="profile-header"><div><p className="eyebrow">YOUR WIKIPEDIA READING HISTORY</p><h1 className="journal-title">Reading journal</h1><p className="profile-name">{user.data?.display_name}<span>今日の寄り道も、ここに。</span></p></div><Link className="privacy-badge" to="/app/settings/privacy"><Icon name="lock" />{privacy.error ? '公開設定を確認できません' : privacy.loading ? '公開設定を確認中' : privacy.data?.profile_public ? '選んだ情報を公開中' : 'Private'}</Link></header>
    <Resource value={stats}>{data => <><StatRail stats={data} /><p className="rail-caption">記事数と読了数は現在の状態。時間と推定文字数は直近 7 日間の記録です。</p></>}</Resource>
    <div className="overview-grid"><section className="recent-section"><div className="section-heading"><div><h2>Recent reading</h2><p className="section-description">最近読み歩いた、知識の足跡。</p></div><Link to="/app/activity">すべて見る <Icon name="arrow" /></Link></div><Resource value={recent}>{data => data.items.length ? <div className="reading-list">{data.items.map(item => <ReadingRow key={item.session_id} item={item} timezone={timezone} />)}</div> : <EmptyState />}</Resource></section>
    <aside className="insights"><section className="insight-chart"><div className="section-heading"><div><h2>Last 7 days</h2><p className="section-description">一週間の読書リズム</p></div><Link to="/app/stats" aria-label="統計を見る"><Icon name="chart" /></Link></div><Resource value={stats}>{data => <DailyBars daily={data.daily} timezone={timezone} columns />}</Resource><p className="muted small">アクティブな読書時間 · {timezone}</p></section><section><div className="section-heading"><h2><Icon name="spark" />Milestones</h2><Link to="/app/achievements" aria-label="称号を見る"><Icon name="arrow" /></Link></div><Resource value={achievements}>{data => data.items.some(item => item.earned) ? <Achievements items={data.items.filter(item => item.earned).slice(-2)} /> : <p className="muted">最初の記録から、小さな節目が積み上がります。</p>}</Resource></section><div className="quiet-note"><Icon name="book" /><div><p>記事を開いただけの閲覧と、読み進めた記録は別のもの。読了は、自分で変更できます。</p><Link to="/app/settings/privacy">記録の仕組みと設定 →</Link></div></div></aside></div></>;
}

function AchievementsPage() {
  const value = useResource<Page<Achievement>>('/me/achievements');
  return <><PageHeader title="Achievements" description="数字を競うためではなく、積み上げた読書の小さな節目。" /><Resource value={value}>{data => <><h2 className="section-label">これまでの節目</h2>{data.items.some(item => item.earned) ? <Achievements items={data.items.filter(item => item.earned)} /> : <EmptyState title="これからの記録が、最初の節目に。" description="自動計測した読書が、称号の根拠になります。手動の読了設定では進みません。" setup={false} />}<h2 className="section-label">次の一歩</h2><Achievements items={data.items.filter(item => !item.earned).slice(0, 3)} /></>}</Resource></>;
}

function MorePage() {
  return <><PageHeader title="Your space" description="読書を振り返る。記録を、自分で管理する。" /><div className="more-links">{[['/app/stats', 'Statistics', '期間と言語ごとの読書を振り返る'], ['/app/achievements', 'Achievements', '積み上げた読書の節目'], ['/app/settings/account', 'Account & devices', 'ログイン方法と連携端末'], ['/app/settings/privacy', 'Privacy & data', '公開範囲、記録の停止、export、削除']].map(([to, title, description]) => <Link to={to} key={to}><strong>{title}</strong><span>{description}</span><b aria-hidden="true">→</b></Link>)}</div></>;
}

function PublicProfilePage() {
  const { userId } = useParams();
  const value = useResource<PublicProfile>(`/profiles/${encodeURIComponent(userId || '')}`);
  return <BasicShell><Resource value={value}>{data => <section className="public-profile"><p className="eyebrow">WIKIPEDIA READING PROFILE</p><h1>{data.display_name}</h1>{data.active_ms !== null && <p className="public-time"><strong>{Math.floor(data.active_ms / 3_600_000)}h {Math.floor(data.active_ms / 60_000) % 60}m</strong><span>公開された読書時間</span></p>}{data.achievements !== null && data.achievements.length > 0 && <><h2>Milestones</h2><Achievements items={data.achievements} /></>}<p className="muted small">本人が選んだ情報だけを表示しています。</p></section>}</Resource></BasicShell>;
}

export function LogoutButton() {
  const value = useMutation();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  return <><button className="secondary" disabled={value.busy} onClick={async () => { if (await value.run(() => mutate('/auth/logout', 'POST'))) { setCsrfToken(''); refresh(); navigate('/login', { replace: true }); } }}>ログアウト</button><MutationNotice value={value} /></>;
}
