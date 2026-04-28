'use strict';

// ---- Login / Logout ----
loginInput.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
loginBtn.addEventListener('click', doLogin);

function doLogin() {
  const raw = loginInput.value.trim();
  if (!raw) { showLoginError('公開鍵を入力してください'); return; }
  let hex;
  try { hex = npubToHex(raw); } catch (e) { showLoginError(e.message); return; }

  currentUserHex = hex;
  localStorage.setItem('nostr_pubkey', raw);
  hideLoginError();
  showApp();
  connectAllRelays();
  resetIdleTimer();
  loadingText.textContent = 'フォローリストを取得中...';
  fetchContactList(hex);
}

function showLoginError(msg) {
  loginError.textContent = msg;
  loginError.classList.remove('hidden');
}
function hideLoginError() {
  loginError.classList.add('hidden');
}

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('nostr_pubkey');
  currentUserHex = null;
  followedPubkeys.clear();
  posts = [];
  pendingPosts = [];
  olderPostsBuffer = [];
  loadingOlder = false;
  olderSubId = null;
  olderEoseExpected = 0;
  olderEoseReceived = 0;
  seenEvents.clear();
  mainSubId = null;
  contactListTs = 0; // 再ログイン時に handleContactEvent が startMainFeed を呼べるようリセット
  reactionMap.clear();
  replyMap.clear();
  hideNewPostsBanner();
  for (const [, conn] of connections) { try { conn.ws.close(); } catch (_) {} }
  connections.clear();
  postListEl.innerHTML = '';
  loadingEl.classList.remove('hidden');
  loadingText.textContent = '投稿を取得中...';
  appHeader.classList.add('hidden');
  appMain.classList.add('hidden');
  hideMobileUI();
  stopTimeUpdater();
  loginScreen.classList.remove('hidden');
  loginInput.value = '';
});

function showApp() {
  loginScreen.classList.add('hidden');
  appHeader.classList.remove('hidden');
  appMain.classList.remove('hidden');
  showMobileUI();
  startTimeUpdater();
}

// ---- Relay add UI ----
relayAddBtn.addEventListener('click', () => addRelay(relayInputEl.value));
relayInputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') addRelay(relayInputEl.value);
});
relayInputEl.addEventListener('input', () => {
  document.getElementById('relayAddError').classList.add('hidden');
});

// ---- Modal ----
function openModal(event) {
  const profile = profileCache.get(event.pubkey) || {};
  const name = profile.display_name || profile.name || shortPubkey(event.pubkey);
  const imageUrls = extractImageUrls(event.content);
  const tweetUrls = extractTweetUrls(event.content);
  const youtubeUrls = extractYoutubeUrls(event.content);
  const nostrRefs = extractNostrRefs(event.content);
  const profileRefs = extractProfileRefs(event.content);
  const textContent = textWithoutMediaUrls(event.content, imageUrls, tweetUrls, nostrRefs, youtubeUrls, profileRefs);

  modalBody.innerHTML = `
    <div class="post-header" style="margin-bottom:16px"></div>
    ${textContent ? `<div class="post-body" style="margin-bottom:16px">${escHtml(textContent)}</div>` : ''}
    <div class="modal-detail-label">イベントID</div>
    <div class="modal-detail-value">${escHtml(event.id)}</div>
    <div class="modal-detail-label">公開鍵</div>
    <div class="modal-detail-value">${escHtml(event.pubkey)}</div>
    <div class="modal-detail-label">タイムスタンプ</div>
    <div class="modal-detail-value">${escHtml(formatDate(event.created_at))}</div>
  `;

  const ph = modalBody.querySelector('.post-header');
  ph.appendChild(avatarEl(event.pubkey, profile.picture));
  const meta = document.createElement('div');
  meta.className = 'post-meta';
  meta.innerHTML = `<div class="post-author">${escHtml(name)}</div><div class="post-time">${escHtml(formatDate(event.created_at))}</div>`;
  ph.appendChild(meta);

  if (imageUrls.length > 0) {
    const grid = buildImageGrid(imageUrls, url => openImageViewer(url));
    const firstDetail = modalBody.querySelector('.modal-detail-label');
    modalBody.insertBefore(grid, firstDetail);
    grid.style.marginBottom = '16px';
  }

  if (tweetUrls.length > 0) {
    const embeds = buildTweetEmbeds(tweetUrls);
    const firstDetail = modalBody.querySelector('.modal-detail-label');
    modalBody.insertBefore(embeds, firstDetail);
  }

  if (youtubeUrls.length > 0) {
    const embeds = buildYoutubeEmbeds(youtubeUrls);
    if (embeds) {
      const firstDetail = modalBody.querySelector('.modal-detail-label');
      modalBody.insertBefore(embeds, firstDetail);
    }
  }

  if (nostrRefs.length > 0) {
    const wrap = document.createElement('div');
    const firstDetail = modalBody.querySelector('.modal-detail-label');
    buildNostrEmbeds(nostrRefs, wrap);
    modalBody.insertBefore(wrap, firstDetail);
  }

  if (profileRefs.length > 0) {
    const wrap = document.createElement('div');
    const firstDetail = modalBody.querySelector('.modal-detail-label');
    buildProfileEmbeds(profileRefs, wrap);
    modalBody.insertBefore(wrap, firstDetail);
  }

  const reacts = reactionMap.get(event.id);
  if (reacts && reacts.size > 0) {
    const reactRow = document.createElement('div');
    reactRow.className = 'post-reactions';
    reactRow.style.marginBottom = '12px';
    renderCardReactions(reactRow, event.id);
    const firstDetail = modalBody.querySelector('.modal-detail-label');
    modalBody.insertBefore(reactRow, firstDetail);
  }

  if (event.kind === 1) {
    const thread = buildReplyThread(event.id);
    if (thread) {
      const firstDetail = modalBody.querySelector('.modal-detail-label');
      modalBody.insertBefore(thread, firstDetail);
    }
  }

  modal.classList.remove('hidden');
}

