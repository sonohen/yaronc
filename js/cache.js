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

function loadProfileCache() {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
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

function saveProfileCache() {
  try {
    const now = Date.now();
    const obj = {};
    for (const [k, v] of profileCache.entries()) obj[k] = { ts: now, data: v };
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(obj));
  } catch (_) {}
}

// var: shared across files
var profileCache = loadProfileCache();

// ---- NIP-05 cache (localStorage, TTL 1 day) ----
const NIP05_CACHE_KEY = 'nostr_nip05_cache';

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
  try {
    const now = Date.now();
    const obj = {};
    for (const [k, v] of nip05Cache.entries()) {
      if (v !== 'pending' && v !== 'failed') obj[k] = { ts: now, data: v };
    }
    localStorage.setItem(NIP05_CACHE_KEY, JSON.stringify(obj));
  } catch (_) {}
}

// var: shared across files
var nip05Cache = loadNip05Cache();
