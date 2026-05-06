'use strict';

/**
 * NIP-65 Outbox モデルの純粋ロジックユニットテスト。
 * handleNip65Event (kind:10002 パース) と
 * applyOutboxModel のリレー→著者マップ構築ロジックをインライン化して検証する。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ---- インライン実装 ----

function upgradeWsUrl(url) {
  // テスト環境は https: でないため昇格しない（ブラウザ依存なし版）
  return url;
}

function makeNip65Module() {
  const nip65Cache = new Map(); // pubkey → {write: string[], ts: number}

  function handleNip65Event(event) {
    const existing = nip65Cache.get(event.pubkey);
    if (existing && existing.ts >= event.created_at) return;
    const write = event.tags
      .filter(t => t[0] === 'r' && (!t[2] || t[2] === 'write'))
      .map(t => upgradeWsUrl(t[1]))
      .filter(u => u.startsWith('wss://') || u.startsWith('ws://'));
    nip65Cache.set(event.pubkey, { write, ts: event.created_at });
  }

  return { nip65Cache, handleNip65Event };
}

function buildRelayAuthorMap({ nip65Cache, followedPubkeys, activeRelays }) {
  const relayAuthorMap = new Map(); // relay → Set<pubkey>
  const coveredPubkeys = new Set();

  // 各ユーザーを primary write relay (先頭) のみに割り当て
  for (const pubkey of followedPubkeys) {
    const entry = nip65Cache.get(pubkey);
    if (!entry || entry.write.length === 0) continue;
    coveredPubkeys.add(pubkey);
    const primaryRelay = entry.write[0];
    if (!relayAuthorMap.has(primaryRelay)) relayAuthorMap.set(primaryRelay, new Set());
    relayAuthorMap.get(primaryRelay).add(pubkey);
  }

  // NIP-65 なしユーザーは全アクティブリレーへフォールバック
  const uncoveredPubkeys = [...followedPubkeys].filter(p => !coveredPubkeys.has(p));
  for (const url of activeRelays) {
    if (uncoveredPubkeys.length === 0) break;
    if (!relayAuthorMap.has(url)) relayAuthorMap.set(url, new Set());
    for (const p of uncoveredPubkeys) relayAuthorMap.get(url).add(p);
  }

  return relayAuthorMap;
}

// ========================
// handleNip65Event テスト
// ========================

test('kind:10002 の r タグからwriteリレーを抽出する', () => {
  const { nip65Cache, handleNip65Event } = makeNip65Module();
  const event = {
    id: 'ev1', kind: 10002, pubkey: 'alice', created_at: 1000,
    tags: [
      ['r', 'wss://relay.damus.io', 'write'],
      ['r', 'wss://nos.lol', 'write'],
      ['r', 'wss://inbox.example.com', 'read'],
    ],
    content: '',
  };
  handleNip65Event(event);
  const entry = nip65Cache.get('alice');
  assert.ok(entry, 'alice が登録される');
  assert.deepEqual(entry.write, ['wss://relay.damus.io', 'wss://nos.lol']);
});

test('マーカーなしの r タグは write として扱う（NIP-65 仕様）', () => {
  const { nip65Cache, handleNip65Event } = makeNip65Module();
  const event = {
    id: 'ev2', kind: 10002, pubkey: 'bob', created_at: 1000,
    tags: [['r', 'wss://relay.example.com']],
    content: '',
  };
  handleNip65Event(event);
  assert.deepEqual(nip65Cache.get('bob').write, ['wss://relay.example.com']);
});

test('read のみのタグは write に含まれない', () => {
  const { nip65Cache, handleNip65Event } = makeNip65Module();
  const event = {
    id: 'ev3', kind: 10002, pubkey: 'carol', created_at: 1000,
    tags: [['r', 'wss://relay.example.com', 'read']],
    content: '',
  };
  handleNip65Event(event);
  assert.deepEqual(nip65Cache.get('carol').write, []);
});

test('r タグがない場合 write は空配列', () => {
  const { nip65Cache, handleNip65Event } = makeNip65Module();
  const event = {
    id: 'ev4', kind: 10002, pubkey: 'dave', created_at: 1000,
    tags: [['p', 'someone']],
    content: '',
  };
  handleNip65Event(event);
  assert.deepEqual(nip65Cache.get('dave').write, []);
});

test('古いタイムスタンプのイベントは既存エントリを上書きしない', () => {
  const { nip65Cache, handleNip65Event } = makeNip65Module();
  const newer = {
    id: 'ev5a', kind: 10002, pubkey: 'eve', created_at: 2000,
    tags: [['r', 'wss://new-relay.com']],
    content: '',
  };
  const older = {
    id: 'ev5b', kind: 10002, pubkey: 'eve', created_at: 1000,
    tags: [['r', 'wss://old-relay.com']],
    content: '',
  };
  handleNip65Event(newer);
  handleNip65Event(older); // 古いので無視されるべき
  assert.deepEqual(nip65Cache.get('eve').write, ['wss://new-relay.com']);
});

test('同じタイムスタンプのイベントは既存を上書きしない', () => {
  const { nip65Cache, handleNip65Event } = makeNip65Module();
  const first = {
    id: 'ev6a', kind: 10002, pubkey: 'frank', created_at: 1000,
    tags: [['r', 'wss://first.com']],
    content: '',
  };
  const second = {
    id: 'ev6b', kind: 10002, pubkey: 'frank', created_at: 1000,
    tags: [['r', 'wss://second.com']],
    content: '',
  };
  handleNip65Event(first);
  handleNip65Event(second);
  assert.deepEqual(nip65Cache.get('frank').write, ['wss://first.com']);
});

test('新しいタイムスタンプのイベントは上書きする', () => {
  const { nip65Cache, handleNip65Event } = makeNip65Module();
  const old = {
    id: 'ev7a', kind: 10002, pubkey: 'grace', created_at: 1000,
    tags: [['r', 'wss://old.com']],
    content: '',
  };
  const newer = {
    id: 'ev7b', kind: 10002, pubkey: 'grace', created_at: 2000,
    tags: [['r', 'wss://new.com', 'write']],
    content: '',
  };
  handleNip65Event(old);
  handleNip65Event(newer);
  assert.deepEqual(nip65Cache.get('grace').write, ['wss://new.com']);
});

test('ws:// URL も write として登録される', () => {
  const { nip65Cache, handleNip65Event } = makeNip65Module();
  const event = {
    id: 'ev8', kind: 10002, pubkey: 'henry', created_at: 1000,
    tags: [['r', 'ws://relay.local']],
    content: '',
  };
  handleNip65Event(event);
  assert.deepEqual(nip65Cache.get('henry').write, ['ws://relay.local']);
});

test('http:// URL は write に含まれない（WebSocket でない）', () => {
  const { nip65Cache, handleNip65Event } = makeNip65Module();
  const event = {
    id: 'ev9', kind: 10002, pubkey: 'iris', created_at: 1000,
    tags: [
      ['r', 'https://not-a-websocket.com'],
      ['r', 'wss://valid.com'],
    ],
    content: '',
  };
  handleNip65Event(event);
  assert.deepEqual(nip65Cache.get('iris').write, ['wss://valid.com']);
});

// ========================
// buildRelayAuthorMap テスト
// ========================

test('NIP-65 あり: 各ユーザーは primary relay のみに登録される', () => {
  // alice の primary = relay-a.com、bob の primary = relay-b.com
  const nip65Cache = new Map([
    ['alice', { write: ['wss://relay-a.com', 'wss://relay-b.com'], ts: 1000 }],
    ['bob',   { write: ['wss://relay-b.com'], ts: 1000 }],
  ]);
  const map = buildRelayAuthorMap({
    nip65Cache,
    followedPubkeys: new Set(['alice', 'bob']),
    activeRelays: ['wss://relay-a.com'],
  });
  // alice は primary relay-a.com のみ（relay-b.com には入らない）
  assert.ok(map.has('wss://relay-a.com'));
  assert.ok(map.get('wss://relay-a.com').has('alice'));
  assert.ok(!map.get('wss://relay-a.com')?.has('bob'));

  // bob は primary relay-b.com のみ（relay-a.com には入らない）
  assert.ok(map.has('wss://relay-b.com'));
  assert.ok(map.get('wss://relay-b.com').has('bob'));
  assert.ok(!map.get('wss://relay-b.com').has('alice'));
});

test('NIP-65 なしユーザーは activeRelays にフォールバックする', () => {
  const nip65Cache = new Map(); // 誰も NIP-65 なし
  const map = buildRelayAuthorMap({
    nip65Cache,
    followedPubkeys: new Set(['alice', 'bob']),
    activeRelays: ['wss://relay-a.com', 'wss://relay-b.com'],
  });
  assert.ok(map.has('wss://relay-a.com'));
  assert.ok(map.get('wss://relay-a.com').has('alice'));
  assert.ok(map.get('wss://relay-a.com').has('bob'));
  assert.ok(map.has('wss://relay-b.com'));
  assert.ok(map.get('wss://relay-b.com').has('alice'));
  assert.ok(map.get('wss://relay-b.com').has('bob'));
});

test('NIP-65 あり・なし混在: それぞれ正しく振り分けられる', () => {
  const nip65Cache = new Map([
    ['alice', { write: ['wss://outbox.com'], ts: 1000 }],
    // bob は NIP-65 なし → activeRelays にフォールバック
  ]);
  const map = buildRelayAuthorMap({
    nip65Cache,
    followedPubkeys: new Set(['alice', 'bob']),
    activeRelays: ['wss://default.com'],
  });
  // alice は outbox.com のみ
  assert.ok(map.has('wss://outbox.com'));
  assert.ok(map.get('wss://outbox.com').has('alice'));
  assert.ok(!map.get('wss://outbox.com')?.has('bob'));

  // bob は default.com にフォールバック
  assert.ok(map.has('wss://default.com'));
  assert.ok(map.get('wss://default.com').has('bob'));
  // alice は default.com に追加されていない（NIP-65 ありのため）
  assert.ok(!map.get('wss://default.com').has('alice'));
});

test('write が空のユーザーはフォールバック扱いになる', () => {
  const nip65Cache = new Map([
    ['alice', { write: [], ts: 1000 }], // write リレーが空
  ]);
  const map = buildRelayAuthorMap({
    nip65Cache,
    followedPubkeys: new Set(['alice']),
    activeRelays: ['wss://fallback.com'],
  });
  assert.ok(map.has('wss://fallback.com'));
  assert.ok(map.get('wss://fallback.com').has('alice'));
});

test('フォロー外のユーザーはマップに含まれない', () => {
  const nip65Cache = new Map([
    ['alice', { write: ['wss://relay.com'], ts: 1000 }],
    ['outsider', { write: ['wss://relay.com'], ts: 1000 }],
  ]);
  const map = buildRelayAuthorMap({
    nip65Cache,
    followedPubkeys: new Set(['alice']), // outsider はフォローしていない
    activeRelays: [],
  });
  const authors = map.get('wss://relay.com');
  assert.ok(authors?.has('alice'));
  assert.ok(!authors?.has('outsider'));
});

// ========================
// per-author cap テスト
// ========================

function applyPerAuthorCap(posts, limit, followCount) {
  const cap = Math.max(3, Math.ceil(limit / Math.max(1, followCount)));
  const counts = new Map();
  return posts.filter(p => {
    const c = counts.get(p.pubkey) || 0;
    if (c >= cap) return false;
    counts.set(p.pubkey, c + 1);
    return true;
  });
}

test('per-author cap: 上限件数以上は除外される', () => {
  // 100フォロー、limit=200 → cap=max(3,2)=3
  const posts = Array.from({ length: 10 }, (_, i) => ({
    id: `e${i}`, pubkey: 'alice', created_at: 1000 - i,
  }));
  const result = applyPerAuthorCap(posts, 200, 100);
  assert.equal(result.length, 3);
});

test('per-author cap: 複数著者は各自上限まで表示される', () => {
  const posts = [
    ...Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, pubkey: 'alice', created_at: 1000 - i })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, pubkey: 'bob',   created_at:  900 - i })),
  ];
  // 2フォロー、limit=200 → cap=max(3,100)=100 → 全件通過
  const result = applyPerAuthorCap(posts, 200, 2);
  assert.equal(result.length, 20);
});

test('per-author cap: フォロー数が多いときは厳しく制限される', () => {
  // 100フォロー、limit=200 → cap=3
  const posts = Array.from({ length: 20 }, (_, i) => ({ id: `e${i}`, pubkey: 'heavy_user', created_at: 1000 - i }));
  const result = applyPerAuthorCap(posts, 200, 100);
  assert.equal(result.length, 3, '100フォロー時は著者あたり3件まで');
});

test('per-author cap: 大人数フォローのとき最小値 3件が保証される', () => {
  // 1000フォロー、limit=200 → cap=max(3,ceil(0.2))=3
  const posts = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, pubkey: 'user', created_at: 1000 - i }));
  const result = applyPerAuthorCap(posts, 200, 1000);
  assert.equal(result.length, 3, '1000フォロー時も最小値 3件は保証される');
});

test('per-author cap: フォロー数が少ないときは余裕がある', () => {
  // 5フォロー、limit=200 → cap=max(3,40)=40
  const posts = Array.from({ length: 30 }, (_, i) => ({ id: `e${i}`, pubkey: 'alice', created_at: 1000 - i }));
  const result = applyPerAuthorCap(posts, 200, 5);
  assert.equal(result.length, 30, '5フォローなら30件全部通る');
});