function buildReplyThread(eventId) {
  const repliesMap = replyMap.get(eventId);
  if (!repliesMap || repliesMap.size === 0) return null;
  const replies = [...repliesMap.values()].sort((a, b) => a.created_at - b.created_at);

  const section = document.createElement('div');
  section.className = 'thread-section';

  const label = document.createElement('div');
  label.className = 'thread-label';
  label.textContent = `💬 リプライ ${replies.length}件`;
  section.appendChild(label);

  for (const reply of replies) {
    const profile = profileCache.get(reply.pubkey) || {};
    const name = profile.display_name || profile.name || shortPubkey(reply.pubkey);
    const imageUrls = extractImageUrls(reply.content);
    const tweetUrls = extractTweetUrls(reply.content);
    const youtubeUrls = extractYoutubeUrls(reply.content);
    const nostrRefs = extractNostrRefs(reply.content);
    const text = textWithoutMediaUrls(reply.content, imageUrls, tweetUrls, nostrRefs, youtubeUrls);

    const item = document.createElement('div');
    item.className = 'thread-item';

    const itemHeader = document.createElement('div');
    itemHeader.className = 'thread-item-header';

    const av = avatarEl(reply.pubkey, profile.picture);
    av.classList.add('avatar-xs');
    av.addEventListener('click', () => { closeModal(); openProfileModal(reply.pubkey); });

    const nameEl = document.createElement('span');
    nameEl.className = 'thread-item-name clickable-author';
    nameEl.textContent = name;
    nameEl.addEventListener('click', () => { closeModal(); openProfileModal(reply.pubkey); });

    const timeEl = document.createElement('span');
    timeEl.className = 'thread-item-time post-time';
    timeEl.dataset.ts = reply.created_at;
    timeEl.textContent = timeAgo(reply.created_at);

    itemHeader.appendChild(av);
    itemHeader.appendChild(nameEl);
    itemHeader.appendChild(timeEl);

    const body = document.createElement('div');
    body.className = 'thread-item-body';
    renderTextWithTags(body, text);

    const grid = buildImageGrid(imageUrls.slice(0, 2), url => openImageViewer(url));
    const tweetEmbeds = buildTweetEmbeds(tweetUrls.slice(0, 1));
    const youtubeEmbeds = buildYoutubeEmbeds(youtubeUrls.slice(0, 1));

    item.appendChild(itemHeader);
    if (text) item.appendChild(body);
    if (grid) item.appendChild(grid);
    if (tweetEmbeds) item.appendChild(tweetEmbeds);
    if (youtubeEmbeds) item.appendChild(youtubeEmbeds);
    if (nostrRefs.length > 0) buildNostrEmbeds(nostrRefs.slice(0, 2), item);
    section.appendChild(item);
  }
  return section;
}

function closeModal() { modal.classList.add('hidden'); }
modalClose.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeProfileModal(); closeImageViewer(); }
});

// ---- Profile modal ----
// profileEventCache のキャッシュ上限（pubkey 数）
const PROFILE_EVENT_CACHE_MAX = 50;

