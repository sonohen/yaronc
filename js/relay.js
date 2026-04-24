'use strict';

// ---- Relay connection ----
function renderRelayList() {
  relayListEl.innerHTML = '';
  for (const url of activeRelays) {
    const conn = connections.get(url);
    const status = conn ? conn.status : 'connecting';
    const li = document.createElement('li');
    li.className = `relay-item ${status}`;
    li.dataset.url = url;

    const dot = document.createElement('span');
    dot.className = 'dot';

    const label = document.createElement('span');
    label.className = 'url';
    label.textContent = url.replace('wss://', '');
    label.title = url;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove-relay';
    removeBtn.textContent = '✕';
    removeBtn.title = 'リレーを削除';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeRelay(url);
    });

    li.appendChild(dot);
    li.appendChild(label);
    li.appendChild(removeBtn);
    relayListEl.appendChild(li);
  }
}

function updateRelayStatus(url, status) {
  const item = relayListEl.querySelector(`[data-url="${url}"]`);
  if (item) item.className = `relay-item ${status}`;
  const conn = connections.get(url);
  if (conn) conn.status = status;

  const statuses = [...connections.values()].map(c => c.status);
  if (statuses.some(s => s === 'ok')) {
    statusDot.className = 'status-dot connected';
    statusText.textContent = `${statuses.filter(s => s === 'ok').length}/${activeRelays.length} リレー接続中`;
  } else if (statuses.some(s => s === 'connecting')) {
    statusDot.className = 'status-dot connecting';
    statusText.textContent = '接続中...';
  } else {
    statusDot.className = 'status-dot error';
    statusText.textContent = '接続失敗';
  }
}

function connectAllRelays() {
  renderRelayList();
  for (const url of activeRelays) connectRelay(url);
}

function connectRelay(url) {
  if (!currentUserHex) return;

  const existing = connections.get(url);
  if (existing && existing.ws && existing.ws.readyState <= 1) return;

  connections.set(url, { ws: null, status: 'connecting' });
  renderRelayList();

  const ws = new WebSocket(url);
  connections.get(url).ws = ws;

  ws.addEventListener('open', () => {
    updateRelayStatus(url, 'ok');
    if (mainSubId && followedPubkeys.size > 0) sendMainSub(ws);
    if (profileSubId && !profileModal.classList.contains('hidden') && profileCurrentPubkey) {
      const req = ['REQ', profileSubId, { kinds: [1, 6, 7], authors: [profileCurrentPubkey], limit: 60 }];
      ws.send(JSON.stringify(req));
    }
  });

  ws.addEventListener('message', e => {
    try { handleMessage(JSON.parse(e.data)); } catch (_) {}
  });

  ws.addEventListener('error', () => updateRelayStatus(url, 'error'));
  ws.addEventListener('close', () => {
    updateRelayStatus(url, 'error');
    if (loadingOlder) {
      const anyOpen = [...connections.values()].some(c => c.ws && c.ws.readyState === WebSocket.OPEN);
      if (!anyOpen) {
        loadingOlder = false;
        olderSubId = null;
        bottomLoadingEl.classList.add('hidden');
      }
    }
    if (currentUserHex && activeRelays.includes(url)) setTimeout(() => connectRelay(url), 10000);
  });
}

// HTTPS ページから ws:// への接続はブラウザにブロックされるため wss:// に昇格する
function upgradeWsUrl(url) {
  if (location.protocol === 'https:' && url.startsWith('ws://')) {
    return 'wss://' + url.slice(5);
  }
  return url;
}

function addRelay(url) {
  url = upgradeWsUrl(url.trim());
  const relayAddError = document.getElementById('relayAddError');

  if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
    relayAddError.textContent = 'wss:// または ws:// で始まるURLを入力してください';
    relayAddError.classList.remove('hidden');
    return;
  }
  if (activeRelays.includes(url)) {
    relayAddError.textContent = 'すでに追加されています';
    relayAddError.classList.remove('hidden');
    return;
  }
  relayAddError.classList.add('hidden');
  activeRelays.push(url);
  saveRelays();
  connectRelay(url);
  renderRelayList();
}

