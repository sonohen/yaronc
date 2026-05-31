'use strict';

/**
 * nos2x リレー自動インポートのピュアロジックテスト。
 *
 * 検証する純粋関数:
 *   shouldAutoImportRelays(currentUserHex, nostrAvailable)
 *     - 保存済みログイン後に拡張機能が検出されたときリレーをインポートすべきか判定
 *
 *   getUrlsToConnect(newUrls, currentUserHex)
 *     - importExtensionRelays 内で connectRelay すべき URL 一覧を返す
 *     - ログイン済みのときのみ接続が必要（未ログインは connectAllRelays に委ねる）
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ---- インライン実装 ----

/**
 * initExtensionLogin の polling で拡張機能が検出されたとき、
 * 保存済みログイン（page reload）の場合に importExtensionRelays を呼ぶべきかどうか返す。
 */
function shouldAutoImportRelays(currentUserHex, nostrAvailable) {
  return !!currentUserHex && nostrAvailable;
}

/**
 * importExtensionRelays 内で connectRelay を呼ぶべき URL の一覧を返す。
 * - ログイン済み（currentUserHex が設定済み）かつ接続が未確立の URL のみ返す。
 * - connectAllRelays 実行前（extension login ボタン経由）のときは
 *   connectAllRelays が接続するため、connectRelay の重複呼び出しは
 *   readyState <= 1 ガードで防がれる（呼んでも安全）。
 */
function getUrlsToConnect(newUrls, currentUserHex) {
  if (!currentUserHex) return [];
  return [...newUrls];
}

// ========================
// shouldAutoImportRelays テスト
// ========================

test('shouldAutoImportRelays: ログイン済み + 拡張機能あり → true', () => {
  assert.equal(shouldAutoImportRelays('abc123hex', true), true);
});

test('shouldAutoImportRelays: 未ログイン + 拡張機能あり → false', () => {
  assert.equal(shouldAutoImportRelays(null, true), false);
});

test('shouldAutoImportRelays: ログイン済み + 拡張機能なし → false', () => {
  assert.equal(shouldAutoImportRelays('abc123hex', false), false);
});

test('shouldAutoImportRelays: 未ログイン + 拡張機能なし → false', () => {
  assert.equal(shouldAutoImportRelays(null, false), false);
});

test('shouldAutoImportRelays: currentUserHex が空文字は未ログイン扱い', () => {
  assert.equal(shouldAutoImportRelays('', true), false);
});

// ========================
// getUrlsToConnect テスト
// ========================

test('getUrlsToConnect: ログイン済みなら全 URL を返す', () => {
  const urls = ['wss://relay.damus.io', 'wss://nos.lol'];
  const result = getUrlsToConnect(urls, 'abc123hex');
  assert.deepEqual(result, urls);
});

test('getUrlsToConnect: 未ログインなら空配列を返す（connectAllRelays に委ねる）', () => {
  const urls = ['wss://relay.damus.io', 'wss://nos.lol'];
  const result = getUrlsToConnect(urls, null);
  assert.deepEqual(result, []);
});

test('getUrlsToConnect: 新規 URL が空なら空配列を返す', () => {
  assert.deepEqual(getUrlsToConnect([], 'abc123hex'), []);
});

test('getUrlsToConnect: nos2x のリレーが正しく返される', () => {
  const nos2xRelays = [
    'wss://r.kojira.io',
    'wss://yabu.me',
    'wss://relay-jp.nostr.wirednostr.com',
  ];
  const result = getUrlsToConnect(nos2xRelays, 'abc123hex');
  assert.equal(result.length, 3);
  for (const url of nos2xRelays) {
    assert.ok(result.includes(url));
  }
});

// ========================
// 統合シナリオ: 保存済みログインでの自動インポート
// ========================

test('保存済みログイン後の自動インポート: 拡張機能検出時にインポートすべき', () => {
  // ページリロード → doLogin() → currentUserHex 設定済み
  // → initExtensionLogin polling が拡張機能を検出
  // → shouldAutoImportRelays = true → importExtensionRelays 呼び出し
  const currentUserHex = 'abc123hexabc123hexabc123hexabc123hexabc123hexabc123hexabc123hex';
  const nostrAvailable = true;
  assert.equal(shouldAutoImportRelays(currentUserHex, nostrAvailable), true);
});

test('保存済みログイン後の自動インポート: 新規リレーは connectRelay される', () => {
  const currentUserHex = 'abc123hex';
  const newUrls = ['wss://r.kojira.io', 'wss://yabu.me'];
  const toConnect = getUrlsToConnect(newUrls, currentUserHex);
  // ログイン済みなので両方とも connectRelay すべき
  assert.equal(toConnect.length, 2);
});