function openProfileModal(pubkey) {
  // 同じプロフィールが既に表示中なら再フェッチしない
  const alreadyOpen = !profileModal.classList.contains('hidden') && profileCurrentPubkey === pubkey;

  const profile = profileCache.get(pubkey) || {};
  const name = profile.display_name || profile.name || shortPubkey(pubkey);
  const handle = profile.name ? `@${profile.name.split('@')[0]}` : shortPubkey(pubkey);

  profileModalBody.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'profile-modal-header';

  const av = avatarWithBadge(pubkey, profile.picture);
  av.querySelector('.avatar')?.classList.add('avatar-lg');
  header.appendChild(av);

  const info = document.createElement('div');
  info.className = 'profile-modal-info';
  info.innerHTML = `
    <div class="profile-name">${escHtml(name)}</div>
    <div class="profile-handle">${escHtml(handle)}</div>
    ${profile.about ? `<div class="profile-about">${escHtml(profile.about)}</div>` : ''}
    <div class="profile-pubkey">${escHtml(pubkey.slice(0, 16))}...${escHtml(pubkey.slice(-8))}</div>
  `;
  if (profile.nip05 && !nip05Cache.has(pubkey)) verifyNip05(pubkey, profile.nip05);

  // URL links
  const links = document.createElement('div');
  links.className = 'profile-links';
  if (profile.website) {
    const url = /^https?:\/\//.test(profile.website) ? profile.website : `https://${profile.website}`;
    const a = document.createElement('a');
    a.className = 'profile-link';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = `🔗 ${profile.website.replace(/^https?:\/\//, '')}`;
    links.appendChild(a);
  }
  if (profile.lud16) {
    const a = document.createElement('a');
    a.className = 'profile-link profile-link-lightning';
    a.href = `lightning:${profile.lud16}`;
    a.title = 'Lightning Address';
    a.textContent = `⚡ ${profile.lud16}`;
    links.appendChild(a);
  } else if (profile.lud06) {
    const a = document.createElement('a');
    a.className = 'profile-link profile-link-lightning';
    a.href = `lightning:${profile.lud06}`;
    a.title = 'LNURL';
    a.textContent = `⚡ LNURL`;
    links.appendChild(a);
  }
  if (links.childElementCount > 0) info.appendChild(links);
  header.appendChild(info);
  profileModalBody.appendChild(header);

  const postsLabel = document.createElement('div');
  postsLabel.className = 'profile-posts-label';
  postsLabel.textContent = '投稿';
  profileModalBody.appendChild(postsLabel);

  profileModalPosts.innerHTML = '';

  profileCurrentPubkey = pubkey;
  profileKindFilter = 'all';

  document.querySelectorAll('.profile-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.kind === 'all');
  });

  // profileEventCache のサイズ上限を超えたら最も古い pubkey を削除する
  if (!profileEventCache.has(pubkey) && profileEventCache.size >= PROFILE_EVENT_CACHE_MAX) {
    const oldestKey = profileEventCache.keys().next().value;
    profileEventCache.delete(oldestKey);
  }
  // Map<eventId, event> で O(1) 重複排除
  if (!profileEventCache.has(pubkey)) profileEventCache.set(pubkey, new Map());

  // タイムライン上の投稿をキャッシュに追加
  const cached = posts.filter(p => p.pubkey === pubkey);
  const evMap = profileEventCache.get(pubkey);
  for (const ev of cached) evMap.set(ev.id, ev);

  renderProfilePosts();

  if (evMap.size === 0) {
    showProfileSpinner();
  }

  profileModal.classList.remove('hidden');
  // 同一プロフィールが既に開いている場合は再フェッチ不要
  if (!alreadyOpen) fetchUserPosts(pubkey);
}

// スピナーを表示し、8秒後に自動消去する
function showProfileSpinner() {
  clearTimeout(profileLoadTimer);
  profileModalPosts.innerHTML = '<div class="profile-posts-loading"><div class="spinner"></div></div>';
  profileLoadTimer = setTimeout(() => {
    const spinner = profileModalPosts.querySelector('.profile-posts-loading');
    if (!spinner) return; // すでに投稿が表示されていれば何もしない
    const evMap = profileEventCache.get(profileCurrentPubkey);
    const hasEvents = evMap && evMap.size > 0;
    if (!hasEvents) {
      profileModalPosts.innerHTML =
        '<div class="profile-empty">投稿が見つかりませんでした</div>';
    }
  }, 8000);
}

function fetchUserPosts(pubkey) {
  clearTimeout(profileLoadTimer); // 前のタイマーをキャンセル
  if (profileSubId) {
    for (const [, conn] of connections) {
      if (conn.ws && conn.ws.readyState === WebSocket.OPEN)
        conn.ws.send(JSON.stringify(['CLOSE', profileSubId]));
    }
  }
  profileSubId = 'profile-' + Math.random().toString(36).slice(2, 8);
  const req = ['REQ', profileSubId, { kinds: [1, 6, 7], authors: [pubkey], limit: 60 }];
  for (const [, conn] of connections) {
    if (conn.ws && conn.ws.readyState === WebSocket.OPEN)
      conn.ws.send(JSON.stringify(req));
  }
}

