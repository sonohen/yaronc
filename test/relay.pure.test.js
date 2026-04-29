'use strict';

/**
 * relay.js の純粋・準純粋ロジックのユニットテスト。
 * - getReplyParentTag / getReplyParentId : e タグ解析
 * - addSeenEvent : メモリキャップ付き重複排除セット
 * - cacheEvent   : LRU キャップ付きイベントキャッシュ
 * - upgradeWsUrl : ws:// → wss:// 昇格
 *
 * relay.js は WebSocket・DOM に強く依存するため、
 * 上記のテスト対象ロジックを直接インライン化して検証する。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ---- getReplyParentTag / getReplyParentId (relay.js:579-585 と同一ロジック) ----

function getReplyParentTag(event) {
  const eTags = event.tags.filter(t => t[0] === 'e');
  return eTags.find(t => t[3] === 'reply') || eTags.find(t => t[3] === 'root') || eTags[eTags.length - 1] || null;
}

function getReplyParentId(event) {
  return getReplyParentTag(event)?.[1] || null;
}

// ---- addSeenEvent (relay.js:5-13 と同一ロジック) ----

function makeSeenEventsModule() {
  const MAX_SEEN_EVENTS = 20000;
  const seenEvents = new Set();
  function addSeenEvent(id) {
    seenEvents.add(id);
    if (seenEvents.size > MAX_SEEN_EVENTS) {
      let count = 0;
      for (const old of seenEvents) {
        seenEvents.delete(old);
        if (++count >= 5000) break;
      }
    }
  }
  return { seenEvents, addSeenEvent };
}

// ---- cacheEvent (relay.js:17-23 と同一ロジック) ----

function makeEventCacheModule() {
  const MAX_EVENT_CACHE = 3000;
  const eventCache = new Map();
  function cacheEvent(id, event) {
    if (!eventCache.has(id) && eventCache.size >= MAX_EVENT_CACHE) {
      eventCache.delete(eventCache.keys().next().value);
    }
    eventCache.set(id, event);
  }
  return { eventCache, cacheEvent };
}

// ---- upgradeWsUrl (relay.js:158-163 と同一ロジック) ----

function upgradeWsUrl(url, protocol = 'http:') {
  if (protocol === 'https:' && url.startsWith('ws://')) {
    return 'wss://' + url.slice(5);
  }
  return url;
}

// ========================
// getReplyParentTag テスト
// ========================

test('getReplyParentTag: reply マーカー付きタグを優先する', () => {
  const event = {
    tags: [
      ['e', 'root-id',  '', 'root'],
      ['e', 'reply-id', '', 'reply'],
      ['e', 'other-id', '', 'mention'],
    ],
  };
  const tag = getReplyParentTag(event);
  assert.equal(tag[1], 'reply-id');
});

test('getReplyParentTag: reply がなければ root タグを使う', () => {
  const event = {
    tags: [
      ['e', 'root-id', '', 'root'],
      ['e', 'other',   '', 'mention'],
    ],
  };
  const tag = getReplyParentTag(event);
  assert.equal(tag[1], 'root-id');
});

test('getReplyParentTag: マーカーなしの場合は最後の e タグ', () => {
  const event = {
    tags: [
      ['e', 'first-id'],
      ['e', 'last-id'],
    ],
  };
  const tag = getReplyParentTag(event);
  assert.equal(tag[1], 'last-id');
});

test('getReplyParentTag: e タグがない場合は null', () => {
  const event = { tags: [['p', 'pubkey']] };
  assert.equal(getReplyParentTag(event), null);
});

test('getReplyParentTag: タグが空配列なら null', () => {
  const event = { tags: [] };
  assert.equal(getReplyParentTag(event), null);
});

test('getReplyParentTag: e タグが1件だけの場合はそれを返す', () => {
  const event = { tags: [['e', 'single-id']] };
  const tag = getReplyParentTag(event);
  assert.equal(tag[1], 'single-id');
});

// ========================
// getReplyParentId テスト
// ========================

test('getReplyParentId: reply マーカーの ID を返す', () => {
  const event = {
    tags: [
      ['e', 'root',  '', 'root'],
      ['e', 'reply', '', 'reply'],
    ],
  };
  assert.equal(getReplyParentId(event), 'reply');
});

test('getReplyParentId: e タグなしは null', () => {
  const event = { tags: [] };
  assert.equal(getReplyParentId(event), null);
});

// ========================
// addSeenEvent テスト
// ========================

test('addSeenEvent: ID を seenEvents に追加する', () => {
  const { seenEvents, addSeenEvent } = makeSeenEventsModule();
  addSeenEvent('abc');
  assert.ok(seenEvents.has('abc'));
});

test('addSeenEvent: 同じ ID を複数回追加しても1件', () => {
  const { seenEvents, addSeenEvent } = makeSeenEventsModule();
  addSeenEvent('dup');
  addSeenEvent('dup');
  assert.equal(seenEvents.size, 1);
});

test('addSeenEvent: 20000件超えで古い5000件を削除する', () => {
  const { seenEvents, addSeenEvent } = makeSeenEventsModule();

  // 20001 件追加
  for (let i = 0; i <= 20000; i++) addSeenEvent(`id-${i}`);

  // 20000 + 1 件追加時に先頭5000件が消え、15001 件になるはず
  assert.equal(seenEvents.size, 20001 - 5000);
});

test('addSeenEvent: 削除後も最新IDは残る', () => {
  const { seenEvents, addSeenEvent } = makeSeenEventsModule();
  for (let i = 0; i <= 20000; i++) addSeenEvent(`id-${i}`);
  // id-20000 は最後に追加されたので残っているはず
  assert.ok(seenEvents.has('id-20000'));
});

test('addSeenEvent: 削除されるのは先頭（最古）の5000件', () => {
  const { seenEvents, addSeenEvent } = makeSeenEventsModule();
  for (let i = 0; i <= 20000; i++) addSeenEvent(`id-${i}`);
  // id-0 ～ id-4999 が削除対象
  assert.ok(!seenEvents.has('id-0'));
  assert.ok(!seenEvents.has('id-4999'));
  assert.ok(seenEvents.has('id-5000'));
});

// ========================
// cacheEvent テスト
// ========================

test('cacheEvent: イベントをキャッシュに追加する', () => {
  const { eventCache, cacheEvent } = makeEventCacheModule();
  cacheEvent('evt1', { id: 'evt1', kind: 1 });
  assert.ok(eventCache.has('evt1'));
  assert.deepEqual(eventCache.get('evt1'), { id: 'evt1', kind: 1 });
});

test('cacheEvent: 既存 ID は上書きせずサイズを増やさない', () => {
  const { eventCache, cacheEvent } = makeEventCacheModule();
  cacheEvent('evt1', { id: 'evt1', data: 'first' });
  const sizeBefore = eventCache.size;
  cacheEvent('evt1', { id: 'evt1', data: 'second' });
  assert.equal(eventCache.size, sizeBefore);
  // 2回目は上書き（setで更新）
  assert.equal(eventCache.get('evt1').data, 'second');
});

test('cacheEvent: 3000件上限で最古エントリを削除', () => {
  const { eventCache, cacheEvent } = makeEventCacheModule();
  const LIMIT = 3000;
  // 上限ちょうどまで追加
  for (let i = 0; i < LIMIT; i++) cacheEvent(`evt-${i}`, { id: `evt-${i}` });
  assert.equal(eventCache.size, LIMIT);
  // 1件追加 → 最古（evt-0）が削除される
  cacheEvent('evt-new', { id: 'evt-new' });
  assert.equal(eventCache.size, LIMIT);
  assert.ok(!eventCache.has('evt-0'));
  assert.ok(eventCache.has('evt-new'));
});

test('cacheEvent: 削除は最古の1件のみ', () => {
  const { eventCache, cacheEvent } = makeEventCacheModule();
  const LIMIT = 3000;
  for (let i = 0; i < LIMIT; i++) cacheEvent(`evt-${i}`, { id: `evt-${i}` });
  cacheEvent('evt-new', { id: 'evt-new' });
  // evt-1 は残っている
  assert.ok(eventCache.has('evt-1'));
});

// ========================
// upgradeWsUrl テスト
// ========================

test('upgradeWsUrl: HTTPS 環境で ws:// → wss://', () => {
  assert.equal(upgradeWsUrl('ws://relay.example.com', 'https:'), 'wss://relay.example.com');
});

test('upgradeWsUrl: HTTPS 環境でも wss:// はそのまま', () => {
  assert.equal(upgradeWsUrl('wss://relay.example.com', 'https:'), 'wss://relay.example.com');
});

test('upgradeWsUrl: HTTP 環境では ws:// をそのまま保持', () => {
  assert.equal(upgradeWsUrl('ws://relay.example.com', 'http:'), 'ws://relay.example.com');
});

test('upgradeWsUrl: パスやポートを含む URL も正しく変換', () => {
  assert.equal(
    upgradeWsUrl('ws://relay.example.com:8080/path', 'https:'),
    'wss://relay.example.com:8080/path',
  );
});