function removeRelay(url) {
  activeRelays = activeRelays.filter(r => r !== url);
  saveRelays();
  const conn = connections.get(url);
  if (conn && conn.ws) {
    conn.ws.onclose = null;
    conn.ws.close();
  }
  connections.delete(url);
  renderRelayList();
  updateRelayStatus(url, '');
}

// ---- Contact list (kind:3) ----
const CONTACT_SUB = 'contacts-fetch';

function fetchContactList(pubkey, retries = 0) {
  const MAX_RETRIES = 15; // 最大 15 × 800ms ≒ 12秒
  const req = ['REQ', CONTACT_SUB, { kinds: [3], authors: [pubkey], limit: 1 }];
  let sent = false;
  for (const [, conn] of connections) {
    if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify(req));
      sent = true;
    }
  }
  if (!sent) {
    if (retries < MAX_RETRIES) {
      setTimeout(() => fetchContactList(pubkey, retries + 1), 800);
    } else {
      // タイムアウト：フォローリストなしとして扱う
      loadingEl.classList.add('hidden');
      postListEl.innerHTML = '<div class="empty-state"><h3>接続できませんでした</h3><p>リレーに接続できません。ページを再読み込みしてください。</p></div>';
    }
  }
}

function handleContactEvent(event) {
  const keys = event.tags
    .filter(t => t[0] === 'p' && t[1] && /^[0-9a-f]{64}$/.test(t[1]))
    .map(t => t[1]);

  followedPubkeys = new Set(keys);
  followedPubkeys.add(currentUserHex);

  for (const [, conn] of connections) {
    if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify(['CLOSE', CONTACT_SUB]));
    }
  }

  fetchProfileImmediate(currentUserHex);
  startMainFeed();
}

// ---- Main feed subscription ----
function startMainFeed() {
  mainSubId = 'feed-' + Math.random().toString(36).slice(2, 8);
  loadingText.textContent = 'フォロー中のユーザーの投稿を取得中...';

  for (const [, conn] of connections) {
    if (conn.ws && conn.ws.readyState === WebSocket.OPEN) sendMainSub(conn.ws);
  }
}

function sendMainSub(ws) {
  if (followedPubkeys.size === 0) return;
  const limit = parseInt(limitSelect.value, 10);
  ws.send(JSON.stringify(['REQ', mainSubId, {
    kinds: [1, 6, 7],
    authors: [...followedPubkeys],
    limit,
  }]));
}

