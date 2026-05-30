'use strict';

/**
 * NIP-07 window.nostr 拡張機能のピュアロジックユニットテスト。
 * parseExtensionRelays（getRelays() レスポンスの解析）を検証する。
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
      if (policy === null || policy === undefined || policy === false) return false;
      if (policy === true) return true;
      if (typeof policy === 'object') return policy.read || policy.write;
      return false;
    })
    .map(([url]) => url);
}

// ========================
// parseExtensionRelays テスト
// ========================

test('parseExtensionRelays: 空オブジェクトは空配列を返す', () => {
  assert.deepEqual(parseExtensionRelays({}), []);
});

test('parseExtensionRelays: null は空配列を返す', () => {
  assert.deepEqual(parseExtensionRelays(null), []);
});

test('parseExtensionRelays: undefined は空配列を返す', () => {
  assert.deepEqual(parseExtensionRelays(undefined), []);
});

test('parseExtensionRelays: 配列は空配列を返す', () => {
  assert.deepEqual(parseExtensionRelays([]), []);
});

test('parseExtensionRelays: read:true のリレーは含まれる', () => {
  const map = { 'wss://relay.example.com': { read: true, write: false } };
  const result = parseExtensionRelays(map);
  assert.ok(result.includes('wss://relay.example.com'));
});

test('parseExtensionRelays: write:true のリレーは含まれる', () => {
  const map = { 'wss://relay.example.com': { read: false, write: true } };
  const result = parseExtensionRelays(map);
  assert.ok(result.includes('wss://relay.example.com'));
});

test('parseExtensionRelays: read:true かつ write:true のリレーは含まれる', () => {
  const map = { 'wss://relay.example.com': { read: true, write: true } };
  const result = parseExtensionRelays(map);
  assert.equal(result.length, 1);
});

test('parseExtensionRelays: read:false かつ write:false のリレーは除外される', () => {
  const map = { 'wss://relay.example.com': { read: false, write: false } };
  const result = parseExtensionRelays(map);
  assert.equal(result.length, 0);
});

test('parseExtensionRelays: wss:// でない URL は除外される', () => {
  const map = { 'https://relay.example.com': { read: true, write: true } };
  const result = parseExtensionRelays(map);
  assert.equal(result.length, 0);
});

test('parseExtensionRelays: ws:// は許可される', () => {
  const map = { 'ws://relay.example.com': { read: true, write: false } };
  const result = parseExtensionRelays(map);
  assert.ok(result.includes('ws://relay.example.com'));
});

test('parseExtensionRelays: 複数のリレーをすべて返す', () => {
  const map = {
    'wss://relay.damus.io': { read: true, write: true },
    'wss://nos.lol':        { read: true, write: false },
    'wss://relay.nostr.band': { read: false, write: true },
  };
  const result = parseExtensionRelays(map);
  assert.equal(result.length, 3);
});

test('parseExtensionRelays: 無効なリレーと有効なリレーが混在する場合は有効なもののみ', () => {
  const map = {
    'wss://valid.relay.com':   { read: true, write: true },
    'https://invalid.com':     { read: true, write: true },
    'wss://disabled.relay.com': { read: false, write: false },
  };
  const result = parseExtensionRelays(map);
  assert.equal(result.length, 1);
  assert.ok(result.includes('wss://valid.relay.com'));
});

test('parseExtensionRelays: policy が null のエントリは除外される', () => {
  const map = { 'wss://relay.example.com': null };
  const result = parseExtensionRelays(map);
  assert.equal(result.length, 0);
});

test('parseExtensionRelays: URL のみが配列に入る', () => {
  const map = { 'wss://relay.example.com': { read: true, write: true } };
  const result = parseExtensionRelays(map);
  assert.equal(typeof result[0], 'string');
});

// nos2x が {url: boolean} 形式（非標準）で返す場合
test('parseExtensionRelays: policy が boolean true のリレーは含まれる', () => {
  const map = {
    'wss://r.kojira.io': true,
    'wss://yabu.me':     true,
  };
  const result = parseExtensionRelays(map);
  assert.equal(result.length, 2);
  assert.ok(result.includes('wss://r.kojira.io'));
  assert.ok(result.includes('wss://yabu.me'));
});

test('parseExtensionRelays: policy が boolean false のリレーは除外される', () => {
  const map = { 'wss://relay.example.com': false };
  const result = parseExtensionRelays(map);
  assert.equal(result.length, 0);
});

test('parseExtensionRelays: {read: boolean, write: boolean} と boolean true の混在を正しく処理する', () => {
  const map = {
    'wss://relay.damus.io':    { read: true, write: true },  // 標準形式
    'wss://r.kojira.io':       true,                          // boolean 形式
    'wss://disabled.relay.com': false,                         // 無効
    'wss://also-disabled.com': { read: false, write: false }, // 無効（標準）
  };
  const result = parseExtensionRelays(map);
  assert.equal(result.length, 2);
  assert.ok(result.includes('wss://relay.damus.io'));
  assert.ok(result.includes('wss://r.kojira.io'));
});