function renderProfilePosts() {
  const all = [...(profileEventCache.get(profileCurrentPubkey) || new Map()).values()];
  const filtered = profileKindFilter === 'all' ? all : all.filter(e => String(e.kind) === profileKindFilter);
  const sorted = [...filtered].sort((a, b) => b.created_at - a.created_at);

  if (sorted.length === 0) {
    if (!profileModalPosts.querySelector('.profile-posts-loading')) {
      profileModalPosts.innerHTML = '';
    }
    return;
  }

  // スピナー・空メッセージを除去（投稿が届いた）
  profileModalPosts.querySelector('.profile-posts-loading')?.remove();
  profileModalPosts.querySelector('.profile-empty')?.remove();

  // 既存カードをマップ化（data-event-id は createPostCard 等が設定する）
  const cardMap = new Map();
  for (const el of profileModalPosts.querySelectorAll('[data-event-id]')) {
    cardMap.set(el.dataset.eventId, el);
  }
  const newIdSet = new Set(sorted.map(e => e.id));

  // フィルター変更などで不要になったカードを除去
  for (const [id, el] of cardMap) {
    if (!newIdSet.has(id)) el.remove();
  }

  // 差分更新（時系列降順を維持）
  let prevEl = null;
  for (const event of sorted) {
    let card = cardMap.get(event.id);
    if (!card) {
      card = createProfileMiniCard(event);
    } else {
      // 既存カードのリアクションと著者情報を更新
      const reactionsEl = card.querySelector('.post-reactions');
      if (reactionsEl) renderCardReactions(reactionsEl, event.id);
      refreshCardAuthor(card, event);
    }

    const expectedNext = prevEl ? prevEl.nextSibling : profileModalPosts.firstChild;
    if (card !== expectedNext) {
      if (prevEl) prevEl.after(card);
      else profileModalPosts.prepend(card);
    }
    prevEl = card;
  }
}

function createProfileMiniCard(event) {
  if (event.kind === 6) return createRepostCard(event);
  if (event.kind === 7) return createReactionCard(event);
  return createPostCard(event);
}

function handleProfileSubEvent(event) {
  if (profileModal.classList.contains('hidden')) return;
  if (event.pubkey !== profileCurrentPubkey) return;

  if (!profileEventCache.has(event.pubkey)) profileEventCache.set(event.pubkey, new Map());
  const evMap = profileEventCache.get(event.pubkey);
  if (evMap.has(event.id)) return; // O(1) 重複排除

  evMap.set(event.id, event);

  if (event.kind === 6) {
    const eTag = event.tags.find(t => t[0] === 'e') || [];
    const targetId = eTag[1];
    const targetRelayHint = eTag[2] ? [eTag[2]] : [];
    if (targetId && !eventCache.has(targetId)) fetchTargetEvent(targetId, targetRelayHint);
  }
  if (event.kind === 7) {
    const eTag = event.tags.find(t => t[0] === 'e') || [];
    const targetId = eTag[1];
    const targetRelayHint = eTag[2] ? [eTag[2]] : [];
    if (targetId && !eventCache.has(targetId)) fetchTargetEvent(targetId, targetRelayHint);
  }

  fetchProfile(event.pubkey);

  // 初回イベント受信でスピナーとタイマーを解除
  const loading = profileModalPosts.querySelector('.profile-posts-loading');
  if (loading) {
    clearTimeout(profileLoadTimer);
    profileLoadTimer = null;
    loading.remove();
  }

  scheduleRenderProfilePosts(); // 投稿は連続して届くためデバウンス
}

function closeProfileModal() {
  clearTimeout(profileLoadTimer);
  profileLoadTimer = null;
  profileModal.classList.add('hidden');
  if (profileSubId) {
    for (const [, conn] of connections) {
      if (conn.ws && conn.ws.readyState === WebSocket.OPEN)
        conn.ws.send(JSON.stringify(['CLOSE', profileSubId]));
    }
    profileSubId = null;
  }
}

profileModalClose.addEventListener('click', closeProfileModal);
profileModalBackdrop.addEventListener('click', closeProfileModal);