// ---- Message handler ----
function handleMessage(msg) {
  if (!Array.isArray(msg)) return;
  const [type, subId, event] = msg;

  if (type === 'EVENT') {
    if (!event) return;
    // 悪意あるリレーからの不正なフィールドを弾く
    if (typeof event.id !== 'string' || !/^[0-9a-f]{64}$/.test(event.id)) return;
    if (typeof event.pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(event.pubkey)) return;
    if (typeof event.kind !== 'number') return;
    if (typeof event.content !== 'string') return;
    if (typeof event.created_at !== 'number') return;
    if (!Array.isArray(event.tags)) return;

    // targets- サブスクはseenEventsより先に処理する
    // （メインフィードで既に受信済みのイベントでもpendingTargetCardsを解決する必要があるため）
    if (subId.startsWith('targets-') && event.kind === 1) {
      if (!eventCache.has(event.id)) {
        eventCache.set(event.id, event);
        fetchProfile(event.pubkey);
      }
      const waiting = pendingTargetCards.get(event.id);
      if (waiting) {
        for (const el of waiting) {
          if (el._fill) el._fill(el, event);
          else fillReactionPreview(el, event);
        }
        pendingTargetCards.delete(event.id);
      }
      if (seenEvents.has(event.id)) return;
      seenEvents.add(event.id);
      return;
    }

    if (seenEvents.has(event.id)) return;
    seenEvents.add(event.id);

    if (event.kind === 0) {
      try {
        const meta = JSON.parse(event.content);
        profileCache.set(event.pubkey, meta);
        saveProfileCache();
        if (meta.nip05) verifyNip05(event.pubkey, meta.nip05);
        const cbs = mentionCallbacks.get(event.pubkey);
        if (cbs) { cbs.forEach(fn => fn(meta)); mentionCallbacks.delete(event.pubkey); }
        renderPosts();
        updateHeaderProfile();
      } catch (_) {}
      return;
    }

    if (event.kind === 3 && event.pubkey === currentUserHex) {
      handleContactEvent(event);
      return;
    }

    if ((event.kind === 1 || event.kind === 6 || event.kind === 7) && subId === mainSubId) {
      if (event.kind === 6) {
        const targetId = (event.tags.find(t => t[0] === 'e') || [])[1];
        if (event.content) {
          try {
            const orig = JSON.parse(event.content);
            if (orig && orig.id) {
              eventCache.set(orig.id, orig);
              fetchProfile(orig.pubkey);
            }
          } catch (_) {}
        }
        if (targetId && !eventCache.has(targetId)) fetchTargetEvent(targetId);
      }
      if (event.kind === 7) {
        addToReactionMap(event);
        const targetId = (event.tags.find(t => t[0] === 'e') || [])[1];
        if (targetId) updateCardReactionsInPlace(targetId);
      }
      fetchProfile(event.pubkey);
      loadingEl.classList.add('hidden');

      const isScrolledDown = window.scrollY > 200;
      if (isScrolledDown && event.kind !== 7) {
        pendingPosts.push(event);
        showNewPostsBanner();
      } else {
        posts.push(event);
        posts.sort((a, b) => b.created_at - a.created_at);
        const limit = parseInt(limitSelect.value, 10);
        if (posts.length > limit * 2) posts = posts.slice(0, limit * 2);
        renderPosts();
      }
    }

    // Older posts fetched via until filter
    if ((event.kind === 1 || event.kind === 6 || event.kind === 7) && subId === olderSubId) {
      if (event.kind === 6 && event.content) {
        try {
          const orig = JSON.parse(event.content);
          if (orig && orig.id) { eventCache.set(orig.id, orig); fetchProfile(orig.pubkey); }
        } catch (_) {}
      }
      if (event.kind === 7) addToReactionMap(event);
      fetchProfile(event.pubkey);
      olderPostsBuffer.push(event);
    }

    // Replies fetched via #e filter
    if (event.kind === 1 && subId.startsWith('replies-')) {
      const eTags = event.tags.filter(t => t[0] === 'e');
      if (eTags.length > 0) addReply(event);
    }

    // targets- イベントは上部で処理済みのためここには到達しない

    if ([1, 6, 7].includes(event.kind) && profileSubId && subId === profileSubId) {
      handleProfileSubEvent(event);
    }
  }

  if (type === 'EOSE' && subId === CONTACT_SUB) {
    if (followedPubkeys.size === 0) {
      loadingEl.classList.add('hidden');
      postListEl.innerHTML = '<div class="empty-state"><h3>フォローリストがありません</h3><p>このアカウントにはフォローリストが見つかりませんでした</p></div>';
    }
  }

  if (type === 'EOSE' && subId === olderSubId) {
    loadingOlder = false;
    bottomLoadingEl.classList.add('hidden');
    if (olderPostsBuffer.length > 0) {
      for (const e of olderPostsBuffer) posts.push(e);
      olderPostsBuffer = [];
      posts.sort((a, b) => b.created_at - a.created_at);
      renderPosts();
    }
    olderSubId = null;
  }
}

