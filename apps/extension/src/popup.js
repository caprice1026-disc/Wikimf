const $=id=>document.getElementById(id);
const messages={idle:'同期待ち',synced:'送信処理完了',offline:'通信待ち（接続・サーバー応答を確認）',reauth_required:'端末認証を確認してください',device_revoked:'端末の認証・権限を確認してください',owner_mismatch:'連携先を確認できません',server_paused:'サーバー受付OFF',queue_full:'容量上限で新しい記録を停止',queue_expired:'保存期限超過で新しい記録を停止',schema_mismatch:'互換性のない記録の診断があります'};
const errors={...messages,link_required:'先にアカウントを連携してください',already_linked:'この端末は連携済みです',pairing_unavailable:'連携サーバーへ接続できません。接続を確認して再試行してください',pairing_failed:'連携を完了できませんでした。承認状態と期限を確認してください',invalid_verification_origin:'Dashboardの接続先設定を確認してください',unsent_records:'未送信を保持しています。同期状態を確認して再試行してください',queue_changed:'未送信の内容が変わりました。件数を確認してもう一度操作してください',pairing_expired:'連携コードの期限が切れました。「アカウントと連携」から再発行してください'};
let current=null,busy=false,settingsRequests=0,revision=0,pendingSettings=null;
async function send(message){const result=await chrome.runtime.sendMessage(message);if(result?.error)throw new Error(result.error);return result;}
function renderExpiry(state){
  const expiry=state.linked&&state.queued>0?state.expiry:null;
  const near=expiry?.near_count>0&&!expiry.clock_anomaly&&Number.isFinite(expiry.remaining_ms)&&expiry.remaining_ms>=0;
  const remaining=near?(expiry.remaining_ms<60000?'1分未満':expiry.remaining_ms<3600000?`約${Math.floor(expiry.remaining_ms/60000)}分`:`約${Math.floor(expiry.remaining_ms/3600000)}時間`):'';
  const notice=near?`${expiry.unknown_count?'時刻を確認できた':''}未送信${expiry.near_count}件の送信期限が近づいています（最短 ${remaining}）`:'';
  if($('expiryNotice').textContent!==notice)$('expiryNotice').textContent=notice;
  $('expiryNotice').hidden=!near;
  const details=[];
  if(near)details.push(`期限まで24時間以内: ${expiry.near_count}件、最短 ${remaining}。`);
  if(expiry?.expired_count)details.push(`送信期限を過ぎた記録: ${expiry.expired_count}件。`);
  if(expiry?.unknown_count)details.push(`${expiry.clock_anomaly?'端末時計のずれを検出したため、':''}期限の目安を確認できない記録: ${expiry.unknown_count}件。`);
  if(details.length)details.push('端末時刻による目安です。認証・収集設定により送信できない場合があります。');
  $('expiryDetails').textContent=details.join(' ');$('expiryDetails').hidden=!details.length;
}
function render(state){
  current=state;
  const working=busy||state.operation_in_progress;
  const recording=!state.recording?'新しい記録: OFF':state.recording_enabled?'新しい記録: 設定ON':'新しい記録: 設定ON（条件待ち）';
  const sync=state.sync==='synced'&&state.queued>0?'送信分は完了・残りは同期待ち':messages[state.sync]||'同期待ち';
  $('status').textContent=working?'処理中… 未送信の残りを確認しています':settingsRequests?'設定を更新中…':state.linked?recording+' · '+sync:'アカウントを連携すると記録設定を選べます';
  $('identity').hidden=!state.linked;$('identity').textContent=state.display_name?'連携: '+state.display_name:'連携済み';$('identity').title='連携時の表示名。現在のアカウントと端末はDashboardで確認できます';
  $('linkedControls').hidden=!state.linked;$('counts').hidden=!state.linked;$('article').hidden=!state.linked;
  $('counts').textContent=`未送信 ${state.queued} 件 · 隔離 ${state.rejected} 件 · 除去 ${state.discarded} 件`;
  renderExpiry(state);
  const article=state.current_article,labels={viewed:'閲覧',partial:'途中まで',completed:'読了'};
  $('article').textContent=article?`サーバー記録: ${article.title} · ${labels[article.state]||'未判定'}${article.evidence==='self_reported'?'（手動）':'（自動判定）'}`:'現在の記事のサーバー記録は未確認です';
  const detail=article?.article_id,valid=typeof detail==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(detail);
  $('articleDetail').hidden=!state.linked||!valid;
  if(valid)$('articleDetail').href=new URL('/app/articles/'+encodeURIComponent(detail),state.dashboard_url).href;
  $('recording').checked=pendingSettings?.enabled??state.recording;$('sendQueued').checked=pendingSettings?.sendQueued??state.sendQueued;
  // Keep pause/preferences available during bulk sync; only destructive/duplicate actions wait.
  $('recording').disabled=!state.linked||state.unlinking;$('sendQueued').disabled=!state.linked||state.unlinking;
  $('pair').hidden=state.linked;$('pair').disabled=working;$('dashboard').href=new URL('/app',state.dashboard_url).href;
  const expires=state.pairing&&new Date(state.pairing.expires_at);
  $('pairing').textContent=state.pairing?`ブラウザーで承認して戻ってください。確認コード: ${state.pairing.user_code}${Number.isFinite(expires.getTime())?' · 有効期限 '+expires.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):''}`:'';
  for(const id of ['sync','discard','logout','logoutDiscard'])$(id).disabled=!state.linked||working||settingsRequests>0;
}
async function refresh(poll=false){
  const stamp=revision;
  try{const result=poll?await send({type:'pair.poll'}):null;const state=await send({type:'status'});if(stamp!==revision)return;if(result?.expired)$('error').textContent=errors.pairing_expired;render(state);}
  catch(error){if(stamp===revision&&!$('error').textContent)$('error').textContent=errors[error.message]||'状態を確認できません。接続と連携を確認してください';}
}
async function action(message){
  const setting=message.type==='recording';if(busy&&!setting)return;
  const stamp=++revision;
  if(setting){settingsRequests++;pendingSettings=message;}else busy=true;
  $('error').textContent='';if(current)render(current);
  try{await send(message);}
  catch(error){if(stamp===revision)$('error').textContent=errors[error.message]||'処理できませんでした。接続と連携状態を確認してください';}
  finally{
    if(setting){settingsRequests--;if(stamp===revision)pendingSettings=null;}else busy=false;
    await refresh();
  }
}
async function destructive(logout){
  if(busy)return;
  try{
    const preview=await send({type:'discard.preview'});
    const message=`このブラウザーの未送信 ${preview.queued} 件を破棄${logout?'して連携解除':''}しますか？\n未送信の読書時間・カバー率などは端末から除去され、元に戻せません。送信済みのクラウド記録は消えません。`;
    if(confirm(message))await action({type:logout?'logout':'discard',discard:logout,expected_event_ids:preview.event_ids,expected_device_id:preview.device_id});
  }catch(error){$('error').textContent=errors[error.message]||'対象を確認できません。もう一度操作してください';}
}
$('pair').addEventListener('click',()=>action({type:'pair.start'}));
for(const id of ['recording','sendQueued'])$(id).addEventListener('change',()=>action({type:'recording',enabled:$('recording').checked,sendQueued:$('sendQueued').checked}));
$('sync').addEventListener('click',()=>action({type:'sync',drain:true}));
$('discard').addEventListener('click',()=>destructive(false));
$('logout').addEventListener('click',()=>action({type:'logout',discard:false}));
$('logoutDiscard').addEventListener('click',()=>destructive(true));
setInterval(()=>{if(!busy&&!settingsRequests)void refresh(true);else if(current)void refresh();},5000);
void refresh();