document.getElementById('profileTabs').addEventListener('click', e => {
  const btn = e.target.closest('.profile-tab');
  if (!btn) return;
  document.querySelectorAll('.profile-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  profileKindFilter = btn.dataset.kind;
  renderProfilePosts();
});

// ---- Image viewer ----
function openImageViewer(url) {
  const viewer = document.getElementById('imageViewer');
  const img = document.getElementById('imageViewerImg');
  img.src = url;
  viewer.classList.remove('hidden');
}

function closeImageViewer() {
  document.getElementById('imageViewer').classList.add('hidden');
}

document.getElementById('imageViewerClose').addEventListener('click', closeImageViewer);
document.getElementById('imageViewerBackdrop').addEventListener('click', closeImageViewer);

// ---- New posts banner ----
// ---- フォロー変更トースト通知 ----
let _followToastTimer = null;
function showFollowChangeToast(addedCount, removedCount) {
  let existing = document.getElementById('followChangeToast');
  if (!existing) {
    existing = document.createElement('div');
    existing.id = 'followChangeToast';
    existing.className = 'follow-change-toast';
    document.body.appendChild(existing);
  }
  const parts = [];
  if (addedCount > 0)   parts.push(`+${addedCount}件フォロー`);
  if (removedCount > 0) parts.push(`−${removedCount}件フォロー解除`);
  existing.textContent = `フォロー中リストが更新されました（${parts.join('・')}）`;
  existing.classList.add('visible');
  clearTimeout(_followToastTimer);
  _followToastTimer = setTimeout(() => existing.classList.remove('visible'), 4000);
}

function showNewPostsBanner() {
  const count = pendingPosts.length;
  newPostsBannerEl.textContent = `↑ ${count}件の新着`;
  newPostsBannerEl.classList.remove('hidden');
}

function hideNewPostsBanner() {
  newPostsBannerEl.classList.add('hidden');
}

function flushPendingPosts() {
  if (pendingPosts.length === 0) return;
  for (const e of pendingPosts) posts.push(e);
  pendingPosts = [];
  posts.sort((a, b) => b.created_at - a.created_at);
  const limit = parseInt(limitSelect.value, 10);
  if (posts.length > limit * 2) posts = posts.slice(0, limit * 2);
  hideNewPostsBanner();
  renderPosts();
}

newPostsBannerEl.addEventListener('click', () => {
  flushPendingPosts();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

window.addEventListener('scroll', () => {
  if (window.scrollY <= 100 && pendingPosts.length > 0) flushPendingPosts();
}, { passive: true });

// ---- Infinite scroll ----
function fetchOlderPosts() {
  if (loadingOlder || followedPubkeys.size === 0 || posts.length === 0) return;
  loadingOlder = true;
  olderSubId = 'older-' + Math.random().toString(36).slice(2, 8);
  olderEoseExpected = 0;
  olderEoseReceived = 0;
  // kind=7 リアクションは古い投稿への反応で古い timestamp を持つ場合があり、
  // それを使うと pagination の境界がずれて kind=1/6 の投稿が抜ける。
  const feedPosts = posts.filter(p => p.kind === 1 || p.kind === 6);
  const oldestTs = feedPosts.length > 0
    ? Math.min(...feedPosts.map(p => p.created_at))
    : Math.min(...posts.map(p => p.created_at));
  const limit = parseInt(limitSelect.value, 10);
  bottomLoadingEl.classList.remove('hidden');
  for (const [, conn] of connections) {
    if (conn.ws?.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify(['REQ', olderSubId, {
        kinds: [1, 6, 7],
        authors: [...followedPubkeys],
        until: oldestTs,
        limit,
      }]));
      olderEoseExpected++;
    }
  }
  if (olderEoseExpected === 0) {
    loadingOlder = false;
    olderSubId = null;
    bottomLoadingEl.classList.add('hidden');
  }
}

const bottomObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) fetchOlderPosts();
  }
}, { rootMargin: '200px 0px' });
bottomObserver.observe(feedBottomSentinel);

// ---- Controls ----
function doRefresh() {
  if (!mainSubId || followedPubkeys.size === 0) return;
  pendingPosts = [];
  olderPostsBuffer = [];
  loadingOlder = false;
  olderSubId = null;
  olderEoseExpected = 0;
  olderEoseReceived = 0;
  hideNewPostsBanner();
  posts = [];
  seenEvents.clear();
  reactionMap.clear();
  replyMap.clear();
  mainSubId = 'feed-' + Math.random().toString(36).slice(2, 8);
  loadingEl.classList.remove('hidden');
  loadingText.textContent = 'フォロー中のユーザーの投稿を取得中...';
  postListEl.innerHTML = '';
  postCountEl.textContent = '0件';
  for (const [, conn] of connections) {
    if (conn.ws && conn.ws.readyState === WebSocket.OPEN) sendMainSub(conn.ws);
  }
}

searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') applySearch(); });
searchBtn.addEventListener('click', applySearch);

function setAuthorFilter(pubkey) {
  authorFilter = pubkey;
  renderPosts();
}

function clearAuthorFilter() {
  authorFilter = null;
  renderPosts();
}

