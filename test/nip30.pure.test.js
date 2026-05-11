'use strict';

/**
 * NIP-30 カスタム絵文字の純粋ロジックユニットテスト。
 * extractCustomEmojis（タグ解析）と buildContentParts（テキスト分割）を
 * インライン実装して検証する。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ---- インライン実装 ----

function extractCustomEmojis(tags) {
  const map = new Map();
  for (const tag of tags) {
    if (tag[0] === 'emoji' && tag[1] && tag[2]) map.set(tag[1], tag[2]);
  }
  return map;
}

function buildContentParts(text, customEmojis = new Map()) {
  const parts = [];
  const SPLIT_RE = /(#[^\s#]+|nostr:(?:nprofile1|npub1)[a-z0-9]+|:[^:\s]+:)/gi;
  for (const part of text.split(SPLIT_RE)) {
    if (!part) continue;
    if (part.startsWith('#') && part.length > 1) {
      parts.push({ type: 'hashtag', value: part });
    } else if (/^nostr:(?:nprofile1|npub1)/i.test(part)) {
      parts.push({ type: 'mention', value: part });
    } else if (/^:[^:\s]+:$/.test(part) && customEmojis.has(part.slice(1, -1))) {
      const shortcode = part.slice(1, -1);
      parts.push({ type: 'emoji', shortcode, url: customEmojis.get(shortcode) });
    } else {
      parts.push({ type: 'text', value: part });
    }
  }
  return parts;
}

// ========================
// extractCustomEmojis テスト
// ========================

test('extractCustomEmojis: emoji タグから Map を構築する', () => {
  const tags = [['emoji', 'nattou', 'https://example.com/nattou.png']];
  const map = extractCustomEmojis(tags);
  assert.equal(map.size, 1);
  assert.equal(map.get('nattou'), 'https://example.com/nattou.png');
});

test('extractCustomEmojis: 複数の emoji タグをすべて登録する', () => {
  const tags = [
    ['emoji', 'nattou', 'https://example.com/nattou.png'],
    ['emoji', 'sushi',  'https://example.com/sushi.png'],
  ];
  const map = extractCustomEmojis(tags);
  assert.equal(map.size, 2);
  assert.equal(map.get('nattou'), 'https://example.com/nattou.png');
  assert.equal(map.get('sushi'),  'https://example.com/sushi.png');
});

test('extractCustomEmojis: emoji 以外のタグは無視する', () => {
  const tags = [
    ['p', 'somepubkey'],
    ['e', 'someeventid'],
    ['emoji', 'nattou', 'https://example.com/nattou.png'],
  ];
  const map = extractCustomEmojis(tags);
  assert.equal(map.size, 1);
  assert.ok(map.has('nattou'));
});

test('extractCustomEmojis: url がない不完全タグは無視する', () => {
  const tags = [['emoji', 'nattou']];
  const map = extractCustomEmojis(tags);
  assert.equal(map.size, 0);
});

test('extractCustomEmojis: タグが空なら空 Map を返す', () => {
  const map = extractCustomEmojis([]);
  assert.equal(map.size, 0);
});

// ========================
// buildContentParts テスト
// ========================

test('buildContentParts: プレーンテキストは text パートになる', () => {
  const parts = buildContentParts('こんにちは');
  assert.deepEqual(parts, [{ type: 'text', value: 'こんにちは' }]);
});

test('buildContentParts: 登録済み絵文字は emoji パートになる', () => {
  const emojis = new Map([['nattou', 'https://example.com/nattou.png']]);
  const parts = buildContentParts(':nattou:', emojis);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, 'emoji');
  assert.equal(parts[0].shortcode, 'nattou');
  assert.equal(parts[0].url, 'https://example.com/nattou.png');
});

test('buildContentParts: 未登録の :shortcode: はテキストとして扱う', () => {
  const emojis = new Map();
  const parts = buildContentParts(':unknown:', emojis);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, 'text');
  assert.equal(parts[0].value, ':unknown:');
});

test('buildContentParts: emoji Map なしの :shortcode: はテキストとして扱う', () => {
  const parts = buildContentParts(':nattou:');
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, 'text');
});

test('buildContentParts: ハッシュタグは hashtag パートになる', () => {
  const parts = buildContentParts('#nostr');
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, 'hashtag');
  assert.equal(parts[0].value, '#nostr');
});

test('buildContentParts: テキスト + 絵文字 + ハッシュタグの混在', () => {
  const emojis = new Map([['nattou', 'https://example.com/nattou.png']]);
  const parts = buildContentParts('納豆が好き :nattou: #food', emojis);
  const types = parts.map(p => p.type);
  assert.ok(types.includes('text'));
  assert.ok(types.includes('emoji'));
  assert.ok(types.includes('hashtag'));
  const emojiPart = parts.find(p => p.type === 'emoji');
  assert.equal(emojiPart.shortcode, 'nattou');
});

test('buildContentParts: 複数の絵文字を含むテキスト', () => {
  const emojis = new Map([
    ['nattou', 'https://example.com/nattou.png'],
    ['sushi',  'https://example.com/sushi.png'],
  ]);
  const parts = buildContentParts(':nattou: と :sushi:', emojis);
  const emojiParts = parts.filter(p => p.type === 'emoji');
  assert.equal(emojiParts.length, 2);
  assert.equal(emojiParts[0].shortcode, 'nattou');
  assert.equal(emojiParts[1].shortcode, 'sushi');
});

test('buildContentParts: スペースを含む :shortcode: はマッチしない', () => {
  const emojis = new Map([['nattou emoji', 'https://example.com/nattou.png']]);
  const parts = buildContentParts(':nattou emoji:');
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, 'text');
});

test('buildContentParts: 文頭の絵文字', () => {
  const emojis = new Map([['nattou', 'https://example.com/nattou.png']]);
  const parts = buildContentParts(':nattou: おいしい', emojis);
  assert.equal(parts[0].type, 'emoji');
  assert.equal(parts[0].shortcode, 'nattou');
});

test('buildContentParts: 文末の絵文字', () => {
  const emojis = new Map([['nattou', 'https://example.com/nattou.png']]);
  const parts = buildContentParts('おいしい :nattou:', emojis);
  const last = parts[parts.length - 1];
  assert.equal(last.type, 'emoji');
});

test('buildContentParts: nostr mention は mention パートになる', () => {
  const parts = buildContentParts('nostr:npub1abc123def456');
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, 'mention');
});
