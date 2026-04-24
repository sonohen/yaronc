'use strict';

// ---- Helpers ----
function shortPubkey(pk) { return `${pk.slice(0, 8)}...${pk.slice(-4)}`; }

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(ts) {
  const d = Math.floor(Date.now() / 1000) - ts;
  if (d < 60) return `${d}秒前`;
  if (d < 3600) return `${Math.floor(d / 60)}分前`;
  if (d < 86400) return `${Math.floor(d / 3600)}時間前`;
  return `${Math.floor(d / 86400)}日前`;
}

function formatDate(ts) { return new Date(ts * 1000).toLocaleString('ja-JP'); }

function safeUrl(url) {
  if (!url || typeof url !== 'string') return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

function avatarEl(pubkey, picture) {
  const div = document.createElement('div');
  div.className = 'avatar';
  const safePic = safeUrl(picture);
  if (safePic) {
    const img = document.createElement('img');
    img.src = safePic;
    img.loading = 'lazy';
    img.onerror = () => {
      div.innerHTML = '';
      div.textContent = pubkey.slice(0, 2).toUpperCase();
    };
    div.appendChild(img);
  } else if (!safePic) {
    div.textContent = pubkey.slice(0, 2).toUpperCase();
    const hue = parseInt(pubkey.slice(0, 4), 16) % 360;
    div.style.background = `linear-gradient(135deg, hsl(${hue},70%,55%), hsl(${(hue + 120) % 360},70%,55%))`;
  }
  return div;
}

function avatarWithBadge(pubkey, picture) {
  const wrap = document.createElement('div');
  wrap.className = 'avatar-wrap';
  wrap.appendChild(avatarEl(pubkey, picture));

  const state = nip05Cache.get(pubkey);
  if (state && state !== 'pending' && state !== 'failed') {
    const dot = document.createElement('span');
    dot.className = 'nip05-dot';
    dot.title = `NIP-05 認証済み: ${state.identifier}`;
    dot.textContent = '✓';
    wrap.appendChild(dot);
  }
  return wrap;
}

// ---- Reactions ----
function customEmojiUrl(event) {
  const m = /^:([^:]+):$/.exec(event.content);
  if (!m) return null;
  return (event.tags.find(t => t[0] === 'emoji' && t[1] === m[1]) || [])[2] || null;
}

function addToReactionMap(event) {
  const targetId = (event.tags.find(t => t[0] === 'e') || [])[1];
  if (!targetId) return;
  if (!reactionMap.has(targetId)) reactionMap.set(targetId, new Map());
  const emoji = reactionLabel(event.content);
  const url = customEmojiUrl(event);
  const m = reactionMap.get(targetId);
  const existing = m.get(emoji);
  if (existing) {
    existing.count++;
    if (event.created_at < existing.firstSeen) existing.firstSeen = event.created_at;
    if (url && !existing.url) existing.url = url;
  } else {
    m.set(emoji, { count: 1, firstSeen: event.created_at, url });
  }
}

function buildReactionMap() {
  reactionMap.clear();
  for (const ev of posts) {
    if (ev.kind === 7) addToReactionMap(ev);
  }
}

function renderCardReactions(el, eventId) {
  const m = reactionMap.get(eventId);
  el.innerHTML = '';
  if (!m || m.size === 0) return;
  for (const [emoji, { count, firstSeen, url }] of [...m.entries()].sort((a, b) => a[1].firstSeen - b[1].firstSeen)) {
    const chip = document.createElement('span');
    chip.className = 'reaction-chip';
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = emoji;
      img.className = 'reaction-chip-img';
      chip.appendChild(img);
    } else {
      chip.appendChild(document.createTextNode(emoji));
    }
    chip.appendChild(document.createTextNode(` ${count}`));
    el.appendChild(chip);
  }
}

function updateCardReactionsInPlace(targetId) {
  const card = postListEl.querySelector(`.post-card[data-event-id="${targetId}"]`);
  if (!card) return;
  const el = card.querySelector('.post-footer .post-reactions');
  if (el) renderCardReactions(el, targetId);
}