function updateAuthorFilterBanner() {
  if (!authorFilter) {
    authorFilterBanner.classList.add('hidden');
    authorFilterBanner.innerHTML = '';
    return;
  }
  const profile = profileCache.get(authorFilter) || {};
  const name = profile.display_name || profile.name || shortPubkey(authorFilter);
  authorFilterBanner.classList.remove('hidden');
  authorFilterBanner.innerHTML = '';
  const av = avatarWithBadge(authorFilter, profile.picture);
  av.querySelector('.avatar')?.classList.add('avatar-xs');
  authorFilterBanner.appendChild(av);
  const label = document.createElement('span');
  label.textContent = `${name} の投稿のみ表示中`;
  authorFilterBanner.appendChild(label);
  const clear = document.createElement('button');
  clear.className = 'author-filter-clear';
  clear.textContent = '✕ 解除';
  clear.addEventListener('click', clearAuthorFilter);
  authorFilterBanner.appendChild(clear);
}

function applySearch(query) {
  const q = query ?? searchInput.value.trim();
  searchQuery = q;
  searchInput.value = q;
  headerSearchInput.value = q;
  searchClearBtn.classList.toggle('hidden', !q);
  headerSearchClearBtn.classList.toggle('hidden', !q);
  renderPosts();
}

function clearSearch() {
  applySearch('');
}

searchClearBtn.addEventListener('click', e => { e.stopPropagation(); clearSearch(); });
headerSearchClearBtn.addEventListener('click', e => { e.stopPropagation(); clearSearch(); });

function buildMentionEl(pubkey) {
  const span = document.createElement('span');
  span.className = 'mention-tag';
  span.addEventListener('click', e => { e.stopPropagation(); openProfileModal(pubkey); });

  function fill(profile) {
    span.innerHTML = '';
    const av = avatarWithBadge(pubkey, profile?.picture);
    av.querySelector('.avatar')?.classList.add('avatar-xs');
    span.appendChild(av);
    const name = profile?.display_name || profile?.name || shortPubkey(pubkey);
    const nameEl = document.createElement('span');
    nameEl.className = 'mention-name';
    nameEl.textContent = `@${name.split('@')[0]}`;
    span.appendChild(nameEl);
  }

  const cached = profileCache.get(pubkey);
  if (cached) {
    fill(cached);
  } else {
    fill(null);
    if (!mentionCallbacks.has(pubkey)) mentionCallbacks.set(pubkey, new Set());
    mentionCallbacks.get(pubkey).add(fill);
    fetchProfile(pubkey);
  }
  return span;
}

function renderTextWithTags(container, text) {
  const parts = text.split(/(#[^\s#]+|nostr:(?:nprofile1|npub1)[a-z0-9]+)/gi);
  for (const part of parts) {
    if (part.startsWith('#') && part.length > 1) {
      const tag = document.createElement('span');
      tag.className = 'hashtag-link';
      tag.textContent = part;
      tag.addEventListener('click', e => { e.stopPropagation(); applySearch(part); });
      container.appendChild(tag);
    } else if (/^nostr:(?:nprofile1|npub1)/i.test(part)) {
      try {
        const pubkey = decodeMentionPubkey(part);
        container.appendChild(buildMentionEl(pubkey));
      } catch (_) {
        container.appendChild(document.createTextNode(part));
      }
    } else {
      container.appendChild(document.createTextNode(part));
    }
  }
}

document.querySelectorAll('.kind-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.kind-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll(`.kind-btn[data-kind="${btn.dataset.kind}"]`).forEach(b => b.classList.add('active'));
    kindFilter = btn.dataset.kind;
    localStorage.setItem('nostr_kind_filter', kindFilter);
    renderPosts();
  });
});

// ---- Sidebar drag and drop ----
function initSidebarDnd() {
  const sidebar = document.querySelector('.sidebar-panels');

  const saved = (() => { try { return JSON.parse(localStorage.getItem('sidebar_order')); } catch (_) { return null; } })();
  if (Array.isArray(saved)) {
    saved.forEach(id => {
      const el = sidebar.querySelector(`[data-panel="${id}"]`);
      if (el) sidebar.appendChild(el);
    });
  }

  let dragged = null;

  sidebar.addEventListener('dragstart', e => {
    const section = e.target.closest('section[data-panel]');
    if (!section) return;
    dragged = section;
    section.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  sidebar.addEventListener('dragend', () => {
    if (dragged) dragged.classList.remove('dragging');
    sidebar.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    dragged = null;
    saveSidebarOrder(sidebar);
  });

  sidebar.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.target.closest('section[data-panel]');
    sidebar.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    if (target && target !== dragged) target.classList.add('drag-over');
  });

  sidebar.addEventListener('dragleave', e => {
    const target = e.target.closest('section[data-panel]');
    if (target) target.classList.remove('drag-over');
  });

  sidebar.addEventListener('drop', e => {
    e.preventDefault();
    const target = e.target.closest('section[data-panel]');
    if (!target || target === dragged) return;
    target.classList.remove('drag-over');
    const sections = [...sidebar.querySelectorAll('section[data-panel]')];
    const fromIdx = sections.indexOf(dragged);
    const toIdx = sections.indexOf(target);
    if (fromIdx < toIdx) target.after(dragged);
    else target.before(dragged);
  });

  sidebar.querySelectorAll('section[data-panel]').forEach(section => {
    section.draggable = false;
    section.querySelector('.drag-handle')?.addEventListener('mousedown', () => {
      section.draggable = true;
    });
    section.addEventListener('dragend', () => {
      section.draggable = false;
    });
  });
}

