'use strict';

/**
 * タイムライン空白バグに関するページネーション・ロジックのユニットテスト。
 *
 * relay.js / app.js はブラウザグローバルを大量に参照するため直接 require できない。
 * ここでは修正した純粋ロジックを抜き出して検証する。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ---- テスト対象ロジックの再現 ----

/** fetchOlderPosts 内で使う oldestTs の計算（kind=7 除外） */
function computeOldestTs(posts) {
  const feedPosts = posts.filter(p => p.kind === 1 || p.kind === 6);
  return feedPosts.length > 0
    ? Math.min(...feedPosts.map(p => p.created_at))
    : Math.min(...posts.map(p => p.created_at));
}

/** flushOlderPosts の重複排除ロジック */
function mergeBuffer(posts, pendingPosts, buffer) {
  const existingIds = new Set([...posts, ...pendingPosts].map(p => p.id));
  let added = 0;
  const result = [...posts];
  for (const e of buffer) {
    if (!existingIds.has(e.id)) {
      result.push(e);
      existingIds.add(e.id);
      added++;
    }
  }
  return { posts: result, added };
}

/** ライブイベント追加後の配列キャップ（limit * 2 → 1000） */
function capPosts(posts) {
  if (posts.length > 1000) return posts.slice(0, 1000);
  return posts;
}

// ---- ヘルパー ----

function makeEvent(id, kind, created_at) {
  return { id: String(id), kind, created_at };
}

// ---- computeOldestTs のテスト ----

test('computeOldestTs: kind=7 リアクションの古いタイムスタンプを無視する', () => {
  // kind=7 が ts=5、kind=1 が ts=100 → 5 ではなく 100 を返す
  const posts = [
    makeEvent('a', 1, 100),
    makeEvent('b', 7, 5),
  ];
  assert.equal(computeOldestTs(posts), 100);
});

test('computeOldestTs: kind=1 と kind=6 の最小値を返す', () => {
  const posts = [
    makeEvent('a', 1, 300),
    makeEvent('b', 6, 100),
    makeEvent('c', 1, 200),
    makeEvent('d', 7, 50),
  ];
  assert.equal(computeOldestTs(posts), 100);
});

test('computeOldestTs: kind=1/6 がない場合は全 kind の最小値にフォールバック', () => {
  const posts = [
    makeEvent('a', 7, 200),
    makeEvent('b', 7, 50),
  ];
  assert.equal(computeOldestTs(posts), 50);
});

test('computeOldestTs: kind=1 のみ 1件でも正しく動作する', () => {
  const posts = [makeEvent('a', 1, 999)];
  assert.equal(computeOldestTs(posts), 999);
});

test('computeOldestTs: 大量の kind=7 があっても kind=1 の最小値を返す', () => {
  const posts = [
    makeEvent('x', 1, 1000),
    ...Array.from({ length: 50 }, (_, i) => makeEvent(`r${i}`, 7, i)),
  ];
  assert.equal(computeOldestTs(posts), 1000);
});

// ---- mergeBuffer のテスト ----

test('mergeBuffer: posts にある ID は追加しない', () => {
  const posts = [makeEvent('a', 1, 100)];
  const { posts: result, added } = mergeBuffer(posts, [], [makeEvent('a', 1, 100)]);
  assert.equal(added, 0);
  assert.equal(result.length, 1);
});

test('mergeBuffer: pendingPosts にある ID は追加しない（修正後の動作）', () => {
  // 修正前: existingIds が pendingPosts を含まないため二重追加された
  const pending = [makeEvent('b', 1, 200)];
  const { posts: result, added } = mergeBuffer([], pending, [makeEvent('b', 1, 200)]);
  assert.equal(added, 0);
  assert.equal(result.length, 0);
});

test('mergeBuffer: 未知のイベントは追加される', () => {
  const posts = [makeEvent('a', 1, 100)];
  const buf = [makeEvent('z', 1, 50)];
  const { posts: result, added } = mergeBuffer(posts, [], buf);
  assert.equal(added, 1);
  assert.equal(result.length, 2);
});

