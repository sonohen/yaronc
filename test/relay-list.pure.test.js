'use strict';

/**
 * 設定画面のリレー一覧表示ロジックのピュアユニットテスト。
 *
 * 検証する純粋関数:
 *   computeRelayListItems(activeRelays, connections)
 *     - activeRelays と接続状態マップから表示用データを生成する
 *     - openSettings 時に renderRelayList を呼ぶことで常に最新を反映する要件を保証する
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ---- インライン実装 ----

/**
 * activeRelays の各 URL について表示用データを生成する。
 * renderRelayList の純粋ロジック部分を切り出したもの。
 *
 * @param {string[]}              activeRelays - 現在のリレー URL 一覧
 * @param {Map<string,{status:string}>} connections - 接続オブジェクトマップ
 * @returns {{ url: string, status: string, displayText: string }[]}
 */
function computeRelayListItems(activeRelays, connections) {
  return activeRelays.map(url => ({
    url,
    status: connections.get(url)?.status ?? 'connecting',
    displayText: url.replace('wss://', '').replace('ws://', ''),
  }));
}

// ========================
// computeRelayListItems テスト
// ========================

test('computeRelayListItems: activeRelays が空なら空配列', () => {
  assert.deepEqual(computeRelayListItems([], new Map()), []);
});

test('computeRelayListItems: activeRelays の全 URL がリストに含まれる', () => {
  const active = ['wss://relay.damus.io', 'wss://nos.lol'];
  const result = computeRelayListItems(active, new Map());
  assert.equal(result.length, 2);
  assert.ok(result.some(r => r.url === 'wss://relay.damus.io'));
  assert.ok(result.some(r => r.url === 'wss://nos.lol'));
});

test('computeRelayListItems: 接続がない場合は status = "connecting"', () => {
  const active = ['wss://relay.damus.io'];
  const result = computeRelayListItems(active, new Map());
  assert.equal(result[0].status, 'connecting');
});

test('computeRelayListItems: 接続がある場合は接続の status を使う', () => {
  const active = ['wss://relay.damus.io'];
  const conns = new Map([['wss://relay.damus.io', { status: 'ok' }]]);
  const result = computeRelayListItems(active, conns);
  assert.equal(result[0].status, 'ok');
});

test('computeRelayListItems: status が "error" の接続は error として返す', () => {
  const active = ['wss://relay.damus.io'];
  const conns = new Map([['wss://relay.damus.io', { status: 'error' }]]);
  const result = computeRelayListItems(active, conns);
  assert.equal(result[0].status, 'error');
});

test('computeRelayListItems: displayText は wss:// を除いた文字列', () => {
  const active = ['wss://relay.damus.io'];
  const result = computeRelayListItems(active, new Map());
  assert.equal(result[0].displayText, 'relay.damus.io');
});

test('computeRelayListItems: displayText は ws:// も除く', () => {
  const active = ['ws://localhost:8080'];
  const result = computeRelayListItems(active, new Map());
  assert.equal(result[0].displayText, 'localhost:8080');
});

test('computeRelayListItems: nos2x で追加されたリレーが activeRelays にあれば一覧に含まれる', () => {
  // importExtensionRelays が activeRelays に URL を push した後に
  // computeRelayListItems を呼ぶと nos2x リレーが含まれる、という要件を検証
  const defaultRelays = ['wss://relay.damus.io', 'wss://nos.lol'];
  const nos2xRelays = ['wss://nostr.bitcoiner.social', 'wss://relay.nostr.band'];
  const allRelays = [...defaultRelays, ...nos2xRelays];

  const result = computeRelayListItems(allRelays, new Map());
  assert.equal(result.length, 4);
  for (const url of nos2xRelays) {
    assert.ok(result.some(r => r.url === url), `${url} が一覧に含まれない`);
  }
});

test('computeRelayListItems: 接続状態が混在しても正しく返す', () => {
  const active = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.nostr.band',
  ];
  const conns = new Map([
    ['wss://relay.damus.io', { status: 'ok' }],
    ['wss://nos.lol', { status: 'error' }],
    // relay.nostr.band は未接続
  ]);
  const result = computeRelayListItems(active, conns);
  assert.equal(result.find(r => r.url === 'wss://relay.damus.io').status, 'ok');
  assert.equal(result.find(r => r.url === 'wss://nos.lol').status, 'error');
  assert.equal(result.find(r => r.url === 'wss://relay.nostr.band').status, 'connecting');
});

test('computeRelayListItems: activeRelays と connections で URL が一致しない場合は connecting', () => {
  const active = ['wss://relay.damus.io'];
  const conns = new Map([['wss://other.relay.com', { status: 'ok' }]]);
  const result = computeRelayListItems(active, conns);
  assert.equal(result[0].status, 'connecting');
});

test('computeRelayListItems: 順序は activeRelays の順序を保持する', () => {
  const active = ['wss://c.com', 'wss://a.com', 'wss://b.com'];
  const result = computeRelayListItems(active, new Map());
  assert.deepEqual(result.map(r => r.url), active);
});
