'use strict';

/**
 * render.js の純粋関数（DOM非依存）のユニットテスト。
 * IIFE ラッパーでブラウザグローバルをスタブ化してロード。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const stubs = `
  function _makeEl() {
    const cl = { _s: new Set(), add(...c) { c.forEach(x=>this._s.add(x)); }, remove(...c) { c.forEach(x=>this._s.delete(x)); }, contains(c) { return this._s.has(c); }, toggle(c,f) { f===undefined?(this._s.has(c)?this._s.delete(c):this._s.add(c)):(f?this._s.add(c):this._s.delete(c)); } };
    const children = [];
    return { style:{}, dataset:{}, classList:cl, children, appendChild(ch){children.push(ch);return ch;}, prepend(ch){children.unshift(ch);}, after(){}, replaceWith(){}, remove(){}, querySelector(){return null;}, querySelectorAll(){return [];}, addEventListener(){}, innerHTML:'', textContent:'', src:'', href:'', alt:'', type:'', value:'', title:'', loading:'', placeholder:'', offsetHeight:0, nextSibling:null, firstChild:null, isConnected:false, setAttribute(){}, getAttribute(){return null;} };
  }
  const document = {
    createElement: () => _makeEl(),
    createTextNode: (t) => ({ textContent: t }),
    getElementById: () => null,
    querySelectorAll: () => [],
    head: { appendChild: () => {} },
    documentElement: { classList: { contains: () => false } },
    body: { appendChild: () => {} },
  };
  const window = { scrollY: 0, twttr: null };
  const IntersectionObserver = class { constructor() {} observe() {} unobserve() {} disconnect() {} };
  const requestAnimationFrame = () => {};
  const MutationObserver = class { constructor() {} observe() {} disconnect() {} };

  // グローバル状態スタブ
  var posts = [];
  var profileCache = new Map();
  var reactionMap = new Map();
  var replyMap = new Map();
  var pendingTargetCards = new Map();
  var mentionCallbacks = new Map();
  var nip05Cache = new Map();
  var eventCache = new Map();
  var searchQuery = '';
  var authorFilter = null;
  var loadingOlder = false;
  var kindFilter = 'all';
  var postListEl = { querySelector: () => null, querySelectorAll: () => [], innerHTML: '', prepend: () => {}, firstChild: null };
  var postCountEl = { textContent: '' };
  var rankingListEl = { innerHTML: '' };
  var drawerRanking = null;
  var drawer = { classList: { contains: () => true } };
  var bottomLoadingEl = { classList: { add: () => {}, remove: () => {} } };
  var loadingEl = { classList: { contains: () => false, add: () => {}, remove: () => {} } };
  var authorFilterBanner = { classList: { add: () => {}, remove: () => {} }, innerHTML: '', appendChild: () => {} };
  var limitSelect = { value: '50' };
  var profileModal = { classList: { contains: () => true } };
  var profileModalPosts = { innerHTML: '', appendChild: () => {}, querySelectorAll: () => [], firstChild: null, prepend: () => {} };

  // 他スクリプトから提供される関数スタブ
  function icLoad() { return Promise.resolve(''); }
  function icSetSrc() {}
  function fetchTargetEvent() {}
  function openProfileModal() {}
  function openImageViewer() {}
  function decodeMentionPubkey() { return ''; }
  function nostrRefToHex() { return ''; }
  function decodeNeventData() { return { id: '', relays: [] }; }
  function scheduleReplyFetch() {}
  function addReply() {}
  function updateCardRepliesInPlace() {}
  function resolveTargetCards() {}
  function setAuthorFilter() {}
  function clearAuthorFilter() {}
  function updateCardReactionsInPlace() {}
  function renderProfilePosts() {}
  function renderPosts() {}
`;

const src = readFileSync(join(__dirname, '../js/render.js'), 'utf8');
const m = eval(`(function() {
  ${stubs}
  ${src}
  return {
    shortPubkey, escHtml, timeAgo, formatDate, safeUrl, reactionLabel,
    youtubeVideoId, isGifUrl,
    extractImageUrls, extractTweetUrls, extractYoutubeUrls,
    extractNostrRefs, extractProfileRefs,
    textWithoutImageUrls, textWithoutMediaUrls,
  };
})()`);

// ---- shortPubkey ----

test('shortPubkey: 先頭8文字+...+末尾4文字', () => {
  const pk = 'abcdef12345678901234567890123456789012345678901234567890abcd1234';
  assert.equal(m.shortPubkey(pk), 'abcdef12...1234');
});

test('shortPubkey: 64文字の hex を正しく短縮する', () => {
  const pk = 'a'.repeat(64);
  assert.equal(m.shortPubkey(pk), 'aaaaaaaa...aaaa');
});

// ---- escHtml ----

test('escHtml: & < > " をエスケープする', () => {
  assert.equal(m.escHtml('a&b<c>d"e'), 'a&amp;b&lt;c&gt;d&quot;e');
});

test('escHtml: エスケープ不要な文字はそのまま', () => {
  assert.equal(m.escHtml('hello world'), 'hello world');
});

test('escHtml: 空文字列はそのまま', () => {
  assert.equal(m.escHtml(''), '');
});

test('escHtml: 複数回エスケープしない（1回だけ）', () => {
  assert.equal(m.escHtml('<script>'), '&lt;script&gt;');
});

// ---- timeAgo ----

test('timeAgo: 30秒前', () => {
  const ts = Math.floor(Date.now() / 1000) - 30;
  assert.equal(m.timeAgo(ts), '30秒前');
});

test('timeAgo: 5分前', () => {
  const ts = Math.floor(Date.now() / 1000) - 300;
  assert.equal(m.timeAgo(ts), '5分前');
});

test('timeAgo: 2時間前', () => {
  const ts = Math.floor(Date.now() / 1000) - 7200;
  assert.equal(m.timeAgo(ts), '2時間前');
});

test('timeAgo: 3日前', () => {
  const ts = Math.floor(Date.now() / 1000) - 86400 * 3;
  assert.equal(m.timeAgo(ts), '3日前');
});

test('timeAgo: ちょうど60秒は1分前', () => {
  const ts = Math.floor(Date.now() / 1000) - 60;
  assert.equal(m.timeAgo(ts), '1分前');
});

// ---- formatDate ----

test('formatDate: 数値を日付文字列に変換する', () => {
  const ts = 1700000000; // 2023-11-14 あたり
  const result = m.formatDate(ts);
  assert.ok(typeof result === 'string' && result.length > 0);
  assert.ok(result.includes('2023'));
});

// ---- safeUrl ----

test('safeUrl: https:// URL はそのまま返す', () => {
  assert.equal(m.safeUrl('https://example.com/img.jpg'), 'https://example.com/img.jpg');
});

test('safeUrl: http:// URL はそのまま返す', () => {
  assert.equal(m.safeUrl('http://example.com/img.jpg'), 'http://example.com/img.jpg');
});

test('safeUrl: javascript:// は null', () => {
  assert.equal(m.safeUrl('javascript://evil'), null);
});

test('safeUrl: data: は null', () => {
  assert.equal(m.safeUrl('data:image/png;base64,abc'), null);
});

test('safeUrl: 空文字列は null', () => {
  assert.equal(m.safeUrl(''), null);
});

test('safeUrl: null は null', () => {
  assert.equal(m.safeUrl(null), null);
});

test('safeUrl: undefined は null', () => {
  assert.equal(m.safeUrl(undefined), null);
});

// ---- reactionLabel ----

test('reactionLabel: + → 👍', () => {
  assert.equal(m.reactionLabel('+'), '👍');
});

test('reactionLabel: - → 👎', () => {
  assert.equal(m.reactionLabel('-'), '👎');
});

test('reactionLabel: 絵文字はそのまま', () => {
  assert.equal(m.reactionLabel('🔥'), '🔥');
});

test('reactionLabel: 空文字 → 👍（!content は + と同扱い）', () => {
  assert.equal(m.reactionLabel(''), '👍');
});

test('reactionLabel: カスタム絵文字 :name: → :name:', () => {
  assert.equal(m.reactionLabel(':custom_emoji:'), ':custom_emoji:');
});

// ---- youtubeVideoId ----

test('youtubeVideoId: watch?v= 形式', () => {
  assert.equal(m.youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});

test('youtubeVideoId: youtu.be/ 形式', () => {
  assert.equal(m.youtubeVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});

test('youtubeVideoId: &v= クエリ混在', () => {
  assert.equal(m.youtubeVideoId('https://www.youtube.com/watch?t=10&v=abc123'), 'abc123');
});

test('youtubeVideoId: 関係ない URL は null', () => {
  assert.equal(m.youtubeVideoId('https://example.com/video'), null);
});

// ---- isGifUrl ----

test('isGifUrl: .gif で終わる', () => {
  assert.ok(m.isGifUrl('https://example.com/anim.gif'));
});

test('isGifUrl: .gif? クエリ付き', () => {
  assert.ok(m.isGifUrl('https://example.com/anim.gif?width=100'));
});

test('isGifUrl: .GIF 大文字', () => {
  assert.ok(m.isGifUrl('https://example.com/anim.GIF'));
});

test('isGifUrl: .png は false', () => {
  assert.ok(!m.isGifUrl('https://example.com/img.png'));
});

test('isGifUrl: gif が URL パス中に含まれるだけは false', () => {
  assert.ok(!m.isGifUrl('https://example.com/gifted/img.png'));
});

// ---- extractImageUrls ----

test('extractImageUrls: jpg, png, gif, webp を抽出', () => {
  const text = 'こんにちは https://example.com/a.jpg https://example.com/b.png テスト';
  const urls = m.extractImageUrls(text);
  assert.equal(urls.length, 2);
  assert.ok(urls.includes('https://example.com/a.jpg'));
  assert.ok(urls.includes('https://example.com/b.png'));
});

test('extractImageUrls: 重複 URL は1つにまとめる', () => {
  const text = 'https://x.com/a.jpg https://x.com/a.jpg';
  assert.equal(m.extractImageUrls(text).length, 1);
});

test('extractImageUrls: 画像 URL がなければ空配列', () => {
  assert.deepEqual(m.extractImageUrls('テキストのみ'), []);
});

test('extractImageUrls: クエリパラメータ付き URL を正しく抽出', () => {
  const url = 'https://pbs.twimg.com/media/img.jpg?format=jpg&name=large';
  const result = m.extractImageUrls(`画像 ${url}`);
  assert.equal(result.length, 1);
  assert.ok(result[0].startsWith('https://pbs.twimg.com'));
});

test('extractImageUrls: avif と svg も抽出される', () => {
  const text = 'https://ex.com/a.avif https://ex.com/b.svg';
  const urls = m.extractImageUrls(text);
  assert.ok(urls.some(u => u.includes('.avif')));
  assert.ok(urls.some(u => u.includes('.svg')));
});

// ---- extractTweetUrls ----

test('extractTweetUrls: x.com/status URL を抽出', () => {
  const text = 'https://x.com/user/status/123456789012345678 参照';
  const urls = m.extractTweetUrls(text);
  assert.ok(urls.length > 0);
  assert.ok(urls[0].includes('x.com') || urls[0].includes('twitter.com'));
});

test('extractTweetUrls: 画像 URL は抽出しない', () => {
  const urls = m.extractTweetUrls('https://example.com/img.jpg');
  assert.equal(urls.length, 0);
});

// ---- extractYoutubeUrls ----

test('extractYoutubeUrls: youtube.com/watch URL を抽出', () => {
  const text = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ を見て';
  const urls = m.extractYoutubeUrls(text);
  assert.equal(urls.length, 1);
});

test('extractYoutubeUrls: youtu.be URL も抽出', () => {
  const text = 'https://youtu.be/dQw4w9WgXcQ';
  const urls = m.extractYoutubeUrls(text);
  assert.equal(urls.length, 1);
});

test('extractYoutubeUrls: 関係ない URL は空配列', () => {
  assert.deepEqual(m.extractYoutubeUrls('https://example.com'), []);
});

// ---- extractNostrRefs ----

test('extractNostrRefs: nostr:note1 を抽出', () => {
  const text = 'nostr:note1mm0dahk7mm0dahk7mm0dahk7mm0dahk7mm0dahk7mm0dahk7mm0q5rfpdv を引用';
  const refs = m.extractNostrRefs(text);
  assert.equal(refs.length, 1);
  assert.ok(refs[0].startsWith('nostr:note1'));
});

test('extractNostrRefs: nostr:nevent1 を抽出', () => {
  const text = 'nostr:nevent1mm0dahk7mm0dahk7mm0dahk7mm0dahk7mm0dahk7mm0dahk7mm0q5zy2ak';
  const refs = m.extractNostrRefs(text);
  assert.equal(refs.length, 1);
});

test('extractNostrRefs: nostr:npub1 は含まない（プロフィール用）', () => {
  const text = 'nostr:npub1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs8j9gdm';
  const refs = m.extractNostrRefs(text);
  assert.equal(refs.length, 0);
});

test('extractNostrRefs: 重複は1件にまとめる', () => {
  const ref = 'nostr:note1mm0dahk7mm0dahk7mm0dahk7mm0dahk7mm0dahk7mm0dahk7mm0q5rfpdv';
  assert.equal(m.extractNostrRefs(`${ref} ${ref}`).length, 1);
});

// ---- extractProfileRefs ----

test('extractProfileRefs: nostr:npub1 を抽出', () => {
  const text = 'nostr:npub1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs8j9gdm へ';
  const refs = m.extractProfileRefs(text);
  assert.equal(refs.length, 1);
  assert.ok(refs[0].startsWith('nostr:npub1'));
});

test('extractProfileRefs: nostr:note1 は含まない', () => {
  const text = 'nostr:note1mm0dahk7mm0dahk7mm0dahk7mm0dahk7mm0dahk7mm0dahk7mm0q5rfpdv';
  assert.equal(m.extractProfileRefs(text).length, 0);
});

// ---- textWithoutImageUrls ----

test('textWithoutImageUrls: URL をテキストから除去', () => {
  const url = 'https://example.com/img.jpg';
  const text = `テスト ${url} 終わり`;
  const result = m.textWithoutImageUrls(text, [url]);
  assert.ok(!result.includes(url));
  assert.ok(result.includes('テスト'));
  assert.ok(result.includes('終わり'));
});

test('textWithoutImageUrls: URL がなければそのまま', () => {
  assert.equal(m.textWithoutImageUrls('テキスト', []), 'テキスト');
});

test('textWithoutImageUrls: 3行以上の空行を2行に圧縮する', () => {
  const text = 'a\n\n\n\nb';
  const result = m.textWithoutImageUrls(text, []);
  assert.ok(!result.includes('\n\n\n'));
});

// ---- textWithoutMediaUrls ----

test('textWithoutMediaUrls: 画像・ツイート・nostrRef をすべて除去', () => {
  const imgUrl = 'https://example.com/img.png';
  const tweetUrl = 'https://x.com/u/status/1';
  const nostrRef = 'nostr:note1mm0dahk7mm0dahk7mm0dahk7mm0dahk7mm0dahk7mm0dahk7mm0q5rfpdv';
  const text = `本文 ${imgUrl} ${tweetUrl} ${nostrRef} 以上`;
  const result = m.textWithoutMediaUrls(text, [imgUrl], [tweetUrl], [nostrRef]);
  assert.ok(!result.includes(imgUrl));
  assert.ok(!result.includes(tweetUrl));
  assert.ok(!result.includes(nostrRef));
  assert.ok(result.includes('本文'));
  assert.ok(result.includes('以上'));
});

test('textWithoutMediaUrls: すべて空の場合はテキストそのまま', () => {
  assert.equal(m.textWithoutMediaUrls('本文', [], [], [], [], []), '本文');
});

test('textWithoutMediaUrls: YouTube URL も除去', () => {
  const yt = 'https://www.youtube.com/watch?v=abc123';
  const result = m.textWithoutMediaUrls(`見て ${yt}`, [], [], [], [yt]);
  assert.ok(!result.includes(yt));
  assert.ok(result.includes('見て'));
});