function saveSidebarOrder(sidebar) {
  const order = [...sidebar.querySelectorAll('section[data-panel]')].map(el => el.dataset.panel);
  localStorage.setItem('sidebar_order', JSON.stringify(order));
}

// ---- Mobile: header search ----
headerSearchInput.addEventListener('input', () => {
  searchQuery = headerSearchInput.value.trim();
  searchInput.value = searchQuery;
  headerSearchClearBtn.classList.toggle('hidden', !searchQuery);
  searchClearBtn.classList.toggle('hidden', !searchQuery);
  renderPosts();
});
headerSearchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') renderPosts();
});

searchInput.addEventListener('input', () => {
  headerSearchInput.value = searchInput.value;
  const q = searchInput.value.trim();
  searchClearBtn.classList.toggle('hidden', !q);
  headerSearchClearBtn.classList.toggle('hidden', !q);
});

// ---- Mobile: hamburger drawer ----
function openDrawer() {
  const profile = profileCache.get(currentUserHex) || {};
  const name = profile.display_name || profile.name || (currentUserHex ? shortPubkey(currentUserHex) : '');
  drawerUserName.textContent = name;
  const drawerAbout = document.getElementById('drawerUserAbout');
  drawerAbout.textContent = profile.about || '';
  drawerAvatarWrap.innerHTML = '';
  if (currentUserHex) {
    const av = avatarWithBadge(currentUserHex, profile.picture);
    av.querySelector('.avatar')?.classList.add('avatar-sm');
    drawerAvatarWrap.appendChild(av);
  }

  drawerRanking.innerHTML = rankingListEl.innerHTML;
  drawerRanking.querySelectorAll('.ranking-item').forEach((item, i) => {
    const orig = rankingListEl.querySelectorAll('.ranking-item')[i];
    if (orig) item.addEventListener('click', () => { closeDrawer(); orig.click(); });
  });

  drawer.classList.remove('hidden');
}
function closeDrawer() { drawer.classList.add('hidden'); }

hamburgerBtn.addEventListener('click', openDrawer);
drawerClose.addEventListener('click', closeDrawer);
drawerBackdrop.addEventListener('click', closeDrawer);
drawerSettingsBtn.addEventListener('click', () => { closeDrawer(); openSettings(); });
drawerLogout.addEventListener('click', () => { closeDrawer(); logoutBtn.click(); });

// ---- Mobile: swipe gestures for drawer ----
(function initSwipeGestures() {
  let startX = 0;
  let startY = 0;

  document.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (e.target.closest('input, textarea, select')) return;
    if (!modal.classList.contains('hidden')) return;
    if (!profileModal.classList.contains('hidden')) return;
    if (!settingsModal.classList.contains('hidden')) return;

    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;

    if (Math.abs(dy) > Math.abs(dx) * 0.8) return;
    if (Math.abs(dx) < 50) return;

    if (dx < 0 && drawer.classList.contains('hidden') && currentUserHex) {
      openDrawer();
    } else if (dx > 0 && !drawer.classList.contains('hidden')) {
      closeDrawer();
    }
  }, { passive: true });
})();

// ---- Mobile: bottom filter bar ----
document.querySelectorAll('.mobile-kind-filter .kind-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.kind-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll(`.kind-btn[data-kind="${btn.dataset.kind}"]`)
      .forEach(b => b.classList.add('active'));
    kindFilter = btn.dataset.kind;
    renderPosts();
  });
});

mobileRefreshBtn.addEventListener('click', () => { doRefresh(); });

function showMobileUI() { mobileFilterBar.classList.remove('hidden'); }
function hideMobileUI() { mobileFilterBar.classList.add('hidden'); }

// ---- Theme toggle ----
function applyTheme(light) {
  document.documentElement.classList.toggle('light', light);
  const thumb = document.querySelector('.theme-toggle-thumb');
  const label = document.getElementById('themeToggleLabel');
  if (thumb) thumb.style.transform = light ? 'translateX(18px)' : '';
  if (label) label.textContent = light ? 'OFF' : 'ON';
}

// ---- Settings modal ----
function openSettings() { settingsModal.classList.remove('hidden'); }
function closeSettings() { settingsModal.classList.add('hidden'); }

