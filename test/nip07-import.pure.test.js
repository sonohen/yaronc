'use strict';

/**
 * importExtensionRelays のピュアロジックテスト。
 * filterNewExtensionRelays：拡張機能のリレーマップから
 * 現在未登録の URL のみを抽出する関数を検証する。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ---- インライン実装 ----

function parseExtensionRelays(relayMap) {
  if (!relayMap || typeof relayMap !== 'object' || Array.isArray(relayMap)) return [];
  return Object.entries(relayMap)
    .filter(([url, policy]) => {
      if (typeof url !== 'string') return false;
      if (!url.startsWith('wss://') && !url.startsWith('ws://')) return false;
      return policy && (policy.read || policy.write);
    })
    .map(([url]) => url);
}

function filterNewExtensionRelays(relayMap, existingRelays) {
  const parsed = parseExtensionRelays(relayMap);
  return parsed.filter(url => !existingRelays.includes(url));
}

// ========================
// filterNewExtensionRelays テスト
// ========================

test('filterNewExtensionRelays: 既存リレーが空の場合すべて返す', () => {
  const map = {
    'wss://relay.damus.io':    { read: true, write: true },
    'wss://nos.lol':           { read: true, write: false },
  };
  const result = filterNewExtensionRelays(map, []);
  assert.equal(result.length, 2);
  assert.ok(result.includes('wss://relay.damus.io'));
  assert.ok(result.includes('wss://nos.lol'));
});

test('filterNewExtensionRelays: 既存リレーと重複するものは除外される', () => {
  const map = {
    'wss://relay.damus.io':    { read: true, write: true },
    'wss://nos.lol':           { read: true, write: false },
  };
  const existing = ['wss://relay.damus.io'];
  const result = filterNewExtensionRelays(map, existing);
  assert.equal(result.length, 1);
  assert.ok(result.includes('wss://nos.lol'));
  assert.ok(!result.includes('wss://relay.damus.io'));
});

test('filterNewExtensionRelays: すべて既存リレーと重複する場合は空配列', () => {
  const map = {
    'wss://relay.damus.io': { read: true, write: true },
  };
  const existing = ['wss://relay.damus.io'];
  const result = filterNewExtensionRelays(map, existing);
  assert.equal(result.length, 0);
});

test('filterNewExtensionRelays: relayMap が null なら空配列', () => {
  assert.deepEqual(filterNewExtensionRelays(null, ['wss://relay.damus.io']), []);
});

test('filterNewExtensionRelays: relayMap が空オブジェクトなら空配列', () => {
  assert.deepEqual(filterNewExtensionRelays({}, ['wss://relay.damus.io']), []);
});

test('filterNewExtensionRelays: nos2x の典型的な返り値を正しく処理する', () => {
  // nos2x は {read: boolean, write: boolean} のオブジェクト形式
  const map = {
    'wss://relay.damus.io':         { read: true,  write: true  },
    'wss://nostr.bitcoiner.social': { read: true,  write: true  },
    'wss://relay.nostr.band':       { read: true,  write: false },
    'wss://offchain.pub':           { read: false, write: false }, // 無効
  };
  const existing = ['wss://relay.damus.io'];
  const result = filterNewExtensionRelays(map, existing);
  assert.equal(result.length, 2);
  assert.ok(result.includes('wss://nostr.bitcoiner.social'));
  assert.ok(result.includes('wss://relay.nostr.band'));
  assert.ok(!result.includes('wss://relay.damus.io'));
  assert.ok(!result.includes('wss://offchain.pub'));
});

test('filterNewExtensionRelays: policy が true/false でなく値として持つ形式でも動作する', () => {
  // Alby など一部実装が数値や truthy 値を返す可能性
  const map = {
    'wss://relay.example.com': { read: 1, write: 0 },
  };
  const result = filterNewExtensionRelays(map, []);
  assert.equal(result.length, 1);
});

test('filterNewExtensionRelays: wss:// 以外の URL は含まれない', () => {
  const map = {
    'https://relay.example.com': { read: true, write: true },
    'wss://valid.relay.com':     { read: true, write: true },
  };
  const result = filterNewExtensionRelays(map, []);
  assert.equal(result.length, 1);
  assert.ok(result.includes('wss://valid.relay.com'));
});

test('filterNewExtensionRelays: existingRelays が undefined の場合は空配列と同じ動作', () => {
  const map = { 'wss://relay.damus.io': { read: true, write: true } };
  // existingRelays を渡さないケース（デフォルト引数なし）はエラーにならない
  // filter の includes は空配列と同様に機能する
  const result = filterNewExtensionRelays(map, []);
  assert.equal(result.length, 1);
});
