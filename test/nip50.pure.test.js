'use strict';

/**
 * NIP-50 検索のピュアロジックユニットテスト。
 * buildSearchFilter（リレーへのフィルタ生成）と
 * mergeSearchResults（ローカル結果との結合・重複排除）を検証する。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ---- インライン実装 ----

function buildSearchFilter(query, limit = 50) {
  const q = (query || '').trim();
  if (!q) return null;
  return { kinds: [1], search: q, limit };
}

function mergeSearchResults(localPosts, relayResults, query) {
  const q = (query || '').toLowerCase().trim();
  const local = q
    ? localPosts.filter(p => p.content.toLowerCase().includes(q))
    : [];
  const seen = new Set(local.map(p => p.id));
  const merged = [...local];
  for (const p of relayResults) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      merged.push(p);
    }
  }
  return merged.sort((a, b) => b.created_at - a.created_at);
}

// ========================
// buildSearchFilter テスト
// ========================

test('buildSearchFilter: 空文字は null を返す', () => {
  assert.equal(buildSearchFilter(''), null);
});

test('buildSearchFilter: null は null を返す', () => {
  assert.equal(buildSearchFilter(null), null);
});

test('buildSearchFilter: 空白のみは null を返す', () => {
  assert.equal(buildSearchFilter('   '), null);
});

test('buildSearchFilter: クエリ文字列から正しいフィルタを生成する', () => {
  const filter = buildSearchFilter('nostr');
  assert.deepEqual(filter, { kinds: [1], search: 'nostr', limit: 50 });
});

test('buildSearchFilter: デフォルト limit は 50', () => {
  const filter = buildSearchFilter('test');
  assert.equal(filter.limit, 50);
});

test('buildSearchFilter: カスタム limit が反映される', () => {
  const filter = buildSearchFilter('test', 100);
  assert.equal(filter.limit, 100);
});

test('buildSearchFilter: 前後の空白が除去される', () => {
  const filter = buildSearchFilter('  bitcoin  ');
  assert.equal(filter.search, 'bitcoin');
});

test('buildSearchFilter: kinds は [1] を含む', () => {
  const filter = buildSearchFilter('hello');
  assert.deepEqual(filter.kinds, [1]);
});

test('buildSearchFilter: search フィールドにクエリが入る', () => {
  const filter = buildSearchFilter('納豆');
  assert.equal(filter.search, '納豆');
});

test('buildSearchFilter: ハッシュタグクエリもそのまま search フィールドへ', () => {
  const filter = buildSearchFilter('#nostr');
  assert.equal(filter.search, '#nostr');
});

// ========================
// mergeSearchResults テスト
// ========================

test('mergeSearchResults: ローカル一致投稿が含まれる', () => {
  const local = [
    { id: 'a', content: 'nostr is cool', created_at: 100 },
    { id: 'b', content: 'bitcoin news', created_at: 90 },
  ];
  const result = mergeSearchResults(local, [], 'nostr');
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'a');
});

test('mergeSearchResults: リレー結果が含まれる', () => {
  const relay = [{ id: 'x', content: 'relay result', created_at: 200 }];
  const result = mergeSearchResults([], relay, 'relay');
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'x');
});

test('mergeSearchResults: ローカルとリレー結果が合算される', () => {
  const local = [{ id: 'a', content: 'nostr local', created_at: 100 }];
  const relay = [{ id: 'b', content: 'nostr relay', created_at: 200 }];
  const result = mergeSearchResults(local, relay, 'nostr');
  assert.equal(result.length, 2);
});

test('mergeSearchResults: 同じ id は重複しない', () => {
  const local = [{ id: 'a', content: 'nostr', created_at: 100 }];
  const relay = [{ id: 'a', content: 'nostr', created_at: 100 }];
  const result = mergeSearchResults(local, relay, 'nostr');
  assert.equal(result.length, 1);
});

test('mergeSearchResults: created_at の降順でソートされる', () => {
  const local = [{ id: 'a', content: 'nostr', created_at: 100 }];
  const relay = [
    { id: 'b', content: 'nostr', created_at: 300 },
    { id: 'c', content: 'nostr', created_at: 200 },
  ];
  const result = mergeSearchResults(local, relay, 'nostr');
  assert.equal(result[0].id, 'b');
  assert.equal(result[1].id, 'c');
  assert.equal(result[2].id, 'a');
});

test('mergeSearchResults: クエリ空文字の場合はローカルフィルタなし・リレー結果のみ', () => {
  const local = [{ id: 'a', content: 'anything', created_at: 100 }];
  const relay = [{ id: 'b', content: 'relay', created_at: 200 }];
  const result = mergeSearchResults(local, relay, '');
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'b');
});

test('mergeSearchResults: ローカル結果はクエリと大文字小文字を区別しない', () => {
  const local = [{ id: 'a', content: 'NOSTR Protocol', created_at: 100 }];
  const result = mergeSearchResults(local, [], 'nostr');
  assert.equal(result.length, 1);
});

test('mergeSearchResults: リレー結果が空のときローカルフィルタのみ返す', () => {
  const local = [
    { id: 'a', content: 'nostr post', created_at: 100 },
    { id: 'b', content: 'bitcoin post', created_at: 90 },
  ];
  const result = mergeSearchResults(local, [], 'nostr');
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'a');
});

test('mergeSearchResults: ローカルが空のときリレー結果のみ返す', () => {
  const relay = [
    { id: 'x', content: 'from relay', created_at: 100 },
    { id: 'y', content: 'also relay', created_at: 200 },
  ];
  const result = mergeSearchResults([], relay, 'query');
  assert.equal(result.length, 2);
});
