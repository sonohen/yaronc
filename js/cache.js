'use strict';

// ---- Config ----
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.wine',
];

function loadRelays() {
  try {
    const saved = localStorage.getItem('nostr_relays');
    if (saved) {
      const relays = JSON.parse(saved);
      // HTTPS 環境では保存済みの ws:// を wss:// に昇格
      if (location.protocol === 'https:') {
        return relays.map(r => r.startsWith('ws://') ? 'wss://' + r.slice(5) : r);
      }
      return relays;
    }
  } catch (_) {}
  return [...DEFAULT_RELAYS];
}

function saveRelays() {
  localStorage.setItem('nostr_relays', JSON.stringify(activeRelays));
}

// var: shared across files
var activeRelays = loadRelays();

// ---- Profile cache (localStorage, TTL 1 day) ----
const PROFILE_CACHE_TTL = 86400 * 1000;
const PROFILE_CACHE_KEY = 'nostr_profile_cache';
const PROFILE_CACHE_MAX = 300; // 保存する最大エントリ数

// タイムスタンプ付きで管理（LRU: Map の挿入順 = 古い順）
// Map<pubkey, {data, ts}>
var profileCacheMeta = new Map();

function loadProfileCache() {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw);
    const now = Date.now();
    const m = new Map();
    // ts 昇順（古い順）でロードすることで Map の挿入順 = LRU 順になる
    const sorted = Object.entries(obj).sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
    for (const [k, v] of sorted) {
      if (now - v.ts < PROFILE_CACHE_TTL) {
        m.set(k, v.data);
        profileCacheMeta.set(k, v.ts);
      }
    }
    return m;
  } catch (_) { return new Map(); }
}

function saveProfileCache() {
  // エントリ数が上限を超えた場合は古い順（Map の先頭）から削除
  while (profileCache.size > PROFILE_CACHE_MAX) {
    const oldestKey = profileCache.keys().next().value;
    profileCache.delete(oldestKey);
    profileCacheMeta.delete(oldestKey);
  }
  const now = Date.now();
  const obj = {};
  for (const [k, v] of profileCache.entries()) {
    obj[k] = { ts: profileCacheMeta.get(k) || now, data: v };
  }
  // QuotaExceededError 時は半分ずつ削除して再試行
  for (let limit = Object.keys(obj).length; limit >= 1; limit = Math.floor(limit / 2)) {
    try {
      const entries = Object.entries(obj).slice(-limit); // 最新 limit 件を保持
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
      return;
    } catch (_) { /* QuotaExceededError → 件数を減らして再試行 */ }
  }
}

// var: shared across files
var profileCache = loadProfileCache();

// ---- NIP-05 cache (localStorage, TTL 1 day) ----
const NIP05_CACHE_KEY = 'nostr_nip05_cache';
const NIP05_CACHE_MAX = 300;

function loadNip05Cache() {
  try {
    const raw = localStorage.getItem(NIP05_CACHE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw);
    const now = Date.now();
    const m = new Map();
    for (const [k, v] of Object.entries(obj)) {
      if (now - v.ts < PROFILE_CACHE_TTL) m.set(k, v.data);
    }
    return m;
  } catch (_) { return new Map(); }
}

function saveNip05Cache() {
  const now = Date.now();
  const entries = [];
  for (const [k, v] of nip05Cache.entries()) {
    if (v !== 'pending' && v !== 'failed') entries.push([k, { ts: now, data: v }]);
  }
  // 上限超え時は古い順（先頭）から削除
  const limited = entries.slice(-NIP05_CACHE_MAX);
  for (let limit = limited.length; limit >= 1; limit = Math.floor(limit / 2)) {
    try {
      localStorage.setItem(NIP05_CACHE_KEY, JSON.stringify(Object.fromEntries(limited.slice(-limit))));
      return;
    } catch (_) { /* QuotaExceededError → 件数を減らして再試行 */ }
  }
}

// var: shared across files
var nip05Cache = loadNip05Cache();