// ---- Ranking ----
function renderRanking(filtered) {
  const counts = new Map();
  for (const ev of filtered) counts.set(ev.pubkey, (counts.get(ev.pubkey) || 0) + 1);

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = sorted[0]?.[1] || 1;
  const hues = [271, 330, 190, 40, 150, 20, 260, 80];

  rankingListEl.innerHTML = '';

  if (sorted.length === 0) {
    rankingListEl.innerHTML = '<div class="ranking-empty">データなし</div>';
    return;
  }

  sorted.forEach(([pubkey, count], i) => {
    const profile = profileCache.get(pubkey) || {};
    const name = profile.display_name || profile.name || shortPubkey(pubkey);
    const pct = Math.max(4, Math.round((count / max) * 100));
    const hue = hues[i % hues.length];

    const item = document.createElement('div');
    item.className = 'ranking-item';
    if (authorFilter === pubkey) item.classList.add('ranking-item-active');
    item.addEventListener('click', () => {
      authorFilter === pubkey ? clearAuthorFilter() : setAuthorFilter(pubkey);
    });

    const meta = document.createElement('div');
    meta.className = 'ranking-meta';

    const rank = document.createElement('span');
    rank.className = 'ranking-rank';
    rank.textContent = i + 1;

    const av = avatarWithBadge(pubkey, profile.picture);
    av.querySelector('.avatar')?.classList.add('avatar-xs');

    const nameEl = document.createElement('span');
    nameEl.className = 'ranking-name';
    nameEl.title = name;
    nameEl.textContent = name;

    const countEl = document.createElement('span');
    countEl.className = 'ranking-count';
    countEl.textContent = count;

    meta.appendChild(rank);
    meta.appendChild(av);
    meta.appendChild(nameEl);
    meta.appendChild(countEl);

    const track = document.createElement('div');
    track.className = 'ranking-bar-track';
    track.innerHTML = `<div class="ranking-bar-fill" style="width:${pct}%;background:hsl(${hue},65%,55%)"></div>`;

    item.appendChild(meta);
    item.appendChild(track);
    rankingListEl.appendChild(item);
  });

  if (drawerRanking && !drawer.classList.contains('hidden')) {
    drawerRanking.innerHTML = rankingListEl.innerHTML;
  }
}

// ---- Virtual scroll ----
const virtualObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const el = entry.target;
    if (entry.isIntersecting) {
      if (el.classList.contains('v-placeholder')) vsRestore(el);
    } else {
      if (el.classList.contains('post-card') && el.dataset.eventId) vsCollapse(el);
    }
  }
}, { rootMargin: '250% 0px', threshold: 0 });

function vsCollapse(card) {
  const ph = document.createElement('div');
  ph.className = 'v-placeholder';
  ph.dataset.eventId = card.dataset.eventId;
  ph.style.height = card.offsetHeight + 'px';
  virtualObserver.unobserve(card);
  card.replaceWith(ph);
  virtualObserver.observe(ph);
}

function vsRestore(ph) {
  const event = posts.find(p => p.id === ph.dataset.eventId);
  if (!event) return;
  let card;
  if (event.kind === 6) card = createRepostCard(event);
  else if (event.kind === 7) card = createReactionCard(event);
  else card = createPostCard(event);
  virtualObserver.unobserve(ph);
  ph.replaceWith(card);
  virtualObserver.observe(card);
}

// ---- Render ----
function renderPosts() {
  buildReactionMap();
  let filtered = kindFilter === 'all' ? posts : posts.filter(p => String(p.kind) === kindFilter);
  if (searchQuery) filtered = filtered.filter(p => p.content.toLowerCase().includes(searchQuery.toLowerCase()));
  if (authorFilter) filtered = filtered.filter(p => p.pubkey === authorFilter);
  updateAuthorFilterBanner();

  postCountEl.textContent = `${filtered.length}件`;

  if (filtered.length === 0) {
    if (!loadingEl.classList.contains('hidden')) return;
    postListEl.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<h3>投稿がありません</h3><p>フォロー中のユーザーの投稿が見つかりませんでした</p>';
    postListEl.appendChild(empty);
    renderRanking(filtered);
    return;
  }

  const cardMap = new Map();
  for (const el of postListEl.querySelectorAll('[data-event-id]')) {
    cardMap.set(el.dataset.eventId, el);
  }
  const newIdSet = new Set(filtered.map(e => e.id));

  for (const [id, el] of cardMap) {
    if (!newIdSet.has(id)) {
      virtualObserver.unobserve(el);
      el.remove();
    }
  }

  let prevEl = null;
  for (const event of filtered) {
    let card = cardMap.get(event.id);
    if (!card) {
      if (event.kind === 6) card = createRepostCard(event);
      else if (event.kind === 7) card = createReactionCard(event);
      else card = createPostCard(event);
      virtualObserver.observe(card);
    } else if (!card.classList.contains('v-placeholder')) {
      const reactionsEl = card.querySelector('.post-reactions');
      if (reactionsEl) renderCardReactions(reactionsEl, event.id);
    }

    const expectedNext = prevEl ? prevEl.nextSibling : postListEl.firstChild;
    if (card !== expectedNext) {
      if (prevEl) prevEl.after(card);
      else postListEl.prepend(card);
    }
    prevEl = card;
  }

  postListEl.querySelector('.empty-state')?.remove();
  renderRanking(filtered);

  const kind1Ids = filtered.filter(e => e.kind === 1).map(e => e.id);
  if (kind1Ids.length > 0) scheduleReplyFetch(kind1Ids);
}

