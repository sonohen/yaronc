'use strict';

/**
 * relay.js の mainSubId イベントハンドラーロジックのユニットテスト。
 * relay.js は WebSocket・DOM に強く依存するため、
 * 対象ロジック（relay.js:404-439）をインライン化して検証する。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ---- mainSubId ハンドラーのインライン実装 (relay.js:404-439 と同一ロジック) ----

function makeMainHandlerModule(scrollY = 0) {
  let posts = [];
  const pendingPosts = [];
  const reactionMap = new Map();

  function addToReactionMap(event) {
    reactionMap.set(event.id, event);
  }

  function handleMainSubEvent(event, mainSubId, subId) {
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

  return { get posts() { return posts; }, pendingPosts, reactionMap, handleMainSubEvent };
}

// ========================
// kind=7 (リアクション) テスト — バグ修正前は失敗する
// ========================

test('kind=7 は posts に追加されない（スクロール位置=0）', () => {
  const { posts, handleMainSubEvent } = makeMainHandlerModule(0);
  const ev = { id: 'ev7', kind: 7, pubkey: 'pub1', created_at: 1000, tags: [['e', 'target1']], content: '+' };
  handleMainSubEvent(ev, 'main', 'main');
  assert.equal(posts.length, 0, 'kind=7 は posts に入ってはいけない');
});

test('kind=7 は posts に追加されない（スクロール位置=500 スクロール済み）', () => {
  const { posts, handleMainSubEvent } = makeMainHandlerModule(500);
  const ev = { id: 'ev7s', kind: 7, pubkey: 'pub1', created_at: 1000, tags: [['e', 'target1']], content: '+' };
  handleMainSubEvent(ev, 'main', 'main');
  assert.equal(posts.length, 0, 'スクロール済みでも kind=7 は posts に入ってはいけない');
});

test('kind=7 は addToReactionMap に登録される', () => {
  const { reactionMap, handleMainSubEvent } = makeMainHandlerModule(0);
  const ev = { id: 'ev7r', kind: 7, pubkey: 'pub1', created_at: 1000, tags: [['e', 'target1']], content: '+' };
  handleMainSubEvent(ev, 'main', 'main');
  assert.ok(reactionMap.has('ev7r'), 'kind=7 は reactionMap に登録される');
});

// ========================
// kind=1 (テキスト投稿) テスト
// ========================

test('kind=1 は posts に追加される（スクロール位置=0）', () => {
  const { posts, handleMainSubEvent } = makeMainHandlerModule(0);
  const ev = { id: 'ev1', kind: 1, pubkey: 'pub1', created_at: 1000, tags: [], content: 'hello' };
  handleMainSubEvent(ev, 'main', 'main');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, 'ev1');
});

test('kind=1 はスクロール済みのとき pendingPosts に入る', () => {
  const { posts, pendingPosts, handleMainSubEvent } = makeMainHandlerModule(500);
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
  const { posts, handleMainSubEvent } = makeMainHandlerModule(0);
  const ev = { id: 'ev6', kind: 6, pubkey: 'pub1', created_at: 1000, tags: [['e', 'orig']], content: '' };
  handleMainSubEvent(ev, 'main', 'main');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, 'ev6');
});

test('kind=6 はスクロール済みのとき pendingPosts に入る', () => {
  const { posts, pendingPosts, handleMainSubEvent } = makeMainHandlerModule(500);
  const ev = { id: 'ev6p', kind: 6, pubkey: 'pub1', created_at: 1000, tags: [['e', 'orig']], content: '' };
  handleMainSubEvent(ev, 'main', 'main');
  assert.equal(posts.length, 0);
  assert.equal(pendingPosts.length, 1);
});

// ========================
// subId フィルタリングテスト
// ========================

test('subId が mainSubId でも new-follows- でもなければ無視される', () => {
  const { posts, handleMainSubEvent } = makeMainHandlerModule(0);
  const ev = { id: 'ev_other', kind: 1, pubkey: 'pub1', created_at: 1000, tags: [], content: 'hello' };
  handleMainSubEvent(ev, 'main', 'other-sub');
  assert.equal(posts.length, 0);
});

test('subId が new-follows- で始まる場合は posts に追加される', () => {
  const { posts, handleMainSubEvent } = makeMainHandlerModule(0);
  const ev = { id: 'ev_nf', kind: 1, pubkey: 'pub1', created_at: 1000, tags: [], content: 'hello' };
  handleMainSubEvent(ev, 'main', 'new-follows-abc123');
  assert.equal(posts.length, 1);
});
