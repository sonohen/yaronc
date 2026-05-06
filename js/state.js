'use strict';

// ---- Mutable state (var = window property, shared across all scripts) ----
var posts = [];
var pendingPosts = [];
var olderPostsBuffer = [];
var searchQuery = '';
var kindFilter = localStorage.getItem('nostr_kind_filter') || 'all';
var authorFilter = null;
var currentUserHex = null;
var followedPubkeys = new Set();
var mainSubId = null;
var olderSubId = null;
var contactListTs = 0; // 現在のフォローリスト (kind:3) の created_at
var loadingOlder = false;
var olderEoseExpected = 0;
var olderEoseReceived = 0;

var eventCache = new Map();
var mentionCallbacks = new Map();
var seenEvents = new Set();
var connections = new Map();
var reactionMap = new Map();
var replyMap = new Map();
var pendingTargetCards = new Map();
var nip65Cache = new Map();       // pubkey → {write: string[], ts: number}
var outboxConnections = new Map(); // url → {ws, closing}

// Profile modal state
var profileSubId = null;
var profileCurrentPubkey = null;
var profileKindFilter = 'all';
var profileEventCache = new Map();
var profileLoadTimer = null; // スピナー自動消去タイマー

// Idle disconnect state
var idleMinutes = parseInt(localStorage.getItem('nostr_idle_timeout') || '0', 10);
var idleTimer = null;
var isIdleDisconnected = false;

// ---- DOM refs (var = window property, shared across all scripts) ----
var loginScreen    = document.getElementById('loginScreen');
var loginInput     = document.getElementById('loginInput');
var loginBtn       = document.getElementById('loginBtn');
var loginError     = document.getElementById('loginError');
var appHeader      = document.getElementById('appHeader');
var appMain        = document.getElementById('appMain');
var headerAvatar   = document.getElementById('headerAvatar');
var headerName     = document.getElementById('headerName');
var logoutBtn      = document.getElementById('logoutBtn');
var relayListEl    = document.getElementById('relayList');
var statusDot      = document.getElementById('statusDot');
var statusText     = document.getElementById('statusText');
var postListEl     = document.getElementById('postList');
var loadingEl      = document.getElementById('loadingIndicator');
var loadingText    = loadingEl.querySelector('p');
var postCountEl    = document.getElementById('postCount');
var authorFilterBanner  = document.getElementById('authorFilterBanner');
var newPostsBannerEl    = document.getElementById('newPostsBanner');
var feedBottomSentinel  = document.getElementById('feedBottomSentinel');
var bottomLoadingEl     = document.getElementById('bottomLoadingIndicator');
var limitSelect    = document.getElementById('limitSelect');
var searchInput    = document.getElementById('searchInput');
var searchBtn      = document.getElementById('searchBtn');
var searchClearBtn = document.getElementById('searchClear');
var modal          = document.getElementById('modal');
var modalBody      = document.getElementById('modalBody');
var modalClose     = document.getElementById('modalClose');
var modalBackdrop  = document.getElementById('modalBackdrop');
var rankingListEl  = document.getElementById('rankingList');

// Profile modal
var profileModal         = document.getElementById('profileModal');
var profileModalClose    = document.getElementById('profileModalClose');
var profileModalBackdrop = document.getElementById('profileModalBackdrop');
var profileModalBody     = document.getElementById('profileModalBody');
var profileModalPosts    = document.getElementById('profileModalPosts');

// Drawer / mobile
var hamburgerBtn     = document.getElementById('hamburgerBtn');
var drawer           = document.getElementById('drawer');
var drawerBackdrop   = document.getElementById('drawerBackdrop');
var drawerClose      = document.getElementById('drawerClose');
var drawerRanking    = document.getElementById('drawerRankingList');
var drawerAvatarWrap = document.getElementById('drawerAvatarWrap');
var drawerUserName   = document.getElementById('drawerUserName');
var drawerSettingsBtn = document.getElementById('drawerSettingsBtn');
var drawerLogout     = document.getElementById('drawerLogout');
var mobileFilterBar  = document.getElementById('mobileFilterBar');
var mobileRefreshBtn = document.getElementById('mobileRefreshBtn');

// Settings
var settingsModal        = document.getElementById('settingsModal');
var settingsBtn          = document.getElementById('settingsBtn');
var settingsModalClose   = document.getElementById('settingsModalClose');
var settingsModalBackdrop = document.getElementById('settingsModalBackdrop');
var themeToggle          = document.getElementById('themeToggle');
var idleTimeoutSelect    = document.getElementById('idleTimeoutSelect');
var idleStatusEl         = document.getElementById('idleStatus');
var fontSizeInput        = document.getElementById('fontSizeInput');
var fontSizeDownBtn      = document.getElementById('fontSizeDown');
var fontSizeUpBtn        = document.getElementById('fontSizeUp');
// Header search
var headerSearchInput    = document.getElementById('headerSearchInput');
var headerSearchClearBtn = document.getElementById('headerSearchClear');

// Relay add UI
var relayAddBtn  = document.getElementById('relayAddBtn');
var relayInputEl = document.getElementById('relayInput');