// ---- Text parsing ----
const IMAGE_URL_RE = /https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp|avif|svg)(?:\?\S*)?/gi;
const TWEET_URL_RE = /https?:\/\/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)[^\s]*/gi;
const YOUTUBE_URL_RE = /https?:\/\/(?:www\.youtube\.com\/watch\?[^\s]*v=[\w-]+[^\s]*|youtu\.be\/[\w-]+[^\s]*)/gi;
const NOSTR_REF_RE = /nostr:(?:note1|nevent1)[a-z0-9]+/gi;
const NOSTR_PROFILE_REF_RE = /nostr:(?:npub1|nprofile1)[a-z0-9]+/gi;

function extractImageUrls(text) {
  return [...new Set(text.match(IMAGE_URL_RE) || [])];
}

function extractTweetUrls(text) {
  return [...new Set(text.match(TWEET_URL_RE) || [])];
}

function extractYoutubeUrls(text) {
  return [...new Set(text.match(YOUTUBE_URL_RE) || [])];
}

function extractNostrRefs(text) {
  return [...new Set(text.match(NOSTR_REF_RE) || [])];
}

function extractProfileRefs(text) {
  return [...new Set(text.match(NOSTR_PROFILE_REF_RE) || [])];
}

function youtubeVideoId(url) {
  const m = url.match(/[?&]v=([\w-]+)/) || url.match(/youtu\.be\/([\w-]+)/);
  return m ? m[1] : null;
}

function textWithoutImageUrls(text, urls) {
  let result = text;
  for (const url of urls) result = result.replace(url, '');
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

function textWithoutMediaUrls(text, imageUrls, tweetUrls, nostrRefs = [], youtubeUrls = [], profileRefs = []) {
  let result = text;
  for (const url of [...imageUrls, ...tweetUrls, ...nostrRefs, ...youtubeUrls, ...profileRefs]) result = result.replace(url, '');
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

// ---- Lazy embed observer ----
const lazyObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const el = entry.target;
    lazyObserver.unobserve(el);
    if (el.dataset.lazyType === 'tweet') activateTweetEmbed(el);
    else if (el.dataset.lazyType === 'youtube') activateYoutubeEmbed(el);
    else if (el.dataset.lazyType === 'nostr') activateNostrEmbed(el);
    else if (el.dataset.lazyType === 'profile') activateProfileEmbed(el);
  }
}, { rootMargin: '100% 0px' });

let twitterWidgetsLoaded = false;
function loadTwitterWidgets() {
  if (twitterWidgetsLoaded) return;
  twitterWidgetsLoaded = true;
  const s = document.createElement('script');
  s.src = 'https://platform.twitter.com/widgets.js';
  s.async = true;
  document.head.appendChild(s);
}

function activateTweetEmbed(placeholder) {
  loadTwitterWidgets();
  const theme = document.documentElement.classList.contains('light') ? 'light' : 'dark';
  const bq = document.createElement('blockquote');
  bq.className = 'twitter-tweet';
  bq.setAttribute('data-theme', theme);
  bq.setAttribute('data-dnt', 'true');
  const a = document.createElement('a');
  a.href = placeholder.dataset.url;
  bq.appendChild(a);
  placeholder.replaceWith(bq);
  requestAnimationFrame(() => {
    if (window.twttr?.widgets) window.twttr.widgets.load(bq);
  });
}

function buildTweetEmbeds(urls) {
  if (urls.length === 0) return null;
  const wrap = document.createElement('div');
  wrap.className = 'tweet-embeds';
  for (const url of urls.slice(0, 3)) {
    const ph = document.createElement('div');
    ph.className = 'tweet-lazy-placeholder';
    ph.dataset.lazyType = 'tweet';
    ph.dataset.url = url.replace('x.com', 'twitter.com');
    ph.innerHTML = '<span class="embed-loading-text">🐦 読み込み中...</span>';
    lazyObserver.observe(ph);
    wrap.appendChild(ph);
  }
  return wrap;
}