settingsBtn.addEventListener('click', openSettings);
settingsModalClose.addEventListener('click', closeSettings);
settingsModalBackdrop.addEventListener('click', closeSettings);

themeToggle.addEventListener('click', () => {
  const isLight = !document.documentElement.classList.contains('light');
  applyTheme(isLight);
  localStorage.setItem('nostr_theme', isLight ? 'light' : 'dark');
});

// ---- Font size ----
const FONT_SIZE_DEFAULT = 14;
const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 24;

function applyFontSize(px) {
  // <style>タグ経由で直接ルールを書き込む
  // CSS変数だけだとモバイルブラウザで再計算がトリガーされないことがあるため
  let styleEl = document.getElementById('nostr-font-size-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'nostr-font-size-style';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `body { font-size: ${px}px; } .post-body { font-size: ${px}px; }`;
  // CSS変数も更新しておく（他のvar()参照やfallback用）
  document.documentElement.style.setProperty('--font-size-base', px + 'px');
  fontSizeInput.value = px;
}

function clampFontSize(v) {
  return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, v));
}

fontSizeInput.addEventListener('change', () => {
  const v = clampFontSize(parseInt(fontSizeInput.value, 10) || FONT_SIZE_DEFAULT);
  applyFontSize(v);
  localStorage.setItem('nostr_font_size', v);
});

fontSizeDownBtn.addEventListener('click', () => {
  const v = clampFontSize((parseInt(fontSizeInput.value, 10) || FONT_SIZE_DEFAULT) - 1);
  applyFontSize(v);
  localStorage.setItem('nostr_font_size', v);
});

fontSizeUpBtn.addEventListener('click', () => {
  const v = clampFontSize((parseInt(fontSizeInput.value, 10) || FONT_SIZE_DEFAULT) + 1);
  applyFontSize(v);
  localStorage.setItem('nostr_font_size', v);
});

// ---- Idle disconnect ----
idleTimeoutSelect.value = String(idleMinutes);
idleTimeoutSelect.addEventListener('change', () => {
  idleMinutes = parseInt(idleTimeoutSelect.value, 10);
  localStorage.setItem('nostr_idle_timeout', idleMinutes);
  resetIdleTimer();
});

function disconnectAllRelays() {
  isIdleDisconnected = true; // close イベントより先にフラグを立てる
  for (const [, conn] of connections) {
    try { conn.ws.close(); } catch (_) {}
  }
  connections.clear();
  isIdleDisconnected = true;
  updateRelayStatus();
  idleStatusEl.textContent = '無操作のため切断中。操作すると再接続します。';
}

function reconnectIfIdle() {
  if (!isIdleDisconnected || !currentUserHex) return;
  isIdleDisconnected = false;
  idleStatusEl.textContent = '';
  connectAllRelays();
}

function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleStatusEl.textContent = '';
  if (!idleMinutes || !currentUserHex) return;
  if (isIdleDisconnected) reconnectIfIdle();
  idleTimer = setTimeout(() => {
    if (currentUserHex) disconnectAllRelays();
  }, idleMinutes * 60 * 1000);
}

['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(ev => {
  document.addEventListener(ev, resetIdleTimer, { passive: true });
});

// ---- Boot ----
function init() {
  applyTheme(localStorage.getItem('nostr_theme') === 'light');
  const savedFontSize = parseInt(localStorage.getItem('nostr_font_size'), 10);
  applyFontSize(!isNaN(savedFontSize) ? clampFontSize(savedFontSize) : FONT_SIZE_DEFAULT);
  document.querySelectorAll('.kind-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`.kind-btn[data-kind="${kindFilter}"]`).forEach(b => b.classList.add('active'));
  initSidebarDnd();

  const verEl = document.getElementById('sidebarVersion');
  if (verEl) {
    const version = typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'dev';
    const updated = typeof APP_UPDATED !== 'undefined' ? ` · ${APP_UPDATED}` : '';
    verEl.innerHTML = `<span>Nostr/o</span><span>v${version}${updated}</span>`;
  }
  const saved = localStorage.getItem('nostr_pubkey');
  if (saved) {
    loginInput.value = saved;
    doLogin();
  }
}

// ---- Relative time updater ----
var timeUpdaterInterval = null;

function startTimeUpdater() {
  if (timeUpdaterInterval) return;
  timeUpdaterInterval = setInterval(() => {
    for (const el of document.querySelectorAll('.post-time[data-ts]')) {
      const ts = parseInt(el.dataset.ts, 10);
      el.textContent = `${timeAgo(ts)} · ${formatDate(ts)}`;
    }
  }, 30_000);
}

function stopTimeUpdater() {
  clearInterval(timeUpdaterInterval);
  timeUpdaterInterval = null;
}

init();
