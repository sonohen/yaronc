'use strict';

// ---- Image cache (IndexedDB + in-memory) ----
// プロフィール画像をローカルに保存し、リロード後もネットワーク不要で表示する。
//
// L1: セッション内メモリ（Map: URL → src 文字列）
// L2: IndexedDB（URL → Blob, TTL 7日）
// CORS 非対応サーバー向け: keeper div でプリロード → browser memory cache 経由

const IC_DB_NAME = 'nostr-img-cache';
const IC_STORE   = 'blobs';
const IC_VERSION = 1;
const IC_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7日

let _icDb = null;

function icOpenDb() {
  if (_icDb) return Promise.resolve(_icDb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IC_DB_NAME, IC_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IC_STORE))
        db.createObjectStore(IC_STORE, { keyPath: 'url' });
    };
    req.onsuccess  = e => { _icDb = e.target.result; resolve(_icDb); };
    req.onerror    = () => reject(req.error);
    req.onblocked  = () => reject(new Error('IDB blocked'));
  });
}

function icGet(url) {
  return icOpenDb().then(db => new Promise(resolve => {
    const req = db.transaction(IC_STORE, 'readonly')
                  .objectStore(IC_STORE).get(url);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror   = () => resolve(null);
  })).catch(() => null);
}

function icPut(url, blob) {
  icOpenDb().then(db => {
    const tx = db.transaction(IC_STORE, 'readwrite');
    tx.objectStore(IC_STORE).put({ url, blob, ts: Date.now() });
  }).catch(() => {});
}

// 期限切れエントリを削除（起動時に1回）
function icEvictExpired() {
  icOpenDb().then(db => {
    const tx   = db.transaction(IC_STORE, 'readwrite');
    const store = tx.objectStore(IC_STORE);
    const req  = store.openCursor();
    const cutoff = Date.now() - IC_MAX_AGE;
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) return;
      if (cursor.value.ts < cutoff) cursor.delete();
      cursor.continue();
    };
  }).catch(() => {});
}

// ---- keeper div ----
// CORS 非対応 URL をプリロードした <img> を DOM に保持し、
// browser の memory cache を維持するためのコンテナ。
let _icKeeper = null;
function icKeeper() {
  if (_icKeeper) return _icKeeper;
  _icKeeper = document.createElement('div');
  _icKeeper.style.cssText =
    'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;opacity:0';
  _icKeeper.setAttribute('aria-hidden', 'true');
  document.body.appendChild(_icKeeper);
  return _icKeeper;
}

// CORS が使えない URL を img 要素で1回だけプリロードし、
// browser memory cache に乗った後で url を返す Promise。
// ・icPending による集約があるため、このプリロードも URL ごとに1回だけ発生する。
// ・keeper div に img を保持することで memory cache の退避を防ぎ、
//   以降の img.src = url は Network タブに現れないメモリキャッシュから提供される。
function icPreloadFallback(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      icMemCache.set(url, url);
      resolve(url);
    };
    img.onerror = () => {
      // ロード失敗: keeper に残さず、フォールバック URL を記録して終了
      img.remove();
      icMemCache.set(url, url);
      resolve(url);
    };
    img.src = url; // ← ここで1回だけネットワークリクエスト
    icKeeper().appendChild(img);
  });
}

// ---- L1 / pending ----
const icMemCache = new Map(); // url → ObjectURL または元 URL（fallback）
const icPending  = new Map(); // url → Promise<src>（重複 fetch 防止）

// URL を src 文字列に解決する Promise を返す。
// 同一 URL は icPending で1つの Promise に集約されるため、
// fetch / preload は URL ごとに必ず1回しか発生しない。
function icLoad(url) {
  if (!url) return Promise.resolve(url);

  // L1 ヒット
  if (icMemCache.has(url)) return Promise.resolve(icMemCache.get(url));

  // フェッチ中 → 同じ Promise を返す（重複リクエストなし）
  if (icPending.has(url)) return icPending.get(url);

  const p = icGet(url)
    .then(entry => {
      // L2 ヒット（TTL 内）
      if (entry && entry.blob && (Date.now() - entry.ts) < IC_MAX_AGE) {
        const objUrl = URL.createObjectURL(entry.blob);
        icMemCache.set(url, objUrl);
        return objUrl;
      }
      // ネットワーク fetch（CORS 必須: blob を IDB に保存するため）
      return fetch(url, { mode: 'cors' })
        .then(res => {
          if (!res.ok) throw new Error('fetch failed');
          return res.blob();
        })
        .then(blob => {
          icPut(url, blob);
          const objUrl = URL.createObjectURL(blob);
          icMemCache.set(url, objUrl);
          return objUrl;
        })
        .catch(() => {
          // CORS 拒否など: img 要素で1回だけプリロードして memory cache に乗せる。
          // 全 pending 待ちカードはプリロード完了後に img.src = url → memory cache ヒット。
          return icPreloadFallback(url);
        });
    })
    .catch(() => icPreloadFallback(url)) // IDB open/read 失敗時も同様
    .finally(() => icPending.delete(url));

  icPending.set(url, p); // 同期的に登録 → 後続の呼び出しはこの Promise を待つ
  return p;
}

// img 要素に URL をセットする。
// ・キャッシュ済み or フェッチ中: img.src の重複セットをしない（重複リクエストなし）
// ・初回リクエスト: img.src = url で即表示 → 完了後に ObjectURL へ差し替え
function icSetSrc(imgEl, url) {
  if (!url) return;

  if (icMemCache.has(url) || icPending.has(url)) {
    icLoad(url).then(src => {
      if (imgEl.isConnected) imgEl.src = src;
    });
    return;
  }

  imgEl.src = url;
  icLoad(url).then(src => {
    if (src !== url && imgEl.isConnected) imgEl.src = src;
  });
}

// 起動時に期限切れエントリを掃除
icEvictExpired();