function activateYoutubeEmbed(placeholder) {
  const videoId = placeholder.dataset.videoId;
  if (!videoId) return;
  const wrap = document.createElement('div');
  wrap.className = 'youtube-embed';
  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube.com/embed/${videoId}`;
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
  iframe.allowFullscreen = true;
  iframe.loading = 'lazy';
  wrap.appendChild(iframe);
  placeholder.replaceWith(wrap);
}

function buildYoutubeEmbeds(urls) {
  if (urls.length === 0) return null;
  const wrap = document.createElement('div');
  wrap.className = 'youtube-embeds';
  for (const url of urls.slice(0, 2)) {
    const videoId = youtubeVideoId(url);
    if (!videoId) continue;
    const ph = document.createElement('div');
    ph.className = 'youtube-lazy-placeholder';
    ph.dataset.lazyType = 'youtube';
    ph.dataset.videoId = videoId;
    ph.innerHTML = `<span class="embed-loading-text">▶️ YouTube 読み込み中...</span>`;
    lazyObserver.observe(ph);
    wrap.appendChild(ph);
  }
  return wrap.childElementCount > 0 ? wrap : null;
}

function buildImageGrid(urls, openFn) {
  if (urls.length === 0) return null;
  const grid = document.createElement('div');
  grid.className = `post-images count-${Math.min(urls.length, 4)}`;
  for (const url of urls.slice(0, 4)) {
    const wrap = document.createElement('div');
    wrap.className = 'post-image-wrap';
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('click', e => { e.stopPropagation(); openFn(url); });
    wrap.appendChild(img);
    grid.appendChild(wrap);
  }
  return grid;
}

// ---- Card creation: Repost ----
function createRepostCard(event) {
  const profile = profileCache.get(event.pubkey) || {};
  const name = profile.display_name || profile.name || shortPubkey(event.pubkey);
  const targetId = (event.tags.find(t => t[0] === 'e') || [])[1] || '';
  const origEvent = eventCache.get(targetId);

  const card = document.createElement('div');
  card.className = 'post-card repost-card';
  card.dataset.eventId = event.id;
  card.addEventListener('click', () => openModal(event));

  const repostBar = document.createElement('div');
  repostBar.className = 'repost-bar';
  const repostBarInner = document.createElement('span');
  repostBarInner.className = 'author-name clickable-author';
  repostBarInner.textContent = name;
  repostBarInner.addEventListener('click', e => { e.stopPropagation(); openProfileModal(event.pubkey); });
  repostBar.innerHTML = '<span class="repost-icon">🔁</span>';
  repostBar.appendChild(repostBarInner);
  repostBar.appendChild(Object.assign(document.createElement('span'), { textContent: ' がリポスト' }));

  const timeLine = document.createElement('div');
  timeLine.className = 'post-time repost-time';
  timeLine.dataset.ts = event.created_at;
  timeLine.textContent = `${timeAgo(event.created_at)} · ${formatDate(event.created_at)}`;

  const preview = document.createElement('div');
  preview.className = 'repost-preview';
  if (origEvent) {
    fillRepostPreview(preview, origEvent);
  } else if (targetId) {
    preview.innerHTML = '<span class="reaction-preview-loading">読み込み中...</span>';
    if (!pendingTargetCards.has(targetId)) pendingTargetCards.set(targetId, new Set());
    preview._fill = (el, ev) => fillRepostPreview(el, ev);
    pendingTargetCards.get(targetId).add(preview);
    fetchTargetEvent(targetId);
  }

  const footer = document.createElement('div');
  footer.className = 'post-footer';
  footer.innerHTML = `<span class="post-id">${escHtml(event.id.slice(0, 16))}...</span><span class="post-kind">kind:6</span>`;

  card.appendChild(repostBar);
  card.appendChild(timeLine);
  card.appendChild(preview);
  card.appendChild(footer);
  return card;
}

function fillRepostPreview(el, origEvent) {
  const profile = profileCache.get(origEvent.pubkey) || {};
  const name = profile.display_name || profile.name || shortPubkey(origEvent.pubkey);
  const imageUrls = extractImageUrls(origEvent.content);
  const tweetUrls = extractTweetUrls(origEvent.content);
  const youtubeUrls = extractYoutubeUrls(origEvent.content);
  const profileRefs = extractProfileRefs(origEvent.content);
  const text = textWithoutMediaUrls(origEvent.content, imageUrls, tweetUrls, [], youtubeUrls, profileRefs);

  el.innerHTML = '';
  el.classList.add('has-content');

  const authorEl = document.createElement('div');
  authorEl.className = 'reaction-preview-author';
  const av = avatarEl(origEvent.pubkey, profile.picture);
  av.classList.add('avatar-xs');
  av.addEventListener('click', e => { e.stopPropagation(); openProfileModal(origEvent.pubkey); });
  const nameEl = document.createElement('span');
  nameEl.className = 'clickable-author';
  nameEl.textContent = name;
  nameEl.addEventListener('click', e => { e.stopPropagation(); openProfileModal(origEvent.pubkey); });
  authorEl.appendChild(av);
  authorEl.appendChild(nameEl);
  el.appendChild(authorEl);

  if (text) {
    const textEl = document.createElement('div');
    textEl.className = 'reaction-preview-text';
    textEl.textContent = text;
    el.appendChild(textEl);
  }

  const grid = buildImageGrid(imageUrls.slice(0, 1), url => openImageViewer(url));
  if (grid) { grid.classList.add('reaction-preview-img'); el.appendChild(grid); }
  if (profileRefs.length > 0) buildProfileEmbeds(profileRefs, el);
}

// ---- Card creation: Reaction ----
function reactionLabel(content) {
  if (!content || content === '+') return '👍';
  if (content === '-') return '👎';
  return content;
}

function createReactionCard(event) {
  const profile = profileCache.get(event.pubkey) || {};
  const name = profile.display_name || profile.name || shortPubkey(event.pubkey);
  const targetId = (event.tags.find(t => t[0] === 'e') || [])[1] || '';
  const emoji = reactionLabel(event.content);

  const card = document.createElement('div');
  card.className = 'post-card reaction-card';
  card.dataset.eventId = event.id;
  card.addEventListener('click', () => openModal(event));

  const header = document.createElement('div');
  header.className = 'post-header';

  const av = avatarWithBadge(event.pubkey, profile.picture);
  av.classList.add('clickable-author');
  av.addEventListener('click', e => { e.stopPropagation(); openProfileModal(event.pubkey); });
  header.appendChild(av);

  const meta = document.createElement('div');
  meta.className = 'post-meta';

  const authorLine = document.createElement('div');
  authorLine.className = 'post-author';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'author-name clickable-author';
  nameSpan.textContent = name;
  nameSpan.addEventListener('click', e => { e.stopPropagation(); openProfileModal(event.pubkey); });
  authorLine.appendChild(nameSpan);
  meta.appendChild(authorLine);

  const timeLine = document.createElement('div');
  timeLine.className = 'post-time';
  timeLine.dataset.ts = event.created_at;
  timeLine.textContent = `${timeAgo(event.created_at)} · ${formatDate(event.created_at)}`;
  meta.appendChild(timeLine);
  header.appendChild(meta);

  const emojiUrl = customEmojiUrl(event);
  const body = document.createElement('div');
  body.className = 'reaction-body';
  const prefixSpan = document.createElement('span');
  prefixSpan.className = 'reaction-target';
  prefixSpan.textContent = '以下のポストに';
  const emojiSpan = document.createElement('span');
  emojiSpan.className = 'reaction-emoji';
  if (emojiUrl) {
    const img = document.createElement('img');
    img.src = emojiUrl;
    img.alt = emoji;
    img.className = 'reaction-emoji-img';
    emojiSpan.appendChild(img);
  } else {
    emojiSpan.textContent = emoji;
  }
  const suffixSpan = document.createElement('span');
  suffixSpan.className = 'reaction-target';
  suffixSpan.textContent = 'しました';
  body.appendChild(prefixSpan);
  body.appendChild(emojiSpan);
  body.appendChild(suffixSpan);

  const preview = document.createElement('div');
  preview.className = 'reaction-preview';
  if (targetId) {
    const cached = eventCache.get(targetId);
    if (cached) {
      fillReactionPreview(preview, cached);
    } else {
      preview.innerHTML = '<span class="reaction-preview-loading">読み込み中...</span>';
      if (!pendingTargetCards.has(targetId)) pendingTargetCards.set(targetId, new Set());
      pendingTargetCards.get(targetId).add(preview);
      fetchTargetEvent(targetId);
    }
  }

  const footer = document.createElement('div');
  footer.className = 'post-footer';
  footer.innerHTML = `<span class="post-id">${escHtml(event.id.slice(0, 16))}...</span><span class="post-kind">kind:7</span>`;

  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(preview);
  card.appendChild(footer);
  return card;
}

function fillReactionPreview(el, targetEvent) {
  const profile = profileCache.get(targetEvent.pubkey) || {};
  const name = profile.display_name || profile.name || shortPubkey(targetEvent.pubkey);
  const imageUrls = extractImageUrls(targetEvent.content);
  const tweetUrls = extractTweetUrls(targetEvent.content);
  const youtubeUrls = extractYoutubeUrls(targetEvent.content);
  const profileRefs = extractProfileRefs(targetEvent.content);
  const text = textWithoutMediaUrls(targetEvent.content, imageUrls, tweetUrls, [], youtubeUrls, profileRefs);

  el.innerHTML = '';
  el.classList.add('has-content');

  const authorEl = document.createElement('div');
  authorEl.className = 'reaction-preview-author';
  const av = avatarEl(targetEvent.pubkey, profile.picture);
  av.classList.add('avatar-xs');
  av.addEventListener('click', e => { e.stopPropagation(); openProfileModal(targetEvent.pubkey); });
  authorEl.appendChild(av);
  const nameEl = document.createElement('span');
  nameEl.textContent = name;
  authorEl.appendChild(nameEl);
  el.appendChild(authorEl);

  if (text) {
    const textEl = document.createElement('div');
    textEl.className = 'reaction-preview-text';
    textEl.textContent = text;
    el.appendChild(textEl);
  }

  if (imageUrls.length > 0) {
    const grid = buildImageGrid(imageUrls.slice(0, 1), url => openImageViewer(url));
    if (grid) { grid.classList.add('reaction-preview-img'); el.appendChild(grid); }
  }
  if (profileRefs.length > 0) buildProfileEmbeds(profileRefs, el);
}

// ---- Card creation: Post ----
function createPostCard(event) {
  const profile = profileCache.get(event.pubkey) || {};
  const name = profile.display_name || profile.name || shortPubkey(event.pubkey);
  const handle = profile.name ? `@${profile.name.split('@')[0]}` : '';
  const imageUrls = extractImageUrls(event.content);
  const tweetUrls = extractTweetUrls(event.content);
  const youtubeUrls = extractYoutubeUrls(event.content);
  const nostrRefs = extractNostrRefs(event.content);
  const profileRefs = extractProfileRefs(event.content);
  const textContent = textWithoutMediaUrls(event.content, imageUrls, tweetUrls, nostrRefs, youtubeUrls, profileRefs);

  const card = document.createElement('div');
  card.className = 'post-card';
  card.dataset.eventId = event.id;
  card.addEventListener('click', () => openModal(event));

  const header = document.createElement('div');
  header.className = 'post-header';

  const av = avatarWithBadge(event.pubkey, profile.picture);
  av.classList.add('clickable-author');
  av.addEventListener('click', e => { e.stopPropagation(); openProfileModal(event.pubkey); });
  header.appendChild(av);

  const meta = document.createElement('div');
  meta.className = 'post-meta';

  const authorLine = document.createElement('div');
  authorLine.className = 'post-author';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'author-name clickable-author';
  nameSpan.textContent = name;
  nameSpan.addEventListener('click', e => { e.stopPropagation(); openProfileModal(event.pubkey); });
  authorLine.appendChild(nameSpan);
  if (handle) {
    const handleSpan = document.createElement('span');
    handleSpan.className = 'handle';
    handleSpan.textContent = ` ${handle}`;
    authorLine.appendChild(handleSpan);
  }

  const timeLine = document.createElement('div');
  timeLine.className = 'post-time';
  timeLine.dataset.ts = event.created_at;
  timeLine.textContent = `${timeAgo(event.created_at)} · ${formatDate(event.created_at)}`;

  meta.appendChild(authorLine);
  meta.appendChild(timeLine);
  header.appendChild(meta);

  const body = document.createElement('div');
  body.className = `post-body${textContent ? ' truncated' : ''}`;
  renderTextWithTags(body, textContent);

  const footer = document.createElement('div');
  footer.className = 'post-footer';

  const reactions = document.createElement('div');
  reactions.className = 'post-reactions';
  renderCardReactions(reactions, event.id);
  footer.appendChild(reactions);

  const kindBadge = document.createElement('span');
  kindBadge.className = 'post-kind';
  kindBadge.textContent = `kind:${event.kind}`;
  footer.appendChild(kindBadge);

  card.appendChild(header);

  const parentId = getReplyParentId(event);
  if (parentId) {
    const quoteWrap = document.createElement('div');
    quoteWrap.className = 'reply-quote-wrap';
    quoteWrap.dataset.parentId = parentId;

    const parentEvent = eventCache.get(parentId);
    if (parentEvent) {
      fillReplyQuote(quoteWrap, parentEvent);
    } else {
      quoteWrap.innerHTML = '<div class="reply-quote loading"><span class="reaction-preview-loading">返信元を読み込み中...</span></div>';
      if (!pendingTargetCards.has(parentId)) pendingTargetCards.set(parentId, new Set());
      quoteWrap._fill = (el, ev) => fillReplyQuote(el, ev);
      pendingTargetCards.get(parentId).add(quoteWrap);
      fetchTargetEvent(parentId);
    }
    card.appendChild(quoteWrap);
  }

  if (textContent) card.appendChild(body);
  const grid = buildImageGrid(imageUrls, url => openImageViewer(url));
  if (grid) card.appendChild(grid);
  const tweetEmbeds = buildTweetEmbeds(tweetUrls);
  if (tweetEmbeds) card.appendChild(tweetEmbeds);
  const youtubeEmbeds = buildYoutubeEmbeds(youtubeUrls);
  if (youtubeEmbeds) card.appendChild(youtubeEmbeds);
  if (nostrRefs.length > 0) buildNostrEmbeds(nostrRefs, card);
  if (profileRefs.length > 0) buildProfileEmbeds(profileRefs, card);

  const replyPreview = document.createElement('div');
  replyPreview.className = 'post-reply-preview';
  renderCardReplyPreview(replyPreview, event.id);
  card.appendChild(replyPreview);

  card.appendChild(footer);
  return card;
}

function activateNostrEmbed(wrap) {
  const hexId = wrap.dataset.lazyId;
  const cached = eventCache.get(hexId);
  if (cached) { fillReplyQuote(wrap, cached); return; }
  if (!pendingTargetCards.has(hexId)) pendingTargetCards.set(hexId, new Set());
  wrap._fill = (el, ev) => fillReplyQuote(el, ev);
  pendingTargetCards.get(hexId).add(wrap);
  let relayHints = [];
  try { relayHints = JSON.parse(wrap.dataset.relayHints || '[]'); } catch (_) {}
  fetchTargetEvent(hexId, relayHints);
}

// ---- Profile embed card (nostr:npub1 / nostr:nprofile1) ----
function fillProfileEmbed(wrap, pubkey) {
  const profile = profileCache.get(pubkey) || {};
  const name = profile.display_name || profile.name || shortPubkey(pubkey);

  wrap.innerHTML = '';
  const inner = document.createElement('div');
  inner.className = 'profile-embed';
  inner.addEventListener('click', e => { e.stopPropagation(); openProfileModal(pubkey); });

  const av = avatarWithBadge(pubkey, profile.picture);
  av.querySelector('.avatar')?.classList.add('avatar-sm');
  inner.appendChild(av);

  const info = document.createElement('div');
  info.className = 'profile-embed-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'profile-embed-name';
  nameEl.textContent = name;
  info.appendChild(nameEl);

  if (profile.about) {
    const bioEl = document.createElement('div');
    bioEl.className = 'profile-embed-bio';
    bioEl.textContent = profile.about.length > 80
      ? profile.about.slice(0, 80) + '…'
      : profile.about;
    info.appendChild(bioEl);
  }

  inner.appendChild(info);
  wrap.appendChild(inner);
}

function activateProfileEmbed(placeholder) {
  const pubkey = placeholder.dataset.pubkey;
  if (!pubkey) return;
  const wrap = document.createElement('div');
  wrap.className = 'profile-embed-wrap';
  fillProfileEmbed(wrap, pubkey);
  placeholder.replaceWith(wrap);
  // キャッシュになければフェッチして再描画
  if (!profileCache.has(pubkey)) {
    fetchProfile(pubkey);
    if (!mentionCallbacks.has(pubkey)) mentionCallbacks.set(pubkey, new Set());
    mentionCallbacks.get(pubkey).add(() => fillProfileEmbed(wrap, pubkey));
  }
}

function buildProfileEmbeds(refs, card) {
  for (const ref of refs.slice(0, 3)) {
    try {
      const pubkey = decodeMentionPubkey(ref);
      // キャッシュ済みなら即レンダリング、未キャッシュなら遅延ロード
      if (profileCache.has(pubkey)) {
        const wrap = document.createElement('div');
        wrap.className = 'profile-embed-wrap';
        fillProfileEmbed(wrap, pubkey);
        card.appendChild(wrap);
      } else {
        const ph = document.createElement('div');
        ph.className = 'profile-embed-placeholder';
        ph.dataset.lazyType = 'profile';
        ph.dataset.pubkey = pubkey;
        lazyObserver.observe(ph);
        card.appendChild(ph);
      }
    } catch (_) {}
  }
}

function buildNostrEmbeds(refs, card) {
  for (const ref of refs.slice(0, 3)) {
    try {
      // nevent1 は relay hint も取り出す、note1 は id のみ
      const isNevent = /^nostr:nevent1/i.test(ref);
      let hexId, relayHints = [];
      if (isNevent) {
        const decoded = decodeNeventData(ref);
        hexId = decoded.id;
        relayHints = decoded.relays;
      } else {
        hexId = nostrRefToHex(ref);
      }

      const wrap = document.createElement('div');
      wrap.className = 'reply-quote-wrap';
      wrap.dataset.parentId = hexId;
      const cached = eventCache.get(hexId);
      if (cached) {
        fillReplyQuote(wrap, cached);
      } else {
        wrap.innerHTML = '<div class="reply-quote loading"><span class="reaction-preview-loading">読み込み中...</span></div>';
        wrap.dataset.lazyType = 'nostr';
        wrap.dataset.lazyId = hexId;
        if (relayHints.length > 0) wrap.dataset.relayHints = JSON.stringify(relayHints);
        lazyObserver.observe(wrap);
      }
      card.appendChild(wrap);
    } catch (_) {}
  }
}

function fillReplyQuote(wrap, parentEvent) {
  const profile = profileCache.get(parentEvent.pubkey) || {};
  const name = profile.display_name || profile.name || shortPubkey(parentEvent.pubkey);
  const imageUrls = extractImageUrls(parentEvent.content);
  const profileRefs = extractProfileRefs(parentEvent.content);
  const text = textWithoutMediaUrls(parentEvent.content, imageUrls, [], [], [], profileRefs);

  wrap.innerHTML = '';

  const quote = document.createElement('div');
  quote.className = 'reply-quote';
  quote.addEventListener('click', e => { e.stopPropagation(); openModal(parentEvent); });

  const quoteHeader = document.createElement('div');
  quoteHeader.className = 'reply-quote-header';

  const av = avatarEl(parentEvent.pubkey, profile.picture);
  av.classList.add('avatar-xs');
  av.addEventListener('click', e => { e.stopPropagation(); openProfileModal(parentEvent.pubkey); });

  const nameEl = document.createElement('span');
  nameEl.className = 'reply-quote-name clickable-author';
  nameEl.textContent = name;
  nameEl.addEventListener('click', e => { e.stopPropagation(); openProfileModal(parentEvent.pubkey); });

  quoteHeader.appendChild(av);
  quoteHeader.appendChild(nameEl);
  quote.appendChild(quoteHeader);

  if (text) {
    const textEl = document.createElement('div');
    textEl.className = 'reply-quote-text';
    textEl.textContent = text;
    quote.appendChild(textEl);
  }
  if (imageUrls.length > 0) {
    const imgEl = document.createElement('div');
    imgEl.className = 'reply-quote-img-hint';
    imgEl.textContent = `🖼 画像 ${imageUrls.length}枚`;
    quote.appendChild(imgEl);
  }
  if (profileRefs.length > 0) buildProfileEmbeds(profileRefs, quote);

  wrap.appendChild(quote);

  if (!eventCache.has(parentEvent.id)) {
    eventCache.set(parentEvent.id, parentEvent);
    fetchProfile(parentEvent.pubkey);
  }
}

function renderCardReplyPreview(el, eventId) {
  const replies = replyMap.get(eventId) || [];
  el.innerHTML = '';
  if (replies.length === 0) return;

  const countBar = document.createElement('div');
  countBar.className = 'reply-count-bar';
  countBar.textContent = `💬 ${replies.length}件のリプライ`;
  el.appendChild(countBar);

  const latest = replies[replies.length - 1];
  const profile = profileCache.get(latest.pubkey) || {};
  const name = profile.display_name || profile.name || shortPubkey(latest.pubkey);
  const imageUrls = extractImageUrls(latest.content);
  const tweetUrls = extractTweetUrls(latest.content);
  const youtubeUrls = extractYoutubeUrls(latest.content);
  const nostrRefs = extractNostrRefs(latest.content);
  const profileRefs = extractProfileRefs(latest.content);
  const text = textWithoutMediaUrls(latest.content, imageUrls, tweetUrls, nostrRefs, youtubeUrls, profileRefs);

  const preview = document.createElement('div');
  preview.className = 'reply-preview-item';

  const av = avatarEl(latest.pubkey, profile.picture);
  av.classList.add('avatar-xs');
  av.addEventListener('click', e => { e.stopPropagation(); openProfileModal(latest.pubkey); });

  const bubble = document.createElement('div');
  bubble.className = 'reply-bubble';

  const nameEl = document.createElement('span');
  nameEl.className = 'reply-bubble-name clickable-author';
  nameEl.textContent = name;
  nameEl.addEventListener('click', e => { e.stopPropagation(); openProfileModal(latest.pubkey); });

  const textEl = document.createElement('div');
  textEl.className = 'reply-bubble-text';
  textEl.textContent = text;

  bubble.appendChild(nameEl);
  bubble.appendChild(textEl);
  preview.appendChild(av);
  preview.appendChild(bubble);

  el.appendChild(preview);

  // 画像サムネイル（最大1枚）
  if (imageUrls.length > 0) {
    const grid = buildImageGrid(imageUrls.slice(0, 1), url => openImageViewer(url));
    if (grid) { grid.classList.add('reply-preview-media'); el.appendChild(grid); }
  } else if (youtubeUrls.length > 0) {
    // YouTube サムネイル
    const vid = youtubeVideoId(youtubeUrls[0]);
    if (vid) {
      const thumb = document.createElement('img');
      thumb.src = `https://img.youtube.com/vi/${vid}/mqdefault.jpg`;
      thumb.className = 'reply-preview-yt-thumb';
      thumb.alt = 'YouTube';
      el.appendChild(thumb);
    }
  } else if (nostrRefs.length > 0) {
    // nostr 引用（コンパクト）
    buildNostrEmbeds(nostrRefs.slice(0, 1), el);
  }
}