// ---- NIP-05 verification ----
async function verifyNip05(pubkey, identifier) {
  if (nip05Cache.has(pubkey)) return;
  nip05Cache.set(pubkey, 'pending');

  const [name, domain] = identifier.split('@');
  if (!name || !domain) { nip05Cache.set(pubkey, 'failed'); return; }

  try {
    const res = await fetch(
      `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) throw new Error();
    const json = await res.json();
    const verified = json?.names?.[name]?.toLowerCase() === pubkey.toLowerCase();
    nip05Cache.set(pubkey, verified ? { verified: true, identifier } : 'failed');
    if (verified) saveNip05Cache();
  } catch (_) {
    nip05Cache.set(pubkey, 'failed');
  }

  renderPosts();
  updateHeaderProfile();
  if (!profileModal.classList.contains('hidden')) renderProfilePosts();
}

function nip05Badge(pubkey) {
  const state = nip05Cache.get(pubkey);
  if (!state || state === 'pending' || state === 'failed') return null;
  const [, domain] = state.identifier.split('@');
  const badge = document.createElement('span');
  badge.className = 'nip05-badge';
  badge.title = `NIP-05 認証済み: ${state.identifier}`;
  badge.textContent = '✓';
  return badge;
}

// ---- Profile fetching ----
const pendingProfiles = new Set();
let profileFetchTimer = null;

function fetchProfile(pubkey) {
  if (profileCache.has(pubkey)) {
    const cached = profileCache.get(pubkey);
    if (cached?.nip05) verifyNip05(pubkey, cached.nip05);
    return;
  }
  pendingProfiles.add(pubkey);
  clearTimeout(profileFetchTimer);
  profileFetchTimer = setTimeout(() => {
    const keys = [...pendingProfiles].slice(0, 50);
    pendingProfiles.clear();
    const req = ['REQ', 'profiles-' + Math.random().toString(36).slice(2, 8), { kinds: [0], authors: keys }];
    for (const [, conn] of connections) {
      if (conn.ws && conn.ws.readyState === WebSocket.OPEN) { conn.ws.send(JSON.stringify(req)); break; }
    }
  }, 500);
}

function fetchProfileImmediate(pubkey) {
  const req = ['REQ', 'self-profile', { kinds: [0], authors: [pubkey], limit: 1 }];
  for (const [, conn] of connections) {
    if (conn.ws && conn.ws.readyState === WebSocket.OPEN) { conn.ws.send(JSON.stringify(req)); break; }
  }
}

function updateHeaderProfile() {
  const profile = profileCache.get(currentUserHex);
  if (!profile) return;
  const name = profile.display_name || profile.name || shortPubkey(currentUserHex);
  headerName.textContent = name;
  headerName.style.cursor = 'pointer';
  headerName.onclick = () => openProfileModal(currentUserHex);
  headerAvatar.innerHTML = '';
  const wrap = avatarWithBadge(currentUserHex, profile.picture);
  wrap.querySelector('.avatar')?.classList.add('avatar-sm');
  wrap.style.cursor = 'pointer';
  wrap.addEventListener('click', () => openProfileModal(currentUserHex));
  headerAvatar.appendChild(wrap);
}

// ---- Reply fetching ----
const pendingReplyFetches = new Set();
let replyFetchTimer = null;

function scheduleReplyFetch(eventIds) {
  for (const id of eventIds) pendingReplyFetches.add(id);
  clearTimeout(replyFetchTimer);
  replyFetchTimer = setTimeout(() => {
    const ids = [...pendingReplyFetches].slice(0, 100);
    pendingReplyFetches.clear();
    const subId = 'replies-' + Math.random().toString(36).slice(2, 8);
    const req = ['REQ', subId, { kinds: [1], '#e': ids, limit: 200 }];
    for (const [, conn] of connections) {
      if (conn.ws && conn.ws.readyState === WebSocket.OPEN)
        conn.ws.send(JSON.stringify(req));
    }
  }, 600);
}

function getReplyParentId(event) {
  const eTags = event.tags.filter(t => t[0] === 'e');
  const replyTag = eTags.find(t => t[3] === 'reply') || eTags.find(t => t[3] === 'root');
  return (replyTag || eTags[eTags.length - 1])?.[1] || null;
}

function addReply(replyEvent) {
  const parentId = getReplyParentId(replyEvent);
  if (!parentId) return;
  if (!replyMap.has(parentId)) replyMap.set(parentId, []);
  const arr = replyMap.get(parentId);
  if (arr.find(e => e.id === replyEvent.id)) return;
  arr.push(replyEvent);
  arr.sort((a, b) => a.created_at - b.created_at);
  fetchProfile(replyEvent.pubkey);
  updateCardRepliesInPlace(parentId);
}

function updateCardRepliesInPlace(parentId) {
  const card = postListEl.querySelector(`.post-card[data-event-id="${parentId}"]`);
  if (!card) return;
  const el = card.querySelector('.post-reply-preview');
  if (el) renderCardReplyPreview(el, parentId);
}

// ---- Target event fetching ----
const pendingTargetFetches = new Set();
let targetFetchTimer = null;

function resolveTargetCards(eventId, event) {
  const waiting = pendingTargetCards.get(eventId);
  if (!waiting) return;
  for (const el of waiting) {
    if (el._fill) el._fill(el, event);
    else fillReactionPreview(el, event);
  }
  pendingTargetCards.delete(eventId);
}

function fetchTargetEvent(eventId, relayHints = []) {
  // eventCacheにある場合は即解決
  if (eventCache.has(eventId)) {
    resolveTargetCards(eventId, eventCache.get(eventId));
    return;
  }
  // posts / pendingPosts / olderPostsBuffer にある場合も即解決（seenEventsには入っているがeventCacheにない）
  const inMemory = posts.find(p => p.id === eventId)
    || pendingPosts.find(p => p.id === eventId)
    || olderPostsBuffer.find(p => p.id === eventId);
  if (inMemory) {
    eventCache.set(eventId, inMemory);
    resolveTargetCards(eventId, inMemory);
    return;
  }
  pendingTargetFetches.add(eventId);
  clearTimeout(targetFetchTimer);
  targetFetchTimer = setTimeout(() => {
    const ids = [...pendingTargetFetches].slice(0, 50);
    pendingTargetFetches.clear();
    const subId = 'targets-' + Math.random().toString(36).slice(2, 8);
    const req = ['REQ', subId, { ids, kinds: [1] }];
    // 接続済みリレーに送信
    for (const [, conn] of connections) {
      if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(JSON.stringify(req));
      }
    }

    // 15秒後も未解決のpendingTargetCardsをタイムアウト処理
    setTimeout(() => {
      for (const id of ids) {
        const waiting = pendingTargetCards.get(id);
        if (!waiting) continue;
        for (const el of waiting) {
          el.innerHTML = '<div class="reply-quote not-found">投稿を取得できませんでした</div>';
        }
        pendingTargetCards.delete(id);
      }
    }, 15000);
    // nevent の relay hint に未接続のものがあれば一時接続して取得
    for (const rawRelayUrl of relayHints.slice(0, 2)) {
      const relayUrl = upgradeWsUrl(rawRelayUrl);
      if (activeRelays.includes(relayUrl)) continue; // 既存リレーは送信済み
      if (connections.has(relayUrl)) continue;       // 接続試行中または接続済み
      // connections に登録して重複接続を防ぐ
      connections.set(relayUrl, { ws: null, status: 'connecting', temporary: true });
      const ws = new WebSocket(relayUrl);
      connections.get(relayUrl).ws = ws;
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify(req));
      });
      ws.addEventListener('message', e => {
        try { handleMessage(JSON.parse(e.data)); } catch (_) {}
      });
      // 取得完了 or タイムアウトで閉じる（一時接続なので connections からも削除）
      const timer = setTimeout(() => ws.close(), 8000);
      ws.addEventListener('close', () => { clearTimeout(timer); connections.delete(relayUrl); });
      ws.addEventListener('error', () => { clearTimeout(timer); connections.delete(relayUrl); });
    }
  }, 300);
}