test('mergeBuffer: バッファ内の重複を自身でも弾く', () => {
  const buf = [makeEvent('dup', 1, 100), makeEvent('dup', 1, 100)];
  const { added } = mergeBuffer([], [], buf);
  assert.equal(added, 1);
});

test('mergeBuffer: 混在バッファ（一部既知・一部新規）', () => {
  const posts = [makeEvent('known', 1, 100)];
  const pending = [makeEvent('pending', 1, 90)];
  const buf = [
    makeEvent('known',   1, 100),   // posts にあり
    makeEvent('pending', 1, 90),    // pendingPosts にあり
    makeEvent('new1',    1, 80),    // 新規
    makeEvent('new2',    6, 70),    // 新規
  ];
  const { posts: result, added } = mergeBuffer(posts, pending, buf);
  assert.equal(added, 2);
  const ids = result.map(p => p.id);
  assert.ok(ids.includes('new1'));
  assert.ok(ids.includes('new2'));
  assert.ok(!ids.includes('pending'));
});

test('mergeBuffer: 空バッファで added=0', () => {
  const { added } = mergeBuffer([makeEvent('a', 1, 100)], [], []);
  assert.equal(added, 0);
});

// ---- capPosts のテスト ----

test('capPosts: 1000件以下はそのまま', () => {
  const posts = Array.from({ length: 999 }, (_, i) => makeEvent(i, 1, i));
  assert.equal(capPosts(posts).length, 999);
});

test('capPosts: 1001件は1000件に切り詰める', () => {
  const posts = Array.from({ length: 1001 }, (_, i) => makeEvent(i, 1, 1001 - i));
  const result = capPosts(posts);
  assert.equal(result.length, 1000);
  // 先頭1000件が保持されている（最新順であれば古い方が消える）
  assert.equal(result[0].id, '0');
  assert.equal(result[999].id, '999');
});

test('capPosts: ちょうど1000件はカットしない', () => {
  const posts = Array.from({ length: 1000 }, (_, i) => makeEvent(i, 1, i));
  assert.equal(capPosts(posts).length, 1000);
});

// ---- until 境界のテスト ----

test('until: oldestTs を使えば同秒の別イベントも取得対象になる', () => {
  // until: oldestTs (inclusive) のシナリオを表現する。
  // oldestTs=100 のとき created_at===100 のイベントがフィルタに引っかかることを確認。
  const oldestTs = 100;

  // relay から返るイベント群（すべて created_at <= oldestTs）
  const relayResponse = [
    makeEvent('same-ts', 1, 100), // boundary のイベント
    makeEvent('older',   1, 90),
    makeEvent('oldest',  1, 80),
  ];

  const matching = relayResponse.filter(e => e.created_at <= oldestTs);
  assert.equal(matching.length, 3); // boundary 上のイベントも含まれる

  // until: oldestTs - 1 だと boundary 上のイベントが除外される（旧バグ）
  const matchingExclusive = relayResponse.filter(e => e.created_at < oldestTs);
  assert.equal(matchingExclusive.length, 2); // 'same-ts' が抜ける
});

test('until: oldestTs は kind=1/6 のみから計算し kind=7 に引きずられない', () => {
  // kind=7 リアクション（ts=10）と kind=1 投稿（ts=100）が混在する feed
  const posts = [
    makeEvent('post', 1, 100),
    makeEvent('reaction', 7, 10),
  ];

  const oldestTs = computeOldestTs(posts);
  assert.equal(oldestTs, 100); // 10 ではなく 100

  // until: 10 だと ts=10〜100 の種別1投稿が全部スキップされる（旧バグ）
  // until: 100 なら正しく ts<=100 のイベントを取得できる
  const relayCoverage = [makeEvent('gap-post', 1, 50)]; // ts=50 の投稿
  assert.ok(relayCoverage[0].created_at <= oldestTs); // 正しく取得対象
  assert.ok(relayCoverage[0].created_at > 10);        // 旧バグでは取得されなかった
});
