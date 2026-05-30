'use strict';

/**
 * CONTACT_SUB EOSE ハンドリングのピュアロジックテスト。
 *
 * 検証する純粋関数:
 *   shouldShowContactError(received, expected, followCount, hasConnecting)
 *     - 全リレーから EOSE が届き、かつ接続中リレーがなく、フォローリストが空のときのみエラー表示
 *
 *   countOpenConnections(connections)
 *     - OPEN 状態の接続数を返す（fetchContactList で使用）
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ---- インライン実装 ----

const WS_CONNECTING = 0;
const WS_OPEN       = 1;
const WS_CLOSING    = 2;
const WS_CLOSED     = 3;

/**
 * CONTACT_SUB の EOSE が揃った時点でエラーを表示すべきか判定する。
 * @param {number}  received       - これまでに受信した EOSE 数
 * @param {number}  expected       - 送信先リレー数（0 は未送信）
 * @param {number}  followCount    - 現在のフォロー数
 * @param {boolean} hasConnecting  - まだ接続中のリレーが存在するか
 */
function shouldShowContactError(received, expected, followCount, hasConnecting) {
  if (expected <= 0) return false;          // まだ REQ を送信していない
  if (received < expected) return false;    // まだ全員から EOSE が来ていない
  if (hasConnecting) return false;          // 接続途中リレーが残っている
  return followCount === 0;                 // フォローリストが空ならエラー
}

/**
 * OPEN 状態の接続数を返す（fetchContactList で使用）。
 */
function countOpenConnections(connections) {
  let count = 0;
  for (const conn of connections.values()) {
    if (conn.ws && conn.ws.readyState === WS_OPEN) count++;
  }
  return count;
}

/**
 * 接続中（CONNECTING）のリレーが存在するか返す。
 */
function hasConnectingRelays(connections) {
  for (const conn of connections.values()) {
    if (conn.ws && conn.ws.readyState === WS_CONNECTING) return true;
  }
  return false;
}

// ========================
// shouldShowContactError テスト
// ========================

test('shouldShowContactError: expected=0（未送信）のときは false', () => {
  assert.equal(shouldShowContactError(0, 0, 0, false), false);
});

test('shouldShowContactError: received < expected のときは false', () => {
  assert.equal(shouldShowContactError(1, 3, 0, false), false);
});

test('shouldShowContactError: 接続中リレーが残っているときは false', () => {
  assert.equal(shouldShowContactError(3, 3, 0, true), false);
});

test('shouldShowContactError: フォローがある場合は false', () => {
  assert.equal(shouldShowContactError(3, 3, 5, false), false);
});

test('shouldShowContactError: 全 EOSE 受信・接続中なし・フォロー空 → true', () => {
  assert.equal(shouldShowContactError(3, 3, 0, false), true);
});

test('shouldShowContactError: received > expected でも条件を満たせば true', () => {
  // 万一 received がオーバーランしても表示する
  assert.equal(shouldShowContactError(4, 3, 0, false), true);
});

test('shouldShowContactError: expected=1 のとき 1 EOSE で判定する', () => {
  assert.equal(shouldShowContactError(1, 1, 0, false), true);
  assert.equal(shouldShowContactError(0, 1, 0, false), false);
});

// ========================
// countOpenConnections テスト
// ========================

test('countOpenConnections: 空の connections は 0', () => {
  assert.equal(countOpenConnections(new Map()), 0);
});

test('countOpenConnections: OPEN のみカウントされる', () => {
  const conns = new Map([
    ['wss://a', { ws: { readyState: WS_OPEN } }],
    ['wss://b', { ws: { readyState: WS_CONNECTING } }],
    ['wss://c', { ws: { readyState: WS_CLOSED } }],
  ]);
  assert.equal(countOpenConnections(conns), 1);
});

test('countOpenConnections: 複数 OPEN は正しくカウント', () => {
  const conns = new Map([
    ['wss://a', { ws: { readyState: WS_OPEN } }],
    ['wss://b', { ws: { readyState: WS_OPEN } }],
    ['wss://c', { ws: { readyState: WS_OPEN } }],
  ]);
  assert.equal(countOpenConnections(conns), 3);
});

test('countOpenConnections: ws が null のエントリは無視', () => {
  const conns = new Map([
    ['wss://a', { ws: null }],
    ['wss://b', { ws: { readyState: WS_OPEN } }],
  ]);
  assert.equal(countOpenConnections(conns), 1);
});

// ========================
// hasConnectingRelays テスト
// ========================

test('hasConnectingRelays: CONNECTING が存在すれば true', () => {
  const conns = new Map([
    ['wss://a', { ws: { readyState: WS_OPEN } }],
    ['wss://b', { ws: { readyState: WS_CONNECTING } }],
  ]);
  assert.equal(hasConnectingRelays(conns), true);
});

test('hasConnectingRelays: CONNECTING がなければ false', () => {
  const conns = new Map([
    ['wss://a', { ws: { readyState: WS_OPEN } }],
    ['wss://b', { ws: { readyState: WS_CLOSED } }],
  ]);
  assert.equal(hasConnectingRelays(conns), false);
});

test('hasConnectingRelays: 空の connections は false', () => {
  assert.equal(hasConnectingRelays(new Map()), false);
});

// ========================
// fetchContactList の sent=0 でリセットしない検証
// ========================

test('contactEoseExpected: sent=0 のリトライ時は既存の expected を保持すべき', () => {
  // fetchContactList の純粋ロジック：sent>0 のときだけ更新する
  function updateContactEose(sent, prevExpected, prevReceived) {
    if (sent > 0) {
      return { expected: sent, received: 0 };
    }
    return { expected: prevExpected, received: prevReceived };
  }

  // 初回 sent=0 → 変化なし
  let state = updateContactEose(0, 0, 0);
  assert.deepEqual(state, { expected: 0, received: 0 });

  // sent=2 で確定
  state = updateContactEose(2, 0, 0);
  assert.deepEqual(state, { expected: 2, received: 0 });

  // その後に sent=0 リトライが来ても上書きしない
  state = updateContactEose(0, 2, 1);
  assert.deepEqual(state, { expected: 2, received: 1 });
});
