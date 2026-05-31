'use strict';

/**
 * スクロール追従取得（ページサイズ）のピュアロジックテスト。
 *
 * 検証する純粋関数:
 *   computeAdaptiveLimit(targetTotal, relayCount)
 *     - 目標合計件数をリレー数で割り、1リレーあたりの limit を返す
 *     - 最小値は 5（少なすぎるとリレーから返ってこないことがある）
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ---- インライン実装 ----

const FEED_BATCH = 30; // 1スクロールあたりの目標取得件数

function computeAdaptiveLimit(targetTotal, relayCount) {
  return Math.max(5, Math.ceil(targetTotal / Math.max(1, relayCount)));
}

// ========================
// computeAdaptiveLimit テスト
// ========================

test('computeAdaptiveLimit: リレー1本のとき targetTotal そのまま', () => {
  assert.equal(computeAdaptiveLimit(30, 1), 30);
});

test('computeAdaptiveLimit: リレー4本のとき ceil(30/4)=8', () => {
  assert.equal(computeAdaptiveLimit(30, 4), 8);
});

test('computeAdaptiveLimit: リレー0本は1本扱いになる', () => {
  assert.equal(computeAdaptiveLimit(30, 0), 30);
});

test('computeAdaptiveLimit: 最小値は 5（少数リレーで大量でも下限を保つ）', () => {
  // 1リレーで targetTotal=3 → ceil(3/1)=3 → max(5,3)=5
  assert.equal(computeAdaptiveLimit(3, 1), 5);
});

test('computeAdaptiveLimit: リレー10本でも最小値 5 を下回らない', () => {
  // ceil(30/10)=3 → max(5,3)=5
  assert.equal(computeAdaptiveLimit(30, 10), 5);
});

test('computeAdaptiveLimit: リレー3本で target=30 → ceil(30/3)=10', () => {
  assert.equal(computeAdaptiveLimit(30, 3), 10);
});

// ========================
// FEED_BATCH を使ったシナリオ検証
// ========================

test('FEED_BATCH=30 / リレー4本 → 1リレーあたり 8 件（合計約 30 件）', () => {
  const perRelay = computeAdaptiveLimit(FEED_BATCH, 4);
  assert.equal(perRelay, 8);
  // 4リレー × 8 = 32 件（重複を除けばほぼ 30 件）
  assert.ok(perRelay * 4 >= FEED_BATCH);
});

test('FEED_BATCH=30 は旧デフォルト 200 より大幅に少ない', () => {
  const perRelayNew = computeAdaptiveLimit(FEED_BATCH, 4); // 8
  const perRelayOld = computeAdaptiveLimit(200, 4);         // 50
  assert.ok(perRelayNew < perRelayOld);
  assert.ok(perRelayOld / perRelayNew >= 6); // 6倍以上少なくなっている
});

test('スクロール時の limit は設定値に従う（例: 30件）', () => {
  // limitSelect.value = 30 のとき、4リレーで 8 件ずつ
  const scrollLimit = computeAdaptiveLimit(30, 4);
  assert.equal(scrollLimit, 8);
});

test('スクロール時の limit は設定値に従う（例: 50件）', () => {
  const scrollLimit = computeAdaptiveLimit(50, 4);
  assert.equal(scrollLimit, 13);
});
