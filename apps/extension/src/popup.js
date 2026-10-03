const $ = id => document.getElementById(id);
const messages = { idle: '同意して記録を開始できます', synced: '同期しました', offline: 'オフライン・保存済みの記録を再送待ち', reauth_required: '再連携が必要です', device_revoked: '端末の連携が解除されました', server_paused: 'すべての端末の受付を停止中', queue_full: '未送信記録が上限に達しました。同期または破棄してください', queue_expired: '保存期限を超えた記録があります', schema_mismatch: '互換性のない記録を隔離しました' };
const errors = { ...messages, link_required:'先にアカウントを連携してください', already_linked:'この端末はすでに連携済みです',
  pairing_unavailable:'連携サーバーへ接続できません。接続を確認して再試行してください',pairing_failed:'連携を完了できませんでした。承認の状態を確認し、必要なら再連携してください',
  invalid_verification_origin:'Dashboard の接続先設定を確認してください',owner_mismatch:'連携情報を確認できません。端末を再連携してください',
  unsent_records:'同期できていない記録が残っています。再試行するか破棄して解除してください。' };
async function send(message) { const result = await chrome.runtime.sendMessage(message); if (result?.error) throw new Error(result.error); return result; }
function render(state) {
  $('status').textContent = state.linked ? (state.recording ? '記録中 · ' : '記録停止 · ') + (messages[state.sync] || state.sync) : 'アカウントを連携して記録を始めましょう';
  $('counts').textContent = `未送信 ${state.queued} 件 · 隔離 ${state.rejected} 件 · 破棄 ${state.discarded} 件`;
  const article=state.current_article,states={viewed:'閲覧',partial:'途中まで読んだ',completed:'読了'};
  $('article').textContent=article ? `${article.title} · ${states[article.state]||'計測中'}${article.evidence==='self_reported'?'（自分で設定）':'（自動推定）'}` : '現在の記事の記録は Dashboard で確認できます';
  $('recording').checked = state.recording; $('recording').disabled = !state.linked;
  $('pair').hidden = state.linked; $('dashboard').href = state.dashboard_url;
  $('pairing').textContent = state.pairing ? `ブラウザで承認してください。確認コード: ${state.pairing.user_code}` : '';
  for (const id of ['sync','discard','logout','logoutDiscard']) $(id).disabled = !state.linked;
}
async function action(message) {
  $('error').textContent = '';
  try { await send(message); render(await send({ type: 'status' })); }
  catch (error) { $('error').textContent = errors[error.message] || '操作できませんでした。接続と連携状態を確認してください。'; }
}
$('pair').addEventListener('click', () => action({ type: 'pair.start' }));
$('recording').addEventListener('change', () => action({ type: 'recording', enabled: $('recording').checked, sendQueued: $('sendQueued').checked }));
$('sendQueued').addEventListener('change', () => action({ type: 'recording', enabled: $('recording').checked, sendQueued: $('sendQueued').checked }));
$('sync').addEventListener('click', () => action({ type: 'sync' }));
$('discard').addEventListener('click', () => { if (confirm('この端末の未送信記録を破棄しますか？')) void action({ type: 'discard' }); });
$('logout').addEventListener('click', () => action({ type: 'logout', discard: false }));
$('logoutDiscard').addEventListener('click', () => { if (confirm('未送信記録を破棄して連携を解除しますか？')) void action({ type: 'logout', discard: true }); });
setInterval(() => { void action({ type: 'pair.poll' }); }, 5000);
void action({ type: 'status' });
