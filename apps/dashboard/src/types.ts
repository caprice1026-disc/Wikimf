export type ReadingState = 'viewed' | 'partial' | 'completed';
export type Wiki = 'jawiki' | 'enwiki';
export type Source = 'android_reader' | 'chrome_extension';
export type User = { user_id: string; display_name: string; csrf_token: string; timezone: string; recording_epoch: number; collection_enabled: boolean };
export type Article = { article_id: string; wiki: Wiki; page_id: number; title: string; canonical_url: string; availability?: string };
export type ReadingRecord = {
  article: Article; article_id: string;
  effective_state: ReadingState; inferred_state: ReadingState | null; manual_state: ReadingState | null;
  active_ms: number; estimated_read_chars: number;
  last_read_at: string | null; activity_count: number; evidence?: 'inferred' | 'self_reported';
  coverage: number | null; pending_sync: boolean;
  activities?: Activity[];
};
export type Activity = {
  article: Article; article_id: string; session_id: string; session_started_at: string;
  state: ReadingState; active_ms: number; estimated_read_chars: number; source: Source;
  evidence?: string; coverage?: number | null; judgement_policy_version?: string;
  measurement_status?: string; pending_sync: boolean; quarantined: boolean;
};
export type Page<T> = { items: T[]; next_cursor: string | null; total?: number };
export type LibraryStats = {
  recorded_article_count: number; qualified_article_count: number;
  state_counts: Record<ReadingState, number>; completed_inferred_count: number; completed_self_reported_count: number;
};
export type Stats = {
  library: LibraryStats;
  activity: { activity_count: number; qualified_article_count: number; active_ms: number; estimated_unique_read_chars: number };
  daily: { date: string; active_ms: number; activity_count?: number }[];
  by_wiki: Record<string, { active_ms: number; activity_count: number }>;
  pending_recalculation: boolean; as_of: string; timezone: string;
};
export type Privacy = {
  collection_enabled: boolean; consent_version: string | null; profile_public: boolean;
  publish_total_time: boolean; publish_achievements: boolean;
  timezone: string; display_name: string;
};
export type Identity = { provider: 'google' | 'github'; linked_at: string };
export type Device = { device_id: string; display_name: string; source: Source; last_used_at?: string; revoked: boolean; created_at: string; expires_at: string };
export type Achievement = { id: string; name: string; description: string; earned: boolean; progress: number; target: number };
export type DeviceLink = { link_id: string; display_name: string; source: Source; user_code: string; scopes: string[]; expires_at: string; approved: boolean };
// The public response intentionally has no article/session/history fields.
export type PublicProfile = { user_id: string; display_name: string; active_ms: number | null; achievements: Achievement[] | null };
