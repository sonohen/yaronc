'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`Function not found: ${name}`);
  const bodyStart = src.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`Function end not found: ${name}`);
}

function makeElement() {
  const children = [];
  return {
    children,
    className: '',
    dataset: {},
    href: '',
    rel: '',
    target: '',
    textContent: '',
    title: '',
    style: {},
    appendChild(child) {
      children.push(child);
      return child;
    },
    querySelector() {
      return null;
    },
    addEventListener() {},
    get childElementCount() {
      return children.length;
    },
  };
}

function loadProfileModalModule() {
  const src = readFileSync(join(__dirname, '../app.js'), 'utf8');
  const functions = [
    extractFunction(src, 'openProfileModal'),
    extractFunction(src, 'showProfileSpinner'),
    extractFunction(src, 'fetchUserPosts'),
  ].join('\n');

  const timers = new Map();
  let nextTimerId = 1;

  const module = eval(`(function() {
    var profileLoadTimer = null;
    var profileSubId = null;
    var profileCurrentPubkey = null;
    var profileKindFilter = 'all';
    var profileEventCache = new Map();
    var PROFILE_EVENT_CACHE_MAX = 50;
    var profileCache = new Map();
    var nip05Cache = new Map();
    var posts = [];
    var connections = new Map();
    var limitSelect = { value: '60' };
    var WebSocket = { OPEN: 1 };

    var profileModalBody = {
      innerHTML: '',
      children: [],
      appendChild(child) {
        this.children.push(child);
        return child;
      },
    };
    var profileModal = {
      classList: {
        _classes: new Set(['hidden']),
        contains(c) { return this._classes.has(c); },
        remove(c) { this._classes.delete(c); },
        add(c) { this._classes.add(c); },
      },
    };
    var profileModalPosts = {
      innerHTML: '',
      querySelector(selector) {
        if (selector === '.profile-posts-loading' && this.innerHTML.includes('profile-posts-loading')) {
          return {
            remove: () => { this.innerHTML = ''; },
          };
        }
        if (selector === '.profile-empty' && this.innerHTML.includes('profile-empty')) {
          return {
            remove: () => { this.innerHTML = ''; },
          };
        }
        return null;
      },
    };

    var document = {
      createElement: () => makeElement(),
      querySelectorAll: () => [],
    };

    function setTimeout(fn, ms) {
      const id = nextTimerId++;
      timers.set(id, { fn, ms });
      return id;
    }
    function clearTimeout(id) {
      timers.delete(id);
    }

    function shortPubkey(pk) { return pk.slice(0, 8) + '...' + pk.slice(-4); }
    function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function avatarWithBadge() { return makeElement(); }
    function verifyNip05() {}
    function renderProfilePosts() {
      if (!profileModalPosts.querySelector('.profile-posts-loading')) {
        profileModalPosts.innerHTML = '';
      }
    }

    ${functions}

    return {
      openProfileModal,
      profileModalPosts,
      timers,
      runTimers() {
        const pending = [...timers.values()];
        timers.clear();
        for (const timer of pending) timer.fn();
      },
    };
  })()`);

  return module;
}

test('openProfileModal: 投稿0件の場合はスピナーのタイマーが残り、空表示へ遷移する', () => {
  const m = loadProfileModalModule();

  m.openProfileModal('a'.repeat(64));

  assert.match(m.profileModalPosts.innerHTML, /profile-posts-loading/);
  assert.equal(m.timers.size, 1, 'fetchUserPosts が現在のスピナータイマーを消してはいけない');

  m.runTimers();

  assert.match(m.profileModalPosts.innerHTML, /投稿が見つかりませんでした/);
});
