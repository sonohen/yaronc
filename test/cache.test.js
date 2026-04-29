'use strict';

/**
 * cache.js のユニットテスト。
 * localStorage・location をモックして Node.js 上で実行する。
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const src = readFileSync(join(__dirname, '../js/cache.js'), 'utf8');

// ---- localStorage モック ----
function makeLocalStorage(initial = {}) {
  const store = { ...initial };
  return {
    store,
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    clear() { Object.keys(store).forEach(k => delete store[k]); },
  };
}

// ---- cache.js を IIFE で隔離ロード ----
function loadCache(localStorageData = {}, protocol = 'http:') {
  const ls = makeLocalStorage(localStorageData);
  // profileCacheMeta は cache.js 内で var 宣言されている → IIFE 経由で返す
  const result = eval(`(function() {
    var localStorage = ${JSON.stringify(null)}; // placeholder
    // Node に localStorage が存在しないため注入
    var location = { protocol: '${protocol}' };
    var profileCache;    // var: 後から代入される
    var profileCacheMeta;
    var nip05Cache;
    var activeRelays;

    // 差し替え: eval スコープの localStorage を使う
    const _ls = (${makeLocalStorage.toString()})(${JSON.stringify(localStorageData)});
    localStorage = _ls;

    ${src}

    return {
      loadRelays, saveRelays, loadProfileCache, saveProfileCache,
      loadNip05Cache, saveNip05Cache,
      activeRelays, profileCache, profileCacheMeta, nip05Cache,
      _ls,
    };
  })()`);
  return result;
}

// ---- loadRelays ----

test('loadRelays: localStorage が空なら DEFAULT_RELAYS を返す', () => {
  const { activeRelays } = loadCache({});
  assert.ok(Array.isArray(activeRelays));
  assert.ok(activeRelays.includes('wss://relay.damus.io'));
  assert.ok(activeRelays.length >= 4);
});

test('loadRelays: 保存済みリレーを読み込む', () => {
  const saved = ['wss://relay.example.com', 'wss://relay2.example.com'];
  const { activeRelays } = loadCache({
    nostr_relays: JSON.stringify(saved),
  });
  assert.deepEqual(activeRelays, saved);
});

test('loadRelays: HTTPS 環境で ws:// を wss:// に昇格する', () => {
  const saved = ['ws://relay.example.com'];
  const { activeRelays } = loadCache({ nostr_relays: JSON.stringify(saved) }, 'https:');
  assert.ok(activeRelays[0].startsWith('wss://'));
});

test('loadRelays: HTTP 環境では ws:// をそのまま保持', () => {
  const saved = ['ws://relay.example.com'];
  const { activeRelays } = loadCache({ nostr_relays: JSON.stringify(saved) }, 'http:');
  assert.ok(activeRelays[0].startsWith('ws://'));
});

test('loadRelays: 不正な JSON は無視してデフォルトを返す', () => {
  const { activeRelays } = loadCache({ nostr_relays: 'invalid json' });
  assert.ok(activeRelays.includes('wss://relay.damus.io'));
});

// ---- saveRelays ----

test('saveRelays: activeRelays を localStorage に永続化する', () => {
  const { saveRelays, activeRelays, _ls } = loadCache({});
  activeRelays.push('wss://custom.relay.com');
  saveRelays();
  const saved = JSON.parse(_ls.getItem('nostr_relays'));
  assert.ok(saved.includes('wss://custom.relay.com'));
});

// ---- loadProfileCache ----

test('loadProfileCache: localStorage が空なら空 Map を返す', () => {
  const { profileCache } = loadCache({});
  assert.equal(profileCache.size, 0);
});

test('loadProfileCache: 有効な TTL 内のエントリをロードする', () => {
  const now = Date.now();
  const stored = {
    pk1: { ts: now - 1000, data: { name: 'Alice' } },
    pk2: { ts: now - 500,  data: { name: 'Bob' } },
  };
  const { profileCache } = loadCache({ nostr_profile_cache: JSON.stringify(stored) });
  assert.equal(profileCache.size, 2);
  assert.deepEqual(profileCache.get('pk1'), { name: 'Alice' });
});

test('loadProfileCache: TTL 超過（1日以上前）のエントリは除外', () => {
  const now = Date.now();
  const stored = {
    old: { ts: now - 86400 * 1000 - 1, data: { name: 'Old' } }, // 1日以上前
    fresh: { ts: now - 1000,            data: { name: 'Fresh' } },
  };
  const { profileCache } = loadCache({ nostr_profile_cache: JSON.stringify(stored) });
  assert.ok(!profileCache.has('old'));
  assert.ok(profileCache.has('fresh'));
});

test('loadProfileCache: 不正な JSON は空 Map を返す', () => {
  const { profileCache } = loadCache({ nostr_profile_cache: 'bad json' });
  assert.equal(profileCache.size, 0);
});

// ---- saveProfileCache ----

test('saveProfileCache: profileCache を localStorage に書き出す', () => {
  const { saveProfileCache, profileCache, _ls } = loadCache({});
  profileCache.set('pk1', { name: 'Alice' });
  saveProfileCache();
  const saved = JSON.parse(_ls.getItem('nostr_profile_cache'));
  assert.ok('pk1' in saved);
  assert.deepEqual(saved.pk1.data, { name: 'Alice' });
});

test('saveProfileCache: PROFILE_CACHE_MAX（300件）超過時に古いエントリを削除', () => {
  const { saveProfileCache, profileCache, _ls } = loadCache({});
  // 301 件挿入
  for (let i = 0; i < 301; i++) profileCache.set(`pk${i}`, { name: `User${i}` });
  saveProfileCache();
  const saved = JSON.parse(_ls.getItem('nostr_profile_cache'));
  assert.ok(Object.keys(saved).length <= 300);
});

// ---- loadNip05Cache ----

test('loadNip05Cache: 空の場合は空 Map', () => {
  const { nip05Cache } = loadCache({});
  assert.equal(nip05Cache.size, 0);
});

test('loadNip05Cache: TTL 内のエントリをロードする', () => {
  const now = Date.now();
  const stored = {
    'alice@example.com': { ts: now - 1000, data: { identifier: 'alice@example.com', pubkey: 'aaa' } },
  };
  const { nip05Cache } = loadCache({ nostr_nip05_cache: JSON.stringify(stored) });
  assert.ok(nip05Cache.has('alice@example.com'));
});

test('loadNip05Cache: TTL 超過エントリは除外', () => {
  const now = Date.now();
  const stored = {
    'old@example.com': { ts: now - 86400 * 1000 - 1, data: { identifier: 'old@example.com' } },
  };
  const { nip05Cache } = loadCache({ nostr_nip05_cache: JSON.stringify(stored) });
  assert.ok(!nip05Cache.has('old@example.com'));
});

// ---- saveNip05Cache ----

test('saveNip05Cache: 検証済みエントリのみ保存（pending/failed は除外）', () => {
  const { saveNip05Cache, nip05Cache, _ls } = loadCache({});
  nip05Cache.set('alice@example.com', { identifier: 'alice@example.com' });
  nip05Cache.set('bob@example.com', 'pending');
  nip05Cache.set('eve@example.com', 'failed');
  saveNip05Cache();
  const saved = JSON.parse(_ls.getItem('nostr_nip05_cache') || '{}');
  assert.ok('alice@example.com' in saved);
  assert.ok(!('bob@example.com' in saved));
  assert.ok(!('eve@example.com' in saved));
});
