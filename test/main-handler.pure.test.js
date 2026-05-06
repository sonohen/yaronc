'use strict';

/**
 * relay.js の mainSubId / targets- / replies- イベントハンドラーロジックのユニットテスト。
 * relay.js は WebSocket・DOM に強く依存するため、
 * 対象ロジックをインライン化して検証する。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ---- 共通ヘルパー ----

function makeHandlerModule(scrollY = 0) {
  const seenEvents = new Set();
  function addSeenEvent(id) { seenEvents.add(id); }

  let posts = [];
  const pendingPosts = [];
  const reactionMap = new Map();
  const replyMap = new Map();
  const eventCache = new Map();
  const pendingTargetCards = new Map();
  const followedPubkeys = new Set(['denshiuma', 'userB', 'userC']);

  function cacheEvent(id, event) { eventCache.set(id, event); }
  function addToReactionMap(event) { reactionMap.set(event.id, event); }
  function addReply(event) {
    const eTags = event.tags.filter(t => t[0] === 'e');
    for (const tag of eTags) {
      const parentId = tag[1];
      if (!replyMap.has(parentId)) replyMap.set(parentId, []);
      replyMap.get(parentId).push(event);
    }
  }

  // ---- targets- ハンドラー (relay.js:344-360 の修正済み版) ----
  function handleTargetsEvent(event) {
    if (!eventCache.has(event.id)) cacheEvent(event.id, event);
    const waiting = pendingTargetCards.get(event.id);
    if (waiting) {
      for (const fn of waiting) fn(event);
      pendingTargetCards.delete(event.id);
    }
    // seenEvents には追加しない → mainSubId でも処理できる
    return;
  }

  // ---- replies- ハンドラー (relay.js:444-447 の修正済み版) ----
  // seenEvents チェックより先に処理する
  function handleRepliesEvent(event) {
    const eTags = event.tags.filter(t => t[0] === 'e');
    if (eTags.length > 0) addReply(event);
    // フォロー中ユーザーの返信はメインタイムラインにも追加する
    if (followedPubkeys.has(event.pubkey) && !seenEvents.has(event.id)) {
      addSeenEvent(event.id);
      const isScrolledDown = scrollY > 200;
      if (isScrolledDown) {
        pendingPosts.push(event);
      } else {
        posts.push(event);
        posts.sort((a, b) => b.created_at - a.created_at);
        if (posts.length > 1000) posts = posts.slice(0, 1000);
      }
    }
    return;
  }

  // ---- mainSubId ハンドラー (relay.js:381-441) ----
  function handleMainSubEvent(event, mainSubId, subId) {
    if (seenEvents.has(event.id)) return;
    addSeenEvent(event.id);

    if ((event.kind === 1 || event.kind === 6 || event.kind === 7) &&
        (subId === mainSubId || subId.startsWith('new-follows-'))) {
      if (event.kind === 7) {
        addToReactionMap(event);
        return;
      }
      const isScrolledDown = scrollY > 200;
      if (isScrolledDown) {
        pendingPosts.push(event);
      } else {
        posts.push(event);
        posts.sort((a, b) => b.created_at - a.created_at);
        if (posts.length > 1000) posts = posts.slice(0, 1000);
      }
    }
  }

  return {
    get posts() { return posts; },
    pendingPosts,
    reactionMap,
    replyMap,
    seenEvents,
    eventCache,
    pendingTargetCards,
    followedPubkeys,
    handleTargetsEvent,
    handleRepliesEvent,
    handleMainSubEvent,
  };
}

// ========================
// replies- → mainSubId の競合テスト
// 修正前はこのテストが失敗する（replies- の seenEvents がブロックするため）
// ========================

test('replies- 経由で先に取得されたフォロー中ユーザーの返信が mainSubId でも posts に追加される', () => {
  const m = makeHandlerModule(0);
  const reply = {
    id: 'reply1',
    kind: 1,
    pubkey: 'denshiuma',
    created_at: 1000,
    tags: [['e', 'parent1']],
    content: 'これは返信です',
  };

  // Step 1: replies- サブスクが先に返信を取得する（競合状態）
  m.handleRepliesEvent(reply);

  // Step 2: mainSubId が同じ返信を送ってくる
  m.handleMainSubEvent(reply, 'main', 'main');

  assert.equal(m.posts.length, 1, 'replies- で先取りされても posts に入るべき');
  assert.equal(m.posts[0].id, 'reply1');
});

test('replies- で先取りされた場合も addReply は呼ばれる', () => {
  const m = makeHandlerModule(0);
  const reply = {
    id: 'reply2',
    kind: 1,
    pubkey: 'denshiuma',
    created_at: 1000,
    tags: [['e', 'parent1']],
    content: 'reply',
  };

  m.handleRepliesEvent(reply);

  assert.ok(m.replyMap.has('parent1'), 'replyMap に登録される');
  assert.equal(m.replyMap.get('parent1')[0].id, 'reply2');
});

test('mainSubId が先に処理した後も replies- で addReply が呼ばれる', () => {
  const m = makeHandlerModule(0);
  const reply = {
    id: 'reply3',
    kind: 1,
    pubkey: 'denshiuma',
    created_at: 1000,
    tags: [['e', 'parent2']],
    content: 'reply',
  };

  // mainSubId が先
  m.handleMainSubEvent(reply, 'main', 'main');
  // replies- が後
  m.handleRepliesEvent(reply);

  assert.ok(m.replyMap.has('parent2'), 'mainSubId が先でも addReply は呼ばれる');
  assert.equal(m.posts.length, 1, 'posts には1件だけ（重複なし）');
});

test('フォローしていないユーザーの返信は posts に追加されない', () => {
  const m = makeHandlerModule(0);
  const reply = {
    id: 'reply4',
    kind: 1,
    pubkey: 'unknown_user',
    created_at: 1000,
    tags: [['e', 'parent1']],
    content: 'reply from stranger',
  };

  m.handleRepliesEvent(reply);

  assert.equal(m.posts.length, 0, '非フォローユーザーの返信は posts に入らない');
  assert.ok(m.replyMap.has('parent1'), 'addReply は呼ばれる');
});

test('同じ返信が replies- に複数回届いても posts は1件', () => {
  const m = makeHandlerModule(0);
  const reply = {
    id: 'reply5',
    kind: 1,
    pubkey: 'denshiuma',
    created_at: 1000,
    tags: [['e', 'parent1']],
    content: 'dup',
  };

  m.handleRepliesEvent(reply);
  m.handleRepliesEvent(reply); // 2つ目のリレーから来た場合

  assert.equal(m.posts.length, 1, '重複なし');
});

// ========================
// targets- 経由の競合テスト（既存）
// ========================

test('targets- 経由で取得済みの投稿が mainSubId でも posts に追加される', () => {
  const m = makeHandlerModule(0);
  const post = { id: 'post1', kind: 1, pubkey: 'denshiuma', created_at: 1000, tags: [], content: 'hello' };

  m.handleTargetsEvent(post);
  m.handleMainSubEvent(post, 'main', 'main');

  assert.equal(m.posts.length, 1);
  assert.equal(m.posts[0].id, 'post1');
});

test('targets- は eventCache に登録する', () => {
  const m = makeHandlerModule(0);
  const post = { id: 'post2', kind: 1, pubkey: 'someone', created_at: 2000, tags: [], content: 'world' };
  m.handleTargetsEvent(post);
  assert.ok(m.eventCache.has('post2'));
});

test('targets- は pendingTargetCards を解決する', () => {
  const m = makeHandlerModule(0);
  const post = { id: 'post3', kind: 1, pubkey: 'someone', created_at: 3000, tags: [], content: 'test' };
  let resolved = null;
  m.pendingTargetCards.set('post3', [(ev) => { resolved = ev; }]);
  m.handleTargetsEvent(post);
  assert.equal(resolved?.id, 'post3');
  assert.ok(!m.pendingTargetCards.has('post3'));
});

// ========================
// kind=7 テスト
// ========================

test('kind=7 は posts に追加されない', () => {
  const { posts, handleMainSubEvent } = makeHandlerModule(0);
  const ev = { id: 'ev7', kind: 7, pubkey: 'pub1', created_at: 1000, tags: [['e', 'target1']], content: '+' };
  handleMainSubEvent(ev, 'main', 'main');
  assert.equal(posts.length, 0);
});

test('kind=7 は reactionMap に登録される', () => {
  const { reactionMap, handleMainSubEvent } = makeHandlerModule(0);
  const ev = { id: 'ev7r', kind: 7, pubkey: 'pub1', created_at: 1000, tags: [['e', 'target1']], content: '+' };
  handleMainSubEvent(ev, 'main', 'main');
  assert.ok(reactionMap.has('ev7r'));
});

// ========================
// kind=1 / kind=6 テスト
// ========================

test('kind=1 は posts に追加される', () => {
  const { posts, handleMainSubEvent } = makeHandlerModule(0);
  const ev = { id: 'ev1', kind: 1, pubkey: 'pub1', created_at: 1000, tags: [], content: 'hello' };
  handleMainSubEvent(ev, 'main', 'main');
  assert.equal(posts.length, 1);
});

test('kind=1 スクロール済みは pendingPosts に入る', () => {
  const { posts, pendingPosts, handleMainSubEvent } = makeHandlerModule(500);
  const ev = { id: 'ev1p', kind: 1, pubkey: 'pub1', created_at: 1000, tags: [], content: 'hello' };
  handleMainSubEvent(ev, 'main', 'main');
  assert.equal(posts.length, 0);
  assert.equal(pendingPosts.length, 1);
});

test('kind=6 は posts に追加される', () => {
  const { posts, handleMainSubEvent } = makeHandlerModule(0);
  const ev = { id: 'ev6', kind: 6, pubkey: 'pub1', created_at: 1000, tags: [['e', 'orig']], content: '' };
  handleMainSubEvent(ev, 'main', 'main');
  assert.equal(posts.length, 1);
});

test('subId が合わなければ無視される', () => {
  const { posts, handleMainSubEvent } = makeHandlerModule(0);
  const ev = { id: 'ev_other', kind: 1, pubkey: 'pub1', created_at: 1000, tags: [], content: 'hello' };
  handleMainSubEvent(ev, 'main', 'other-sub');
  assert.equal(posts.length, 0);
});

test('new-follows- サブスクは posts に追加される', () => {
  const { posts, handleMainSubEvent } = makeHandlerModule(0);
  const ev = { id: 'ev_nf', kind: 1, pubkey: 'pub1', created_at: 1000, tags: [], content: 'hello' };
  handleMainSubEvent(ev, 'main', 'new-follows-abc123');
  assert.equal(posts.length, 1);
});
