'use strict';

/**
 * relay.js の mainSubId / targets- イベントハンドラーロジックのユニットテスト。
 * relay.js は WebSocket・DOM に強く依存するため、
 * 対象ロジックをインライン化して検証する。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ---- 共通ヘルパー ----

function makeSeenEventsModule() {
  const seenEvents = new Set();
  function addSeenEvent(id) { seenEvents.add(id); }
  return { seenEvents, addSeenEvent };
}

// ---- targets- + mainSubId 統合ハンドラーのインライン実装 ----
// relay.js:344-441 と同一ロジック（DOM/WS 依存を排除）

function makeHandlerModule(scrollY = 0) {
  const { seenEvents, addSeenEvent } = makeSeenEventsModule();
  let posts = [];
  const pendingPosts = [];
  const reactionMap = new Map();
  const eventCache = new Map();
  const pendingTargetCards = new Map();

  function cacheEvent(id, event) { eventCache.set(id, event); }

  function addToReactionMap(event) { reactionMap.set(event.id, event); }

  // targets- ハンドラー (relay.js:344-360)
  function handleTargetsEvent(event) {
    if (!eventCache.has(event.id)) {
      cacheEvent(event.id, event);
    }
    const waiting = pendingTargetCards.get(event.id);
    if (waiting) {
      for (const fn of waiting) fn(event);
      pendingTargetCards.delete(event.id);
    }
    // BUG (修正前): seenEvents に追加してしまう
    // if (seenEvents.has(event.id)) return;
    // addSeenEvent(event.id);
    // return;
    //
    // FIX (修正後): seenEvents に追加しない → mainSubId でも処理できる
    return;
  }

  // mainSubId ハンドラー (relay.js:381-441)
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
    seenEvents,
    eventCache,
    pendingTargetCards,
    handleTargetsEvent,
    handleMainSubEvent,
  };
}

// ---- BUG テスト: targets- 後に mainSubId で同じ投稿が届くと posts に入るべき ----
// 修正前はこのテストが失敗する（targets- の addSeenEvent が mainSubId をブロックするため）

test('targets- 経由で取得済みの投稿が mainSubId でも posts に追加される', () => {
  const m = makeHandlerModule(0);
  const post = { id: 'post1', kind: 1, pubkey: 'denshiuma', created_at: 1000, tags: [], content: 'hello' };

  // Step 1: 別ユーザーのリポストにより targets- で先に取得される
  m.handleTargetsEvent(post);

  // Step 2: mainSubId が同じ投稿を送ってくる（電子馬をフォローしているので）
  m.handleMainSubEvent(post, 'main', 'main');

  assert.equal(m.posts.length, 1, 'targets- で先に取得されても mainSubId 経由で posts に入るべき');
  assert.equal(m.posts[0].id, 'post1');
});

test('targets- は eventCache に登録する', () => {
  const m = makeHandlerModule(0);
  const post = { id: 'post2', kind: 1, pubkey: 'someone', created_at: 2000, tags: [], content: 'world' };
  m.handleTargetsEvent(post);
  assert.ok(m.eventCache.has('post2'), 'targets- は eventCache に登録する');
});

test('targets- は pendingTargetCards を解決する', () => {
  const m = makeHandlerModule(0);
  const post = { id: 'post3', kind: 1, pubkey: 'someone', created_at: 3000, tags: [], content: 'test' };

  let resolved = null;
  m.pendingTargetCards.set('post3', [(ev) => { resolved = ev; }]);

  m.handleTargetsEvent(post);

  assert.equal(resolved?.id, 'post3', 'pendingTargetCards の待機カードが解決される');
  assert.ok(!m.pendingTargetCards.has('post3'), '解決後は pendingTargetCards から削除される');
});

test('同じ投稿が targets- に複数回届いても eventCache は1つ', () => {
  const m = makeHandlerModule(0);
  const post = { id: 'post4', kind: 1, pubkey: 'someone', created_at: 4000, tags: [], content: 'dup' };
  m.handleTargetsEvent(post);
  m.handleTargetsEvent(post); // 2回目: 2つ目のリレーから届く
  assert.equal(m.eventCache.size, 1);
});

// ========================
// kind=7 (リアクション) テスト
// ========================

test('kind=7 は posts に追加されない（スクロール位置=0）', () => {
  const { posts, handleMainSubEvent } = makeHandlerModule(0);
  const ev = { id: 'ev7', kind: 7, pubkey: 'pub1', created_at: 1000, tags: [['e', 'target1']], content: '+' };
  handleMainSubEvent(ev, 'main', 'main');
  assert.equal(posts.length, 0, 'kind=7 は posts に入ってはいけない');
});

test('kind=7 は posts に追加されない（スクロール位置=500 スクロール済み）', () => {
  const { posts, handleMainSubEvent } = makeHandlerModule(500);
  const ev = { id: 'ev7s', kind: 7, pubkey: 'pub1', created_at: 1000, tags: [['e', 'target1']], content: '+' };
  handleMainSubEvent(ev, 'main', 'main');
  assert.equal(posts.length, 0, 'スクロール済みでも kind=7 は posts に入ってはいけない');
});

test('kind=7 は addToReactionMap に登録される', () => {
  const { reactionMap, handleMainSubEvent } = makeHandlerModule(0);
  const ev = { id: 'ev7r', kind: 7, pubkey: 'pub1', created_at: 1000, tags: [['e', 'target1']], content: '+' };
  handleMainSubEvent(ev, 'main', 'main');
  assert.ok(reactionMap.has('ev7r'), 'kind=7 は reactionMap に登録される');
});

// ========================
// kind=1 (テキスト投稿) テスト
// ========================

test('kind=1 は posts に追加される（スクロール位置=0）', () => {
  const { posts, handleMainSubEvent } = makeHandlerModule(0);
  const ev = { id: 'ev1', kind: 1, pubkey: 'pub1', created_at: 1000, tags: [], content: 'hello' };
  handleMainSubEvent(ev, 'main', 'main');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, 'ev1');
});

test('kind=1 はスクロール済みのとき pendingPosts に入る', () => {
  const { posts, pendingPosts, handleMainSubEvent } = makeHandlerModule(500);
  const ev = { id: 'ev1p', kind: 1, pubkey: 'pub1', created_at: 1000, tags: [], content: 'hello' };
  handleMainSubEvent(ev, 'main', 'main');
  assert.equal(posts.length, 0);
  assert.equal(pendingPosts.length, 1);
  assert.equal(pendingPosts[0].id, 'ev1p');
});

// ========================
// kind=6 (リポスト) テスト
// ========================

test('kind=6 は posts に追加される（スクロール位置=0）', () => {
  const { posts, handleMainSubEvent } = makeHandlerModule(0);
  const ev = { id: 'ev6', kind: 6, pubkey: 'pub1', created_at: 1000, tags: [['e', 'orig']], content: '' };
  handleMainSubEvent(ev, 'main', 'main');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, 'ev6');
});

test('kind=6 はスクロール済みのとき pendingPosts に入る', () => {
  const { posts, pendingPosts, handleMainSubEvent } = makeHandlerModule(500);
  const ev = { id: 'ev6p', kind: 6, pubkey: 'pub1', created_at: 1000, tags: [['e', 'orig']], content: '' };
  handleMainSubEvent(ev, 'main', 'main');
  assert.equal(posts.length, 0);
  assert.equal(pendingPosts.length, 1);
});

// ========================
// subId フィルタリングテスト
// ========================

test('subId が mainSubId でも new-follows- でもなければ無視される', () => {
  const { posts, handleMainSubEvent } = makeHandlerModule(0);
  const ev = { id: 'ev_other', kind: 1, pubkey: 'pub1', created_at: 1000, tags: [], content: 'hello' };
  handleMainSubEvent(ev, 'main', 'other-sub');
  assert.equal(posts.length, 0);
});

test('subId が new-follows- で始まる場合は posts に追加される', () => {
  const { posts, handleMainSubEvent } = makeHandlerModule(0);
  const ev = { id: 'ev_nf', kind: 1, pubkey: 'pub1', created_at: 1000, tags: [], content: 'hello' };
  handleMainSubEvent(ev, 'main', 'new-follows-abc123');
  assert.equal(posts.length, 1);
});
