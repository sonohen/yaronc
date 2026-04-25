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
const icMemCache = new Map(); // url → ObjectURL（またはフォールバック時は元の url）
const icPending  = new Map(); // url → Promise<src>（重複 fetch 防止）

// URL を指定して src 文字列（ObjectURL or 元 URL）を解決する Promise を返す。
// ・同一 URL のフェッチは icPending により1回に集約される
// ・fetch 失敗（CORS 拒否等）時は元 URL を L1 に記録し、以降の再フェッチを防ぐ
function icLoad(url) {
  if (!url) return Promise.resolve(url);

  // L1 ヒット
  if (icMemCache.has(url)) return Promise.resolve(icMemCache.get(url));

  // 同じ URL を既にフェッチ中なら同一 Promise を返す（重複リクエストなし）
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
      .catch(() => {
        // CORS 拒否など: 元 URL を L1 に記録して無限リトライを防ぐ
        icMemCache.set(url, url);
        return url;
      });
  }).catch(() => {
    icMemCache.set(url, url);
    return url;
  }).finally(() => {
    icPending.delete(url);
  });

  icPending.set(url, p); // 同期的に登録するので、後続の icLoad 呼び出しでヒットする
  return p;
}

// img 要素に URL をセットする。
// すでに icPending に登録済み（フェッチ中）の URL は img.src の重複セットをしない。
// - キャッシュ済み or フェッチ中 → Promise を待って src を1回だけセット
// - 初回リクエスト       → img.src = url で即表示、完了後に ObjectURL へ差し替え
function icSetSrc(imgEl, url) {
  if (!url) return;

  // キャッシュ済み or フェッチ中: img.src = url をセットせず結果を待つ
  if (icMemCache.has(url) || icPending.has(url)) {
    icLoad(url).then(src => {
      if (imgEl.isConnected) imgEl.src = src;
    });
    return;
  }

  // 初回リクエスト: 即表示しつつバックグラウンドでキャッシュを構築
  // この分岐は各 URL につき1回のみ通る（以降は icPending/icMemCache でガード）
  imgEl.src = url;
  icLoad(url).then(src => {
    if (src !== url && imgEl.isConnected) imgEl.src = src;
  });
}

// 起動時に期限切れエントリを掃除
icEvictExpired();
