'use strict';

// ---- Image cache (IndexedDB + in-memory) ----
// プロフィール画像をローカルに保存し、リロード後もネットワーク不要で表示する。
//
// L1: セッション内メモリ（Map: URL → ObjectURL）― 同一セッション内の重複 fetch を防ぐ
// L2: IndexedDB（URL → Blob + タイムスタンプ）― ページリロードをまたいで保持
// フォールバック: CORS 拒否・IDB 利用不可の場合は元の URL をそのまま使用

const IC_DB_NAME  = 'nostr-img-cache';
const IC_STORE    = 'blobs';
const IC_VERSION  = 1;
const IC_MAX_AGE  = 7 * 24 * 60 * 60 * 1000; // 7日

let _icDb = null;

// IndexedDB を開く（初回のみ）
function icOpenDb() {
  if (_icDb) return Promise.resolve(_icDb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IC_DB_NAME, IC_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IC_STORE)) {
        db.createObjectStore(IC_STORE, { keyPath: 'url' });
      }
    };
    req.onsuccess = e => { _icDb = e.target.result; resolve(_icDb); };
    req.onerror   = () => reject(req.error);
    req.onblocked = () => reject(new Error('IDB blocked'));
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

// 期限切れエントリを削除（起動時に1回呼ぶ）
function icEvictExpired() {
  icOpenDb().then(db => {
    const tx = db.transaction(IC_STORE, 'readwrite');
    const store = tx.objectStore(IC_STORE);
    const req = store.openCursor();
    const cutoff = Date.now() - IC_MAX_AGE;
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) return;
      if (cursor.value.ts < cutoff) cursor.delete();
      cursor.continue();
    };
  }).catch(() => {});
}

// L1: セッション内メモリ
const icMemCache = new Map(); // url → ObjectURL
const icPending  = new Map(); // url → Promise<src>（重複 fetch 防止）

// URL を指定して src 文字列（ObjectURL or 元 URL）を解決する Promise を返す
function icLoad(url) {
  if (!url) return Promise.resolve(url);

  // L1 ヒット
  if (icMemCache.has(url)) return Promise.resolve(icMemCache.get(url));

  // 同じ URL を既にフェッチ中なら同一 Promise を返す
  if (icPending.has(url)) return icPending.get(url);

  const p = icGet(url).then(entry => {
    // L2 ヒット（TTL 内）
    if (entry && entry.blob && (Date.now() - entry.ts) < IC_MAX_AGE) {
      const objUrl = URL.createObjectURL(entry.blob);
      icMemCache.set(url, objUrl);
      return objUrl;
    }
    // ネットワークから取得
    return fetch(url, { mode: 'cors' })
      .then(res => {
        if (!res.ok) throw new Error('fetch failed');
        return res.blob();
      })
      .then(blob => {
        icPut(url, blob);                          // L2 に保存（非同期）
        const objUrl = URL.createObjectURL(blob);
        icMemCache.set(url, objUrl);
        return objUrl;
      })
      .catch(() => url); // CORS 拒否など → 元 URL にフォールバック
  }).catch(() => url).finally(() => {
    icPending.delete(url);
  });

  icPending.set(url, p);
  return p;
}

// img 要素に URL をセットする。
// 即座に元 URL を設定し、キャッシュ解決後に ObjectURL へ差し替える。
function icSetSrc(imgEl, url) {
  if (!url) return;
  imgEl.src = url; // 表示を即開始（ネットワーク or ブラウザ HTTP キャッシュ）
  icLoad(url).then(src => {
    if (src === url) return;                       // フォールバックなら差し替え不要
    if (imgEl.isConnected) imgEl.src = src;        // DOM から外れていれば無視
  });
}

// 起動時に期限切れエントリを掃除
icEvictExpired();
