// ==UserScript==
// @name         Apple Music Transfer
// @namespace    pinyht/apple-music-transfer
// @description  备份、导出与导入 Apple Music 资料库中的专辑、歌曲和播放列表，适用于跨账号、跨区服迁移及订阅中断后的资料库恢复。
// @author       pinyht
// @license      MIT
// @homepageURL  https://github.com/pinyht/apple-music-transfer
// @supportURL   https://github.com/pinyht/apple-music-transfer
// @version      1.0
// @match        https://music.apple.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  try {
    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }
  } catch {}

  const STORAGE_KEY = "__am_album_restore_tm_v4__";
  const STOREFRONT_KEY = "__am_album_restore_storefront__";
  const STOREFRONT_SWITCH_PENDING_KEY = "__am_album_restore_storefront_switch_pending__";
  const LANGUAGE_KEY = "__am_album_restore_language__";
  const LANGUAGE_SWITCH_PENDING_KEY = "__am_album_restore_language_switch_pending__";
  const EXPORT_ALBUMS_PENDING_RELOAD_KEY = "__am_export_albums_pending_reload_v1__";
  const EXPORT_SONGS_PENDING_RELOAD_KEY = "__am_export_songs_pending_reload_v1__";
  const LOG_STORAGE_KEY = "__am_album_restore_logs_v4__";
  const UI_STATE_STORAGE_KEY = "__am_album_restore_ui_state_v4__";
  const PANEL_POSITION_STORAGE_KEY = "__am_album_restore_panel_position_v4__";
  const PANEL_EXPANDED_WIDTH = 420;
  const PANEL_HIDDEN_WIDTH = 236;
  const EXPORT_RELOAD_MAX_ATTEMPTS = 2;
  const PLAYLIST_CREATION_SETTLE_MS = 3000;
  const TOOL_PANEL_Z_INDEX = 2147483000;
  const TOOL_OVERLAY_Z_INDEX = 2147483500;
  const TOOL_RESULT_Z_INDEX = 2147483501;
  const ADD_TO_LIBRARY_KEYWORDS = [
    "添加到资料库",
    "加入资料库",
    "添加到音乐资料库",
    "添加到資料庫",
    "加入資料庫",
    "添加到音樂資料庫",
    "Add to Library",
    "Add to library",
    "ライブラリに追加",
    "보관함에 추가"
  ];
  const REMOVE_FROM_LIBRARY_KEYWORDS = [
    "从资料库中删除",
    "从音乐资料库中删除",
    "从资料库删除",
    "從資料庫中刪除",
    "從音樂資料庫中刪除",
    "從資料庫刪除",
    "Remove from Library",
    "Delete from Library",
    "Remove from library",
    "ライブラリから削除",
    "보관함에서 삭제"
  ];
  const ADD_TO_PLAYLIST_KEYWORDS = [
    "添加到歌单",
    "添加到播放列表",
    "加入歌单",
    "加入播放列表",
    "添加到歌單",
    "加入歌單",
    "添加到播放清單",
    "加入播放清單",
    "Add to Playlist",
    "Add to playlist",
    "プレイリストに追加",
    "재생 목록에 추가",
    "플레이리스트에 추가"
  ];
  const NEW_PLAYLIST_KEYWORDS = [
    "新歌单",
    "新播放列表",
    "新歌單",
    "新播放清單",
    "New Playlist",
    "New playlist",
    "新しいプレイリスト",
    "新規プレイリスト",
    "새 플레이리스트",
    "새로운 플레이리스트"
  ];
  const ALBUMS_API_PATTERN = /amp-api\.music\.apple\.com\/v1\/me\/library\/albums/i;
  const SONGS_API_PATTERN = /amp-api\.music\.apple\.com\/v1\/me\/library\/songs/i;

  let currentRunToken = null;
  let activeAlbumsCaptureTracker = null;
  let albumsInterceptorRestore = null;
  let albumsInterceptorSilent = false;
  let activeSongsCaptureTracker = null;
  let songsInterceptorRestore = null;
  let songsInterceptorSilent = false;
  let bootstrapAlbumsTracker = null;
  let bootstrapSongsTracker = null;
  let bootStarted = false;
  const uiState = {
    detailsVisible: false,
    openMenu: null,
    activeAction: null,
    storefrontPickerVisible: false,
    languagePickerVisible: false
  };
  const exportAlbumsState = {
    running: false,
    phase: "idle",
    status: "待开始",
    current: "点击“开始导出专辑”后会自动刷新并继续执行。",
    testedScrollers: 0,
    totalScrollers: 0,
    capturedPages: 0,
    exportedCount: 0
  };
  const exportSongsState = {
    running: false,
    phase: "idle",
    status: "待开始",
    current: "点击“开始导出歌曲”后会自动刷新并继续执行。",
    testedScrollers: 0,
    totalScrollers: 0,
    capturedPages: 0,
    exportedCount: 0
  };
  const exportPlaylistsState = {
    running: false,
    phase: "idle",
    status: "待开始",
    current: "点击“开始导出播放列表”后会从当前页面抓取歌单顺序。",
    testedScrollers: 0,
    totalScrollers: 0,
    exportedCount: 0
  };
  const IMPORT_IDLE_PHASES = new Set(["idle", "completed", "stopped", "need-manual-check"]);
  const EXPORT_ACTIVE_PHASES = new Set(["reloading", "waiting-page", "preparing", "finding-scroller", "capturing"]);
  const STOREFRONT_OPTIONS = [
    ["us", "美国区"],
    ["cn", "中国大陆区"],
    ["jp", "日本区"],
    ["hk", "中国香港区"],
    ["tw", "中国台湾区"],
    ["sg", "新加坡区"],
    ["gb", "英国区"],
    ["kr", "韩国区"],
    ["ca", "加拿大区"],
    ["au", "澳大利亚区"],
    ["fr", "法国区"],
    ["de", "德国区"]
  ];
  const LANGUAGE_OPTIONS = [
    ["zh-Hans-CN", "简体中文"],
    ["zh-Hant-HK", "繁体中文(香港)"],
    ["zh-Hant-TW", "繁体中文(台湾)"],
    ["en", "英文"],
    ["ja", "日文"],
    ["ko", "韩文"]
  ];

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function formatChinaDateTime(value = new Date()) {
    const formatter = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });

    const parts = formatter.formatToParts(value);
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
  }

  function cleanText(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  function formatWholeNumber(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "0";
    return String(Math.round(num));
  }

  function normalize(s) {
    return cleanText(s)
      .toLowerCase()
      .normalize("NFKC")
      .replace(/[’']/g, "")
      .replace(/[()（）\[\]【】\-_,.:/\\!?]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getStorefrontFromUrl() {
    const m = location.pathname.match(/^\/([a-z]{2})(?:\/|$)/i);
    return m ? m[1].toLowerCase() : "";
  }

  function getSavedStorefront() {
    return localStorage.getItem(STOREFRONT_KEY) || "";
  }

  function setSavedStorefront(sf) {
    if (sf && /^[a-z]{2}$/i.test(sf)) {
      localStorage.setItem(STOREFRONT_KEY, sf.toLowerCase());
    }
  }

  function getPendingStorefrontSwitch() {
    return localStorage.getItem(STOREFRONT_SWITCH_PENDING_KEY) || "";
  }

  function setPendingStorefrontSwitch(sf) {
    if (sf && /^[a-z]{2}$/i.test(sf)) {
      localStorage.setItem(STOREFRONT_SWITCH_PENDING_KEY, sf.toLowerCase());
    }
  }

  function clearPendingStorefrontSwitch() {
    localStorage.removeItem(STOREFRONT_SWITCH_PENDING_KEY);
  }

  function normalizeLanguageCode(language) {
    const normalized = cleanText(language).toLowerCase();
    if (!normalized) return "";

    const map = {
      "zh-hans-cn": "zh-Hans-CN",
      "zh-cn": "zh-Hans-CN",
      "zh-hans": "zh-Hans-CN",
      "zh-hant-hk": "zh-Hant-HK",
      "zh-hk": "zh-Hant-HK",
      "zh-hant": "zh-Hant-TW",
      "zh-hant-tw": "zh-Hant-TW",
      "zh-tw": "zh-Hant-TW",
      "en": "en",
      "en-us": "en",
      "en-gb": "en",
      "ja": "ja",
      "ja-jp": "ja",
      "ko": "ko",
      "ko-kr": "ko"
    };

    return map[normalized] || cleanText(language);
  }

  function getSavedLanguage() {
    return normalizeLanguageCode(localStorage.getItem(LANGUAGE_KEY) || "");
  }

  function setSavedLanguage(language) {
    const normalized = normalizeLanguageCode(language);
    if (normalized) {
      localStorage.setItem(LANGUAGE_KEY, normalized);
    }
  }

  function getPendingLanguageSwitch() {
    return normalizeLanguageCode(localStorage.getItem(LANGUAGE_SWITCH_PENDING_KEY) || "");
  }

  function setPendingLanguageSwitch(language) {
    const normalized = normalizeLanguageCode(language);
    if (normalized) {
      localStorage.setItem(LANGUAGE_SWITCH_PENDING_KEY, normalized);
    }
  }

  function clearPendingLanguageSwitch() {
    localStorage.removeItem(LANGUAGE_SWITCH_PENDING_KEY);
  }

  function getPendingExportAlbumsReload() {
    return localStorage.getItem(EXPORT_ALBUMS_PENDING_RELOAD_KEY) || "";
  }

  function setPendingExportAlbumsReload(value = "1") {
    localStorage.setItem(EXPORT_ALBUMS_PENDING_RELOAD_KEY, value);
  }

  function clearPendingExportAlbumsReload() {
    localStorage.removeItem(EXPORT_ALBUMS_PENDING_RELOAD_KEY);
  }

  function getPendingExportSongsReload() {
    return localStorage.getItem(EXPORT_SONGS_PENDING_RELOAD_KEY) || "";
  }

  function setPendingExportSongsReload(value = "1") {
    localStorage.setItem(EXPORT_SONGS_PENDING_RELOAD_KEY, value);
  }

  function clearPendingExportSongsReload() {
    localStorage.removeItem(EXPORT_SONGS_PENDING_RELOAD_KEY);
  }

  function parsePendingExportReloadAttempt(value) {
    const attempt = Number.parseInt(String(value || "1"), 10);
    return Number.isFinite(attempt) && attempt > 0 ? attempt : 1;
  }

  function getStorefront() {
    return getSavedStorefront() || getStorefrontFromUrl() || "us";
  }

  function getLanguage() {
    return getSavedLanguage() || getCurrentLanguage() || "en";
  }

  function buildLibraryAlbumsUrl() {
    return buildLanguageAwareUrl(`https://music.apple.com/${getStorefront()}/library/albums`);
  }

  function buildAlbumUrl(albumId) {
    return buildLanguageAwareUrl(`https://music.apple.com/${getStorefront()}/album/${encodeURIComponent(cleanText(albumId || ""))}`);
  }

  function buildLibrarySongsUrl() {
    return buildLanguageAwareUrl(`https://music.apple.com/${getStorefront()}/library/songs`);
  }

  function buildSongUrl(songId) {
    return buildLanguageAwareUrl(`https://music.apple.com/${getStorefront()}/song/${encodeURIComponent(cleanText(songId || ""))}`);
  }

  function sanitizeFilename(value, fallback = "apple_music_playlist") {
    const sanitized = cleanText(value).replace(/[\\/:*?"<>|]/g, "_");
    return sanitized || fallback;
  }

  function getStorefrontLabel(sf) {
    const normalized = cleanText(sf).toLowerCase();
    const found = STOREFRONT_OPTIONS.find(([code]) => code === normalized);
    return found ? found[1] : `未知区服 (${normalized || "未设置"})`;
  }

  function getLanguageLabel(language) {
    const normalized = normalizeLanguageCode(language);
    const found = LANGUAGE_OPTIONS.find(([code]) => code === normalized);
    return found ? found[1] : `未知语言 (${normalized || "未设置"})`;
  }

  function ensureToolScopedStyles() {
    let style = document.getElementById("__am_tool_scoped_styles__");
    if (style) return style;

    style = document.createElement("style");
    style.id = "__am_tool_scoped_styles__";
    style.textContent = `
      #amr_panel,
      #amr_panel * {
        box-sizing: border-box !important;
      }

      #amr_panel {
        isolation: isolate !important;
      }

      #amr_panel button,
      #amr_panel input,
      #amr_panel textarea,
      #amr_panel select {
        font: inherit !important;
        letter-spacing: normal !important;
        text-transform: none !important;
      }

      #amr_panel button {
        appearance: none !important;
        -webkit-appearance: none !important;
      }

      #amr_panel .amr-picker-menu {
        display: grid;
        gap: 6px;
      }

      #amr_panel .amr-picker-option {
        display: block;
        width: 100%;
        padding: 7px 8px;
        border: none;
        border-radius: 8px;
        background: #2f2f34;
        color: #fff;
        font-size: 11px;
        line-height: 1.4;
        text-align: left;
        cursor: pointer;
      }

      #amr_panel .amr-picker-option:hover {
        background: #3a3a3c;
      }

      #amr_panel .amr-picker-placeholder {
        padding: 7px 8px;
        border-radius: 8px;
        background: #2a2a2f;
        color: #a1a1a6;
        font-size: 11px;
        line-height: 1.4;
      }

      #__am_processing_mask__,
      #__am_processing_mask__ *,
      #__am_import_result_mask__,
      #__am_import_result_mask__ * {
        box-sizing: border-box !important;
      }
    `;
    document.head.appendChild(style);
    return style;
  }

  function renderPickerMenu(container, options, type) {
    if (!container) return;

    container.innerHTML = `
      <div class="amr-picker-placeholder">请选择</div>
      <div class="amr-picker-menu">
        ${options.map(([code, label]) => {
          const attr = type === "storefront"
            ? `data-amr-storefront-option="${code}"`
            : `data-amr-language-option="${code}"`;
          return `<button type="button" class="amr-picker-option" ${attr}>${label} (${code})</button>`;
        }).join("")}
      </div>
    `;
  }

  function getStorefrontSummary() {
    const detected = getStorefrontFromUrl();
    const language = getCurrentLanguage();
    const languageLabel = language ? `${getLanguageLabel(language)} (${language})` : "未识别";
    const storefrontText = detected
      ? `当前区服：${getStorefrontLabel(detected)} (${detected})`
      : "当前区服：未识别";
    return `${storefrontText} | 当前语言：${languageLabel}`;
  }

  function getCurrentLanguage() {
    try {
      const url = new URL(location.href);
      const fromQuery = cleanText(url.searchParams.get("l") || "");
      if (fromQuery) return normalizeLanguageCode(fromQuery);
    } catch {}

    const htmlLang = normalizeLanguageCode(document.documentElement?.lang || "");
    if (htmlLang) return htmlLang;

    return "";
  }

  function isSimplifiedChineseLanguage(language) {
    return normalizeLanguageCode(language) === "zh-Hans-CN";
  }

  function buildLanguageAwareUrl(targetUrl = location.href, language = getLanguage()) {
    const url = new URL(targetUrl, location.origin);
    const normalized = normalizeLanguageCode(language);
    if (normalized) {
      url.searchParams.set("l", normalized);
    }
    return url.toString();
  }

  function switchPageLanguage(language) {
    const normalized = normalizeLanguageCode(language);
    if (!normalized) return;
    const current = getCurrentLanguage();
    if (normalizeLanguageCode(current) === normalized) {
      log(`当前页面已是 ${getLanguageLabel(normalized)} (${normalized})`);
      return;
    }

    setPendingLanguageSwitch(normalized);
    setSavedLanguage(normalized);
    const nextUrl = buildLanguageAwareUrl(location.href, normalized);
    log(`切换页面语言为 ${getLanguageLabel(normalized)} (${normalized})：${nextUrl}`);
    location.href = nextUrl;
  }

  function loadUIState() {
    try {
      const raw = localStorage.getItem(UI_STATE_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      uiState.detailsVisible = !!parsed?.detailsVisible;
      uiState.openMenu = parsed?.openMenu === "export" || parsed?.openMenu === "import"
        ? parsed.openMenu
        : null;
      uiState.activeAction = [
        "export-albums",
        "export-songs",
        "export-playlists",
        "import-albums",
        "import-songs",
        "import-playlists"
      ].includes(parsed?.activeAction)
        ? parsed.activeAction
        : null;
      uiState.storefrontPickerVisible = false;
      uiState.languagePickerVisible = false;

      if (!uiState.detailsVisible) {
        uiState.openMenu = null;
        uiState.activeAction = null;
        uiState.languagePickerVisible = false;
      } else if (uiState.activeAction) {
        uiState.openMenu = uiState.activeAction.startsWith("export-") ? "export" : "import";
      }
    } catch {
      uiState.detailsVisible = false;
      uiState.openMenu = null;
      uiState.activeAction = null;
      uiState.storefrontPickerVisible = false;
      uiState.languagePickerVisible = false;
    }
  }

  function saveUIState() {
    localStorage.setItem(UI_STATE_STORAGE_KEY, JSON.stringify({
      detailsVisible: uiState.detailsVisible,
      openMenu: uiState.openMenu,
      activeAction: uiState.activeAction
    }));
  }

  function loadPanelPosition() {
    try {
      const raw = localStorage.getItem(PANEL_POSITION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const hasLegacyLeft = typeof parsed?.left === "number";
      const hasRight = typeof parsed?.right === "number";
      if ((!hasLegacyLeft && !hasRight) || typeof parsed?.top !== "number") {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function savePanelPosition(position, width = PANEL_HIDDEN_WIDTH) {
    const left = Number.isFinite(position?.left)
      ? position.left
      : getDefaultPanelPosition(width).left;
    const top = Number.isFinite(position?.top) ? position.top : 16;
    const right = Math.max(16, window.innerWidth - left - width);

    localStorage.setItem(PANEL_POSITION_STORAGE_KEY, JSON.stringify({
      left,
      right,
      top
    }));
  }

  function getDefaultPanelPosition(width = PANEL_HIDDEN_WIDTH) {
    return {
      top: 16,
      left: Math.max(16, window.innerWidth - width - 16)
    };
  }

  function getPanelPositionSource(panel) {
    if (!panel?.dataset.positionInitialized) {
      return loadPanelPosition();
    }

    const left = parseFloat(panel.style.left);
    const top = parseFloat(panel.style.top);
    if (Number.isFinite(left) && Number.isFinite(top)) {
      return { left, top };
    }

    const rect = panel.getBoundingClientRect();
    if (Number.isFinite(rect.left) && Number.isFinite(rect.top)) {
      return { left: rect.left, top: rect.top };
    }

    return loadPanelPosition();
  }

  function applyPanelPosition(panel, options = {}) {
    if (!panel) return;

    const { persist = false, preferredRight = null } = options;
    const width = panel.offsetWidth || PANEL_HIDDEN_WIDTH;
    const height = panel.offsetHeight || 80;
    const source = getPanelPositionSource(panel) || getDefaultPanelPosition(width);
    const maxLeft = Math.max(16, window.innerWidth - width - 16);
    const maxTop = Math.max(16, window.innerHeight - height - 16);
    const sourceLeft = Number.isFinite(source?.left)
      ? source.left
      : (
        Number.isFinite(source?.right)
          ? window.innerWidth - source.right - width
          : getDefaultPanelPosition(width).left
      );
    const candidateLeft = Number.isFinite(preferredRight)
      ? preferredRight - width
      : sourceLeft;
    const left = Math.min(Math.max(16, candidateLeft), maxLeft);
    const top = Math.min(Math.max(16, source.top), maxTop);

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = "auto";
    panel.dataset.positionInitialized = "true";

    if (persist) {
      savePanelPosition({ left, top }, width);
    }

    return { left, top };
  }

  function initPanelDrag(panel) {
    const handle = panel.querySelector("#amr_drag_handle");
    if (!handle) return;

    let dragState = null;

    handle.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      if (event.target.closest("button, select, input, a")) return;

      const rect = panel.getBoundingClientRect();
      dragState = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
      };
      document.body.style.userSelect = "none";
    });

    document.addEventListener("mousemove", (event) => {
      if (!dragState) return;

      const width = panel.offsetWidth || PANEL_HIDDEN_WIDTH;
      const height = panel.offsetHeight || 80;
      const maxLeft = Math.max(16, window.innerWidth - width - 16);
      const maxTop = Math.max(16, window.innerHeight - height - 16);
      const left = Math.min(Math.max(16, event.clientX - dragState.offsetX), maxLeft);
      const top = Math.min(Math.max(16, event.clientY - dragState.offsetY), maxTop);

      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = "auto";
    });

    document.addEventListener("mouseup", () => {
      if (!dragState) return;
      dragState = null;
      document.body.style.userSelect = "";
      savePanelPosition({
        left: parseFloat(panel.style.left) || getDefaultPanelPosition(panel.offsetWidth).left,
        top: parseFloat(panel.style.top) || 16
      }, panel.offsetWidth || PANEL_HIDDEN_WIDTH);
    });
  }

  function updateExportAlbumsState(patch) {
    Object.assign(exportAlbumsState, patch);
    render();
  }

  function updateExportSongsState(patch) {
    Object.assign(exportSongsState, patch);
    render();
  }

  function updateExportPlaylistsState(patch) {
    Object.assign(exportPlaylistsState, patch);
    render();
  }

  function isExportAlbumsProcessing() {
    return !!getPendingExportAlbumsReload() || exportAlbumsState.running || EXPORT_ACTIVE_PHASES.has(exportAlbumsState.phase);
  }

  function isExportSongsProcessing() {
    return !!getPendingExportSongsReload() || exportSongsState.running || EXPORT_ACTIVE_PHASES.has(exportSongsState.phase);
  }

  function isExportPlaylistsProcessing() {
    return !!exportPlaylistsState.running;
  }

  function isExportAlbumsStopped() {
    return exportAlbumsState.phase === "stopped" || !exportAlbumsState.running;
  }

  function isExportSongsStopped() {
    return exportSongsState.phase === "stopped" || !exportSongsState.running;
  }

  function isExportPlaylistsStopped() {
    return exportPlaylistsState.phase === "stopped" || !exportPlaylistsState.running;
  }

  function stopExportAlbumsTask(logMessage = "已手动停止导出专辑任务") {
    clearPendingExportAlbumsReload();
    bootstrapAlbumsTracker = null;
    teardownAlbumsRequestInterceptor();
    updateExportAlbumsState({
      running: false,
      phase: "stopped",
      status: "已停止",
      current: "你已手动停止导出专辑任务。",
      testedScrollers: 0,
      totalScrollers: 0
    });
    logExportAlbums(logMessage);
  }

  function stopExportSongsTask(logMessage = "已手动停止导出歌曲任务") {
    clearPendingExportSongsReload();
    bootstrapSongsTracker = null;
    teardownSongsRequestInterceptor();
    updateExportSongsState({
      running: false,
      phase: "stopped",
      status: "已停止",
      current: "你已手动停止导出歌曲任务。",
      testedScrollers: 0,
      totalScrollers: 0
    });
    logExportSongs(logMessage);
  }

  function stopExportPlaylistsTask(logMessage = "已手动停止导出播放列表任务") {
    updateExportPlaylistsState({
      running: false,
      phase: "stopped",
      status: "已停止",
      current: "你已手动停止导出播放列表任务。",
      testedScrollers: 0,
      totalScrollers: 0
    });
    logExportPlaylists(logMessage);
  }

  function logExportAlbums(msg) {
    log(`[导出专辑] ${msg}`);
  }

  function logExportSongs(msg) {
    log(`[导出歌曲] ${msg}`);
  }

  function logExportPlaylists(msg) {
    log(`[导出播放列表] ${msg}`);
  }

  function download(filename, content, mime = "text/plain;charset=utf-8") {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function onLibraryAlbumsPage() {
    try {
      const url = new URL(location.href);
      return /\/library\/albums(?:\/|$)/i.test(url.pathname);
    } catch {
      return /\/library\/albums(?:\/|$)/i.test(location.pathname);
    }
  }

  function onLibrarySongsPage() {
    try {
      const url = new URL(location.href);
      return /\/library\/songs(?:\/|$)/i.test(url.pathname);
    } catch {
      return /\/library\/songs(?:\/|$)/i.test(location.pathname);
    }
  }

  function onPlaylistDetailPage() {
    try {
      const url = new URL(location.href);
      return /^\/(?:[a-z]{2}\/)?library\/playlist\/[^/?#]+$/i.test(url.pathname);
    } catch {
      return /^\/(?:[a-z]{2}\/)?library\/playlist\/[^/?#]+$/i.test(location.pathname);
    }
  }

  function toAbsoluteUrl(value) {
    try {
      return new URL(String(value || ""), location.origin).toString();
    } catch {
      return String(value || "");
    }
  }

  function getApiOffset(url) {
    try {
      const parsed = new URL(url);
      return parsed.searchParams.get("offset") || "0";
    } catch {
      return "0";
    }
  }

  function getPerformanceApiUrls(pattern) {
    try {
      const entries = performance.getEntriesByType("resource") || [];
      const urls = entries
        .map(entry => toAbsoluteUrl(entry?.name || ""))
        .filter(url => pattern.test(url));

      return Array.from(new Set(urls))
        .sort((a, b) => Number(getApiOffset(a)) - Number(getApiOffset(b)));
    } catch {
      return [];
    }
  }

  function buildPagedApiUrl(seedUrl, offset) {
    const url = new URL(seedUrl, location.origin);
    url.searchParams.set("offset", String(offset));
    if (!url.searchParams.get("limit")) {
      url.searchParams.set("limit", "100");
    }
    return url.toString();
  }

  async function fetchJsonWithCredentials(url) {
    const response = await fetch(url, {
      credentials: "include"
    });
    if (!response.ok) {
      throw new Error(`请求失败 ${response.status} ${response.statusText}`);
    }
    return await response.json();
  }

  async function hydrateSongsFromSeedUrls(tracker, seedUrls) {
    if (!seedUrls.length) return;

    logExportSongs(`发现历史 songs 请求 ${seedUrls.length} 条，先补抓已发生分页`);
    for (const url of seedUrls) {
      try {
        const payload = await fetchJsonWithCredentials(url);
        collectSongsFromPayload(tracker, url, payload);
        await sleep(120);
      } catch (error) {
        logExportSongs(`历史分页补抓失败：offset=${getApiOffset(url)} ｜ ${cleanText(error?.message || error)}`);
      }
    }
  }

  async function fillMissingSongsPages(tracker, seedUrl) {
    if (!seedUrl || !tracker.total) return;

    const pageSize = Math.max(1, Number(new URL(seedUrl, location.origin).searchParams.get("limit")) || 100);
    const knownOffsets = new Set(Array.from(tracker.pageUrls).map(pageKey => pageKey.split("::")[0]));

    for (let offset = 0; offset < tracker.total; offset += pageSize) {
      const offsetKey = String(offset);
      if (knownOffsets.has(offsetKey)) continue;

      const pageUrl = buildPagedApiUrl(seedUrl, offset);
      try {
        logExportSongs(`补抓缺失分页：offset=${offset}`);
        const payload = await fetchJsonWithCredentials(pageUrl);
        collectSongsFromPayload(tracker, pageUrl, payload);
        await sleep(120);
      } catch (error) {
        logExportSongs(`缺失分页补抓失败：offset=${offset} ｜ ${cleanText(error?.message || error)}`);
        break;
      }
    }
  }

  function createJsonResponseInterceptor({
    match,
    onPayload,
    onFetchHit = null,
    onXhrHit = null,
    onFetchParseError = null,
    onXhrParseError = null
  }) {
    const originalFetch = window.fetch;
    const OriginalXHR = window.XMLHttpRequest;
    const originalResponseJson = Response.prototype.json;
    const originalResponseText = Response.prototype.text;

    function handlePayload(url, payload) {
      try {
        if (!match(url, payload)) return;
        onPayload(url, payload);
      } catch (error) {
        console.warn("[AM Restore] API interceptor handle error", error);
      }
    }

    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      try {
        const input = args[0];
        const requestUrl = toAbsoluteUrl(input instanceof Request ? input.url : input);
        if (match(requestUrl)) {
          if (typeof onFetchHit === "function") {
            onFetchHit(requestUrl);
          }
          response.clone().json()
            .then(payload => handlePayload(requestUrl, payload))
            .catch((error) => {
              if (typeof onFetchParseError === "function") {
                onFetchParseError(requestUrl, error);
              }
            });
        }
      } catch {}

      return response;
    };

    Response.prototype.json = function (...args) {
      return originalResponseJson.apply(this, args).then((payload) => {
        try {
          const requestUrl = toAbsoluteUrl(this?.url || "");
          if (requestUrl && match(requestUrl, payload)) {
            handlePayload(requestUrl, payload);
          }
        } catch {}
        return payload;
      });
    };

    Response.prototype.text = function (...args) {
      return originalResponseText.apply(this, args).then((text) => {
        try {
          const requestUrl = toAbsoluteUrl(this?.url || "");
          if (!requestUrl || !match(requestUrl)) {
            return text;
          }

          const contentType = cleanText(this?.headers?.get?.("content-type") || "").toLowerCase();
          if (contentType && !contentType.includes("json")) {
            return text;
          }

          const payload = JSON.parse(text || "{}");
          handlePayload(requestUrl, payload);
        } catch {}
        return text;
      });
    };

    class InterceptedXHR extends OriginalXHR {
      constructor() {
        super();
        this.__amRequestUrl = "";
        this.addEventListener("load", () => {
          try {
            const requestUrl = this.__amRequestUrl;
            if (!requestUrl || !match(requestUrl)) return;
            if (typeof onXhrHit === "function") {
              onXhrHit(requestUrl);
            }

            const responseType = cleanText(this.responseType || "");
            if (responseType && responseType !== "text" && responseType !== "json") return;

            const contentType = cleanText(this.getResponseHeader("content-type") || "").toLowerCase();
            if (contentType && !contentType.includes("json")) return;

            const payload = responseType === "json"
              ? this.response
              : JSON.parse(this.responseText || "{}");
            handlePayload(requestUrl, payload);
          } catch (error) {
            if (typeof onXhrParseError === "function") {
              onXhrParseError(this.__amRequestUrl, error);
            }
          }
        });
      }

      open(method, url, ...rest) {
        this.__amRequestUrl = toAbsoluteUrl(url);
        return super.open(method, url, ...rest);
      }
    }

    Object.defineProperties(InterceptedXHR, {
      UNSENT: { value: OriginalXHR.UNSENT },
      OPENED: { value: OriginalXHR.OPENED },
      HEADERS_RECEIVED: { value: OriginalXHR.HEADERS_RECEIVED },
      LOADING: { value: OriginalXHR.LOADING },
      DONE: { value: OriginalXHR.DONE }
    });

    window.XMLHttpRequest = InterceptedXHR;

    return () => {
      window.fetch = originalFetch;
      window.XMLHttpRequest = OriginalXHR;
      Response.prototype.json = originalResponseJson;
      Response.prototype.text = originalResponseText;
    };
  }

  function createAlbumsExportTracker() {
    return {
      itemsById: new Map(),
      pageUrls: new Set(),
      total: 0,
      lastCapturedAt: 0
    };
  }

  function mergeAlbumsTracker(target, source) {
    if (!target || !source) return;

    for (const pageKey of source.pageUrls || []) {
      target.pageUrls.add(pageKey);
    }
    for (const [id, item] of source.itemsById || []) {
      if (!target.itemsById.has(id)) {
        target.itemsById.set(id, item);
      }
    }
    target.total = Math.max(target.total || 0, source.total || 0);
    target.lastCapturedAt = Math.max(target.lastCapturedAt || 0, source.lastCapturedAt || 0);
  }

  function ensureAlbumsRequestInterceptor(tracker, options = {}) {
    activeAlbumsCaptureTracker = tracker;
    albumsInterceptorSilent = !!options.silent;

    if (albumsInterceptorRestore) {
      return albumsInterceptorRestore;
    }

    albumsInterceptorRestore = createJsonResponseInterceptor({
      match: (url) => ALBUMS_API_PATTERN.test(url),
      onPayload: (url, payload) => {
        if (!activeAlbumsCaptureTracker) return;
        collectAlbumsFromPayload(activeAlbumsCaptureTracker, url, payload, {
          silent: albumsInterceptorSilent
        });
      },
      onFetchHit: (url) => {
        logExportAlbums(`命中 fetch 请求：offset=${getApiOffset(url)}`);
      },
      onXhrHit: (url) => {
        logExportAlbums(`命中 XHR 请求：offset=${getApiOffset(url)}`);
      },
      onFetchParseError: (_url, error) => {
        logExportAlbums(`fetch 响应解析失败：${cleanText(error?.message || error)}`);
      },
      onXhrParseError: (_url, error) => {
        logExportAlbums(`XHR 响应解析失败：${cleanText(error?.message || error)}`);
      }
    });

    return albumsInterceptorRestore;
  }

  function teardownAlbumsRequestInterceptor() {
    if (albumsInterceptorRestore) {
      albumsInterceptorRestore();
    }
    albumsInterceptorRestore = null;
    activeAlbumsCaptureTracker = null;
    albumsInterceptorSilent = false;
    bootstrapAlbumsTracker = null;
  }

  function buildAlbumsCsv(items) {
    const language = getLanguage();
    const rows = [
      ["报表名称", "Apple Music 专辑导出报表"],
      ["导出时间", formatChinaDateTime()],
      ["当前区服", getStorefront()],
      ["显示语言", `${getLanguageLabel(language)} (${language})`],
      [],
      ["专辑ID", "专辑名", "歌手名"],
      ...items.map(item => [item.id, item.name, item.artistName])
    ];

    return rows.map(row => row.map(csvCell).join(",")).join("\n");
  }

  function getAlbumCatalogId(libraryResource) {
    const relationshipCatalogId = cleanText(
      libraryResource?.relationships?.catalog?.data?.[0]?.id || ""
    );
    if (relationshipCatalogId) {
      return relationshipCatalogId;
    }

    return cleanText(libraryResource?.attributes?.playParams?.catalogId || "");
  }

  function extractAlbumExportItem(libraryResource, catalogAlbums = {}) {
    const catalogId = getAlbumCatalogId(libraryResource);
    const catalogResource = catalogId ? catalogAlbums[catalogId] : null;
    const id = cleanText(catalogResource?.id || catalogId || libraryResource?.id);
    const attributes = catalogResource?.attributes || libraryResource?.attributes || {};
    if (!id) return null;

    return {
      id,
      name: cleanText(attributes.name),
      artistName: cleanText(attributes.artistName),
      displayLanguage: getLanguage()
    };
  }

  function collectAlbumsFromPayload(tracker, requestUrl, payload, options = {}) {
    const { silent = false } = options;
    if (!payload || typeof payload !== "object") return 0;

    const absoluteUrl = toAbsoluteUrl(requestUrl);
    const offset = getApiOffset(absoluteUrl);
    const pageKey = `${offset}::${absoluteUrl}`;
    const isNewPage = !tracker.pageUrls.has(pageKey);
    if (isNewPage) {
      tracker.pageUrls.add(pageKey);
    }

    const total = Number(payload?.meta?.total) || 0;
    if (total) {
      tracker.total = Math.max(tracker.total, total);
    }

    const resources = payload?.resources?.["library-albums"] || {};
    const catalogAlbums = payload?.resources?.albums || {};
    let added = 0;

    for (const dataItem of payload?.data || []) {
      const id = cleanText(dataItem?.id);
      const item = extractAlbumExportItem(resources[id] || dataItem, catalogAlbums);
      if (!item || !item.id || !item.name) continue;
      if (!tracker.itemsById.has(item.id)) {
        tracker.itemsById.set(item.id, item);
        added += 1;
      }
    }

    if (!payload?.data?.length) {
      for (const resource of Object.values(resources)) {
        const item = extractAlbumExportItem(resource, catalogAlbums);
        if (!item || !item.id || !item.name) continue;
        if (!tracker.itemsById.has(item.id)) {
          tracker.itemsById.set(item.id, item);
          added += 1;
        }
      }
    }

    if (added || isNewPage) {
      tracker.lastCapturedAt = Date.now();
    }

    if ((added || isNewPage) && !silent) {
      updateExportAlbumsState({
        phase: "capturing",
        status: `已捕获 ${tracker.pageUrls.size} 页专辑数据`,
        current: `最近分页 offset=${formatWholeNumber(offset)}\n累计分页 ${formatWholeNumber(tracker.pageUrls.size)} 页\n累计专辑 ${formatWholeNumber(tracker.itemsById.size)} 张${tracker.total ? ` / ${formatWholeNumber(tracker.total)}` : ""}`,
        capturedPages: tracker.pageUrls.size,
        exportedCount: tracker.itemsById.size
      });
      logExportAlbums(`捕获分页 offset=${formatWholeNumber(offset)} ｜ 新增 ${formatWholeNumber(added)} 张 ｜ 累计 ${formatWholeNumber(tracker.itemsById.size)} 张`);
    }

    return added;
  }

  function hasCapturedAlbumsOffset(tracker, expectedOffset) {
    const target = String(expectedOffset);
    return Array.from(tracker?.pageUrls || []).some(pageKey => pageKey.split("::")[0] === target);
  }

  async function waitForAlbumsOffset(tracker, expectedOffset, timeout = 5000, stopFn = null) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      if (stopFn && stopFn()) return false;
      if (hasCapturedAlbumsOffset(tracker, expectedOffset)) {
        return true;
      }
      await sleep(250);
    }
    return hasCapturedAlbumsOffset(tracker, expectedOffset);
  }

  async function waitForAlbumsRequestsToSettle(tracker, options = {}, stopFn = null) {
    const quietMs = options.quietMs || 3000;
    const maxWaitMs = options.maxWaitMs || 15000;
    const startedAt = Date.now();

    while (Date.now() - startedAt < maxWaitMs) {
      if (stopFn && stopFn()) return false;
      const idleFor = tracker.lastCapturedAt
        ? Date.now() - tracker.lastCapturedAt
        : Date.now() - startedAt;
      if (idleFor >= quietMs) {
        return true;
      }

      updateExportAlbumsState({
        phase: "capturing",
        status: "等待后台分页请求完成",
        current: `最近一次分页捕获距今 ${formatWholeNumber(Math.ceil(idleFor / 1000))} 秒\n累计分页 ${formatWholeNumber(tracker.pageUrls.size)} 页\n累计专辑 ${formatWholeNumber(tracker.itemsById.size)} 张${tracker.total ? ` / ${formatWholeNumber(tracker.total)}` : ""}`,
        capturedPages: tracker.pageUrls.size,
        exportedCount: tracker.itemsById.size
      });
      await sleep(500);
    }

    return false;
  }

  function createSongsExportTracker() {
    return {
      itemsById: new Map(),
      pageUrls: new Set(),
      total: 0,
      lastCapturedAt: 0
    };
  }

  function mergeSongsTracker(target, source) {
    if (!target || !source) return;

    for (const pageKey of source.pageUrls || []) {
      target.pageUrls.add(pageKey);
    }
    for (const [id, item] of source.itemsById || []) {
      if (!target.itemsById.has(id)) {
        target.itemsById.set(id, item);
      }
    }
    target.total = Math.max(target.total || 0, source.total || 0);
    target.lastCapturedAt = Math.max(target.lastCapturedAt || 0, source.lastCapturedAt || 0);
  }

  function ensureSongsRequestInterceptor(tracker, options = {}) {
    activeSongsCaptureTracker = tracker;
    songsInterceptorSilent = !!options.silent;

    if (songsInterceptorRestore) {
      return songsInterceptorRestore;
    }

    songsInterceptorRestore = createJsonResponseInterceptor({
      match: (url) => SONGS_API_PATTERN.test(url),
      onPayload: (url, payload) => {
        if (!activeSongsCaptureTracker) return;
        collectSongsFromPayload(activeSongsCaptureTracker, url, payload, {
          silent: songsInterceptorSilent
        });
      },
      onFetchHit: (url) => {
        logExportSongs(`命中 fetch 请求：offset=${getApiOffset(url)}`);
      },
      onXhrHit: (url) => {
        logExportSongs(`命中 XHR 请求：offset=${getApiOffset(url)}`);
      },
      onFetchParseError: (_url, error) => {
        logExportSongs(`fetch 响应解析失败：${cleanText(error?.message || error)}`);
      },
      onXhrParseError: (_url, error) => {
        logExportSongs(`XHR 响应解析失败：${cleanText(error?.message || error)}`);
      }
    });

    return songsInterceptorRestore;
  }

  function teardownSongsRequestInterceptor() {
    if (songsInterceptorRestore) {
      songsInterceptorRestore();
    }
    songsInterceptorRestore = null;
    activeSongsCaptureTracker = null;
    songsInterceptorSilent = false;
    bootstrapSongsTracker = null;
  }

  function buildSongsCsv(items) {
    const language = getLanguage();
    const rows = [
      ["报表名称", "Apple Music 歌曲导出报表"],
      ["导出时间", formatChinaDateTime()],
      ["当前区服", getStorefront()],
      ["显示语言", `${getLanguageLabel(language)} (${language})`],
      [],
      ["歌曲ID", "歌曲名", "歌手名", "专辑名"],
      ...items.map(item => [item.id, item.name, item.artistName, item.albumName])
    ];

    return rows.map(row => row.map(csvCell).join(",")).join("\n");
  }

  function buildPlaylistCsv(playlistName, playlistDescription, items) {
    const language = getLanguage();
    const rows = [
      ["报表名称", "Apple Music 播放列表导出报表"],
      ["导出时间", formatChinaDateTime()],
      ["当前区服", getStorefront()],
      ["显示语言", `${getLanguageLabel(language)} (${language})`],
      ["播放列表名", playlistName],
      ["播放列表简介", playlistDescription],
      ["歌曲总数", items.length],
      [],
      ["歌曲ID", "歌曲名", "歌手名", "专辑名"],
      ...items.map(item => [
        item.id,
        item.name,
        item.artistName,
        item.albumName
      ])
    ];

    return rows.map(row => row.map(csvCell).join(",")).join("\n");
  }

  function buildPlaylistExportPayload(playlistName, playlistDescription, items) {
    return {
      exportedAt: formatChinaDateTime(),
      storefront: getStorefront(),
      displayLanguage: getLanguage(),
      displayLanguageName: getLanguageLabel(getLanguage()),
      playlistName,
      playlistDescription,
      count: items.length,
      tracks: items.map(item => ({
        id: item.id,
        name: item.name,
        artistName: item.artistName,
        albumName: item.albumName
      }))
    };
  }

  function getPlaylistName() {
    const selectors = [
      '[data-testid="title"]',
      '[data-testid="resource-title"]',
      ".headings__title",
      "h1"
    ];

    for (const selector of selectors) {
      const text = cleanText(document.querySelector(selector)?.textContent);
      if (text) return text;
    }

    return "未命名播放列表";
  }

  function getPlaylistDescription() {
    const selectors = [
      '[data-testid="description"] [data-testid="truncate-text"]',
      '[data-testid="description"]',
      ".description [data-testid='truncate-text']",
      ".description p"
    ];

    for (const selector of selectors) {
      const text = cleanText(document.querySelector(selector)?.textContent);
      if (text) return text;
    }

    return "";
  }

  function extractNumericIdFromUrl(url) {
    const absoluteUrl = cleanText(url);
    if (!absoluteUrl) return "";

    try {
      const parsed = new URL(absoluteUrl, location.origin);
      const segments = parsed.pathname.split("/").filter(Boolean);

      for (let i = segments.length - 1; i >= 0; i--) {
        if (/^\d+$/.test(segments[i])) {
          return segments[i];
        }
      }

      const trackId = parsed.searchParams.get("i");
      if (/^\d+$/.test(trackId || "")) {
        return trackId;
      }
    } catch {}

    const matched = absoluteUrl.match(/(\d+)(?!.*\d)/);
    return matched ? matched[1] : "";
  }

  function getPlaylistTrackKey(item) {
    if (Number.isFinite(item?.rowIndex)) {
      return `row:${item.rowIndex}`;
    }
    const numericId = cleanText(item?.id);
    if (numericId) return `id:${numericId}`;
    return [
      cleanText(item?.name),
      cleanText(item?.artistName),
      cleanText(item?.albumName),
      cleanText(item?.duration)
    ].map(normalize).join("|||");
  }

  function extractVisiblePlaylistTracks() {
    const rows = Array.from(document.querySelectorAll('[data-testid="track-list-item"]'));
    const items = [];

    for (const row of rows) {
      const title = cleanText(row.querySelector('[data-testid="track-title"]')?.textContent);
      if (!title) continue;

      const songUrl = cleanText(
        row.querySelector('[data-testid="song-name-wrapper"] a[data-testid="click-action"]')?.href || ""
      );
      const artistColumn = row.querySelector('[data-testid="track-column-secondary"]');
      const artistLinks = Array.from(
        artistColumn?.querySelectorAll('a[data-testid="click-action"]') || []
      )
        .map(node => cleanText(node.textContent))
        .filter(Boolean);
      const artist = cleanText(
        artistLinks.join("、") ||
        row.querySelector('[data-testid="track-title-by-line"]')?.textContent
      );
      const albumColumn = row.querySelector('[data-testid="track-column-tertiary"]');
      const album = cleanText(
        albumColumn?.querySelector('a[data-testid="click-action"]')?.textContent ||
        albumColumn?.querySelector("span")?.textContent ||
        albumColumn?.textContent
      );
      const duration = cleanText(row.querySelector('[data-testid="track-duration"]')?.textContent);
      const artistUrl = cleanText(artistColumn?.querySelector('a[data-testid="click-action"]')?.href || "");
      const albumUrl = cleanText(
        albumColumn?.querySelector('a[data-testid="click-action"]')?.href || ""
      );
      const rawLabel = cleanText(row.getAttribute("aria-label") || "");

      items.push({
        rowIndex: Number.parseInt(row.getAttribute("data-row") || "", 10),
        id: extractNumericIdFromUrl(songUrl),
        name: title,
        artistName: artist,
        albumName: album,
        duration,
        songUrl,
        artistUrl,
        albumUrl,
        rawLabel
      });
    }

    return items;
  }

  function mergePlaylistTracks(map, items) {
    for (const item of items) {
      const key = getPlaylistTrackKey(item);
      if (!key) continue;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, item);
        continue;
      }

      map.set(key, {
        ...existing,
        ...item,
        rowIndex: Number.isFinite(existing.rowIndex) ? existing.rowIndex : item.rowIndex
      });
    }
  }

  function sortPlaylistItemsForExport(items) {
    return [...(items || [])].sort((a, b) => {
      const aHasRow = Number.isFinite(a?.rowIndex);
      const bHasRow = Number.isFinite(b?.rowIndex);
      if (aHasRow && bHasRow) {
        return a.rowIndex - b.rowIndex;
      }
      if (aHasRow) return -1;
      if (bHasRow) return 1;
      return 0;
    });
  }

  function getSongCatalogId(libraryResource) {
    const relationshipCatalogId = cleanText(
      libraryResource?.relationships?.catalog?.data?.[0]?.id || ""
    );
    if (relationshipCatalogId) {
      return relationshipCatalogId;
    }

    return cleanText(libraryResource?.attributes?.playParams?.catalogId || "");
  }

  function extractSongExportItem(libraryResource, catalogSongs = {}) {
    const catalogId = getSongCatalogId(libraryResource);
    const catalogResource = catalogId ? catalogSongs[catalogId] : null;
    const id = cleanText(catalogResource?.id || catalogId || libraryResource?.id);
    const attributes = catalogResource?.attributes || libraryResource?.attributes || {};
    if (!id) return null;

    return {
      id,
      name: cleanText(attributes.name),
      artistName: cleanText(attributes.artistName),
      albumName: cleanText(attributes.albumName),
      displayLanguage: getLanguage()
    };
  }

  function collectSongsFromPayload(tracker, requestUrl, payload, options = {}) {
    const { silent = false } = options;
    if (!payload || typeof payload !== "object") return 0;

    const absoluteUrl = toAbsoluteUrl(requestUrl);
    const offset = getApiOffset(absoluteUrl);
    const pageKey = `${offset}::${absoluteUrl}`;
    const isNewPage = !tracker.pageUrls.has(pageKey);
    if (isNewPage) {
      tracker.pageUrls.add(pageKey);
    }

    const total = Number(payload?.meta?.total) || 0;
    if (total) {
      tracker.total = Math.max(tracker.total, total);
    }

    const resources = payload?.resources?.["library-songs"] || {};
    const catalogSongs = payload?.resources?.songs || {};
    let added = 0;

    for (const dataItem of payload?.data || []) {
      const id = cleanText(dataItem?.id);
      const item = extractSongExportItem(resources[id] || dataItem, catalogSongs);
      if (!item || !item.id || !item.name) continue;
      if (!tracker.itemsById.has(item.id)) {
        tracker.itemsById.set(item.id, item);
        added += 1;
      }
    }

    if (!payload?.data?.length) {
      for (const resource of Object.values(resources)) {
        const item = extractSongExportItem(resource, catalogSongs);
        if (!item || !item.id || !item.name) continue;
        if (!tracker.itemsById.has(item.id)) {
          tracker.itemsById.set(item.id, item);
          added += 1;
        }
      }
    }

    if (added || isNewPage) {
      tracker.lastCapturedAt = Date.now();
    }

    if ((added || isNewPage) && !silent) {
      updateExportSongsState({
        phase: "capturing",
        status: `已捕获 ${tracker.pageUrls.size} 页歌曲数据`,
        current: `最近分页 offset=${formatWholeNumber(offset)}\n累计分页 ${formatWholeNumber(tracker.pageUrls.size)} 页\n累计歌曲 ${formatWholeNumber(tracker.itemsById.size)} 首${tracker.total ? ` / ${formatWholeNumber(tracker.total)}` : ""}`,
        capturedPages: tracker.pageUrls.size,
        exportedCount: tracker.itemsById.size
      });
      logExportSongs(`捕获分页 offset=${formatWholeNumber(offset)} ｜ 新增 ${formatWholeNumber(added)} 首 ｜ 累计 ${formatWholeNumber(tracker.itemsById.size)} 首`);
    }

    return added;
  }

  function hasCapturedSongsOffset(tracker, expectedOffset) {
    const target = String(expectedOffset);
    return Array.from(tracker?.pageUrls || []).some(pageKey => pageKey.split("::")[0] === target);
  }

  async function waitForSongsOffset(tracker, expectedOffset, timeout = 5000, stopFn = null) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      if (stopFn && stopFn()) return false;
      if (hasCapturedSongsOffset(tracker, expectedOffset)) {
        return true;
      }
      await sleep(250);
    }
    return hasCapturedSongsOffset(tracker, expectedOffset);
  }

  async function waitForSongsRequestsToSettle(tracker, options = {}, stopFn = null) {
    const quietMs = options.quietMs || 3000;
    const maxWaitMs = options.maxWaitMs || 15000;
    const startedAt = Date.now();

    while (Date.now() - startedAt < maxWaitMs) {
      if (stopFn && stopFn()) return false;
      const idleFor = tracker.lastCapturedAt
        ? Date.now() - tracker.lastCapturedAt
        : Date.now() - startedAt;
      if (idleFor >= quietMs) {
        return true;
      }

      updateExportSongsState({
        phase: "capturing",
        status: "等待后台分页请求完成",
        current: `最近一次分页捕获距今 ${formatWholeNumber(Math.ceil(idleFor / 1000))} 秒\n累计分页 ${formatWholeNumber(tracker.pageUrls.size)} 页\n累计歌曲 ${formatWholeNumber(tracker.itemsById.size)} 首${tracker.total ? ` / ${formatWholeNumber(tracker.total)}` : ""}`,
        capturedPages: tracker.pageUrls.size,
        exportedCount: tracker.itemsById.size
      });
      await sleep(500);
    }

    return false;
  }

  async function resetSongsListToTop(scrollers, stopFn = null) {
    if (stopFn && stopFn()) return false;
    const rootScroller = document.scrollingElement || document.documentElement;
    try {
      window.scrollTo(0, 0);
    } catch {}
    if (rootScroller) {
      rootScroller.scrollTop = 0;
    }

    for (const scroller of scrollers || []) {
      if (stopFn && stopFn()) return false;
      if (!scroller) continue;
      try {
        scroller.scrollTop = 0;
      } catch {}
      triggerScrollActivity(scroller, -Math.max(2400, Math.floor((scroller.clientHeight || 800) * 4)));
    }

    await sleep(1200);
    return !(stopFn && stopFn());
  }

  function triggerScrollActivity(scroller, step) {
    if (!scroller) return;
    const isRootScroller = scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body;

    if (typeof scroller.focus === "function") {
      try {
        scroller.focus({ preventScroll: true });
      } catch {}
    }

    scroller.dispatchEvent(new WheelEvent("wheel", {
      deltaY: step,
      bubbles: true,
      cancelable: true
    }));
    scroller.dispatchEvent(new Event("scroll", {
      bubbles: true
    }));

    if (isRootScroller) {
      try {
        window.scrollBy(0, step);
      } catch {}
    } else if (typeof scroller.scrollBy === "function") {
      try {
        scroller.scrollBy(0, step);
      } catch {}
    }

    try {
      window.dispatchEvent(new WheelEvent("wheel", {
        deltaY: step,
        bubbles: true,
        cancelable: true
      }));
    } catch {}
  }

  async function trySongsScroller(scroller, tracker, scrollerIndex, totalScrollers, rounds = 260, stopFn = null) {
    if (stopFn && stopFn()) return false;
    const isRootScroller = scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body;
    if (isRootScroller) {
      window.scrollTo(0, 0);
    } else {
      scroller.scrollTop = 0;
    }
    triggerScrollActivity(scroller, -Math.max(800, Math.floor(scroller.clientHeight * 2.5)));
    await sleep(900);

    let stableRounds = 0;
    let lastCount = tracker.itemsById.size;
    let lastPages = tracker.pageUrls.size;
    let lastScrollTop = -1;
    let lastScrollHeight = -1;

    for (let i = 0; i < rounds; i++) {
      if (stopFn && stopFn()) return false;
      const step = Math.max(1800, Math.floor(scroller.clientHeight * 3.5));
      if (isRootScroller) {
        window.scrollTo(0, Math.min(scroller.scrollTop + step, scroller.scrollHeight));
      } else {
        scroller.scrollTop = Math.min(scroller.scrollTop + step, scroller.scrollHeight);
      }
      triggerScrollActivity(scroller, step);

      await sleep(700);

      const nowCount = tracker.itemsById.size;
      const nowPages = tracker.pageUrls.size;
      const nowTop = scroller.scrollTop;
      const nowHeight = scroller.scrollHeight;
      const reachedBottom = nowTop + scroller.clientHeight >= nowHeight - 5;
      const noProgress = nowCount === lastCount && nowPages === lastPages && nowTop === lastScrollTop && nowHeight === lastScrollHeight;

      updateExportSongsState({
        phase: "capturing",
        status: `正在滚动第 ${scrollerIndex + 1} / ${totalScrollers} 个容器`,
        current: `滚动位置 ${formatWholeNumber(nowTop)} / ${formatWholeNumber(nowHeight)}\n累计分页 ${formatWholeNumber(nowPages)} 页\n累计歌曲 ${formatWholeNumber(nowCount)} 首${tracker.total ? ` / ${formatWholeNumber(tracker.total)}` : ""}`,
        testedScrollers: scrollerIndex + 1,
        totalScrollers,
        capturedPages: nowPages,
        exportedCount: nowCount
      });

      if (reachedBottom || noProgress) {
        stableRounds += 1;
      } else {
        stableRounds = 0;
      }

      lastCount = nowCount;
      lastPages = nowPages;
      lastScrollTop = nowTop;
      lastScrollHeight = nowHeight;

      if (stableRounds >= 8) break;
    }

    await sleep(1000);
    return !(stopFn && stopFn());
  }

  async function exportSongsFromLibrary(options = {}) {
    const {
      skipReload = false,
      resumedFromPending = false,
      reloadAttempt = 1
    } = options;

    if (exportSongsState.running) {
      alert("导出任务正在执行中");
      return;
    }

    if (skipReload && !onLibrarySongsPage()) {
      updateExportSongsState({
        running: false,
        phase: "waiting-page",
        status: "正在等待歌曲页面完成加载",
        current: `当前路径：${location.pathname}\n正在等待进入资料库-歌曲页面...`,
        testedScrollers: 0,
        totalScrollers: 0,
        capturedPages: 0,
        exportedCount: 0
      });
      logExportSongs(`等待歌曲页面完成加载：${location.pathname}`);
      return;
    }

    if (!skipReload) {
      clearLogs();
      setPendingExportSongsReload();
      updateExportSongsState({
        running: false,
        phase: "reloading",
        status: "正在刷新歌曲页面",
        current: `即将刷新到标准歌曲页：${buildLibrarySongsUrl()}`,
        testedScrollers: 0,
        totalScrollers: 0,
        capturedPages: 0,
        exportedCount: 0
      });
      logExportSongs("准备刷新到标准资料库歌曲页，确保拦截到第一页请求");
      location.href = buildLibrarySongsUrl();
      return;
    }

    if (resumedFromPending) {
      clearPendingExportSongsReload();
    }

    clearLogs();
    updateExportSongsState({
      running: true,
      phase: "preparing",
      status: "正在准备拦截分页请求",
      current: `当前页面：${location.pathname}`,
      testedScrollers: 0,
      totalScrollers: 0,
      capturedPages: 0,
      exportedCount: 0
    });
    logExportSongs("开始拦截资料库歌曲分页请求");

    const tracker = createSongsExportTracker();
    if (bootstrapSongsTracker) {
      mergeSongsTracker(tracker, bootstrapSongsTracker);
      bootstrapSongsTracker = null;
    }
    ensureSongsRequestInterceptor(tracker, { silent: false });
    const stopFn = () => isExportSongsStopped();

    try {
      updateExportSongsState({
        phase: "finding-scroller",
        status: "正在等待歌曲列表加载",
        current: `当前页面：${location.pathname}\n正在等待歌曲列表与滚动区域出现...`,
        testedScrollers: 0,
        totalScrollers: 0,
        capturedPages: 0,
        exportedCount: 0
      });
      logExportSongs("正在等待歌曲列表滚动区域出现");

      const candidates = await waitForSongsScrollCandidates(15000, stopFn);
      if (stopFn()) return;
      const topCandidates = candidates.slice(0, 8);

      updateExportSongsState({
        phase: "capturing",
        status: "正在回到歌曲列表顶部",
        current: `当前页面：${location.pathname}\n准备从顶部重新触发 offset=0 分页请求...`,
        testedScrollers: 0,
        totalScrollers: topCandidates.length,
        capturedPages: tracker.pageUrls.size,
        exportedCount: tracker.itemsById.size
      });
      logExportSongs("正在回到歌曲列表顶部，尽量从 offset=0 开始抓取");
      await resetSongsListToTop(topCandidates, stopFn);
      if (stopFn()) return;

      if (!hasCapturedSongsOffset(tracker, 0)) {
        logExportSongs("尚未捕获 offset=0，等待首屏分页请求");
        await waitForSongsOffset(tracker, 0, 6000, stopFn);
        if (stopFn()) return;
      }

      if (!hasCapturedSongsOffset(tracker, 0) && tracker.itemsById.size === 0 && reloadAttempt < EXPORT_RELOAD_MAX_ATTEMPTS) {
        const nextAttempt = reloadAttempt + 1;
        updateExportSongsState({
          running: false,
          phase: "reloading",
          status: "首屏分页未命中，自动重试",
          current: `第 ${reloadAttempt} 次刷新未捕获 offset=0，准备自动进行第 ${nextAttempt} 次刷新。`,
          testedScrollers: 0,
          totalScrollers: topCandidates.length,
          capturedPages: 0,
          exportedCount: 0
        });
        logExportSongs(`首轮未捕获 offset=0，自动重试第 ${nextAttempt} 次刷新`);
        setPendingExportSongsReload(String(nextAttempt));
        location.href = buildLibrarySongsUrl();
        return;
      }

      updateExportSongsState({
        phase: "finding-scroller",
        status: "正在寻找滚动容器",
        current: `当前页面：${location.pathname}\n候选滚动容器：${formatWholeNumber(topCandidates.length)} 个`,
        testedScrollers: 0,
        totalScrollers: topCandidates.length,
        capturedPages: 0,
        exportedCount: 0
      });
      logExportSongs(`候选滚动容器数量：${formatWholeNumber(candidates.length)}`);

      if (!topCandidates.length) {
        if (tracker.itemsById.size > 0) {
          logExportSongs(`未识别到滚动容器，但已捕获 ${formatWholeNumber(tracker.itemsById.size)} 首歌曲，直接导出已捕获数据`);
        } else {
          logExportSongs("没找到明显的滚动容器");
        }

        updateExportSongsState({
          running: false,
          phase: tracker.itemsById.size === 0 ? "no-scroller" : "capturing",
          status: tracker.itemsById.size === 0 ? "未找到滚动容器" : "已捕获首屏歌曲数据",
          current: tracker.itemsById.size === 0
            ? "当前页面未识别到明显的歌曲列表滚动区域。"
            : `未识别到滚动容器，改为导出已捕获的 ${formatWholeNumber(tracker.itemsById.size)} 首歌曲。`
        });
        if (tracker.itemsById.size === 0) {
          return;
        }
      }

      for (let i = 0; i < topCandidates.length; i++) {
        logExportSongs(`测试第 ${i + 1} 个滚动容器`);
        await trySongsScroller(topCandidates[i], tracker, i, topCandidates.length, 260, stopFn);
        if (stopFn()) return;

        if (tracker.total && tracker.itemsById.size >= tracker.total) {
          break;
        }

        if (tracker.itemsById.size > 0 && tracker.pageUrls.size > 0) {
          break;
        }
      }

      logExportSongs("滚动已完成，等待后台分页请求收尾");
      await waitForSongsRequestsToSettle(tracker, {
        quietMs: tracker.total && tracker.itemsById.size < tracker.total ? 4500 : 2500,
        maxWaitMs: 20000
      }, stopFn);
      if (stopFn()) return;

      const items = Array.from(tracker.itemsById.values())
        .sort((a, b) => a.name.localeCompare(b.name) || a.artistName.localeCompare(b.artistName) || a.id.localeCompare(b.id));

      if (!items.length) {
        updateExportSongsState({
          running: false,
          phase: "empty-result",
          status: "没有捕获到歌曲数据",
          current: "请确认当前页面已加载歌曲列表，并且向下滚动时会触发分页请求。"
        });
        logExportSongs("没有捕获到任何歌曲分页数据");
        return;
      }

      const csv = buildSongsCsv(items);
      const exportPayload = {
        exportedAt: formatChinaDateTime(),
        storefront: getStorefront(),
        displayLanguage: getLanguage(),
        displayLanguageName: getLanguageLabel(getLanguage()),
        items
      };
      download("apple_music_library_songs.csv", csv, "text/csv;charset=utf-8");
      download("apple_music_library_songs.json", JSON.stringify(exportPayload, null, 2), "application/json");

      updateExportSongsState({
        running: false,
        phase: "completed",
        status: `导出完成，共 ${formatWholeNumber(items.length)} 首歌曲`,
        current: `已捕获分页 ${formatWholeNumber(tracker.pageUrls.size)} 页${tracker.total ? ` / 预估 ${formatWholeNumber(tracker.total)} 首` : ""}\n导出文件：apple_music_library_songs.csv\n导出文件：apple_music_library_songs.json`,
        testedScrollers: topCandidates.length ? Math.min(topCandidates.length, Math.max(1, exportSongsState.testedScrollers)) : 0,
        totalScrollers: topCandidates.length,
        capturedPages: tracker.pageUrls.size,
        exportedCount: items.length
      });
      logExportSongs(`导出完成，共 ${formatWholeNumber(items.length)} 首歌曲`);
    } catch (error) {
      updateExportSongsState({
        running: false,
        phase: "error",
        status: "导出失败",
        current: cleanText(error?.message || String(error) || "未知错误")
      });
      logExportSongs(`导出失败：${error?.stack || error?.message || error}`);
    } finally {
      teardownSongsRequestInterceptor();
    }
  }

  function resumeExportSongsAfterReload() {
    const startedAt = Date.now();
    const timeout = 30000;

    updateExportSongsState({
      running: false,
      phase: "waiting-page",
      status: "正在等待歌曲页面完成加载",
      current: `当前路径：${location.pathname}\n正在等待进入资料库-歌曲页面...`,
      testedScrollers: 0,
      totalScrollers: 0,
      capturedPages: 0,
      exportedCount: 0
    });

    const tick = () => {
      if (!getPendingExportSongsReload()) return;

      if (onLibrarySongsPage()) {
        const reloadAttempt = parsePendingExportReloadAttempt(getPendingExportSongsReload());
        logExportSongs(`检测到待继续的导出歌曲任务，当前路径：${location.pathname}${location.search}`);
        Promise.resolve(exportSongsFromLibrary({ skipReload: true, resumedFromPending: true, reloadAttempt }))
          .finally(() => {
            if (getPendingExportSongsReload()) {
              setTimeout(tick, 500);
            }
          });
        return;
      }

      if (Date.now() - startedAt >= timeout) {
        clearPendingExportSongsReload();
        updateExportSongsState({
          running: false,
          phase: "error",
          status: "等待页面超时",
          current: `自动跳转到标准歌曲页超时。\n当前路径：${location.pathname}`,
          testedScrollers: 0,
          totalScrollers: 0,
          capturedPages: 0,
          exportedCount: 0
        });
        logExportSongs(`等待歌曲页超时：${location.pathname}`);
        return;
      }

      setTimeout(tick, 500);
    };

    setTimeout(tick, 500);
  }

  function setupPendingSongsBootstrapInterceptor() {
    if (!getPendingExportSongsReload() || songsInterceptorRestore || albumsInterceptorRestore) {
      return;
    }

    bootstrapSongsTracker = createSongsExportTracker();
    ensureSongsRequestInterceptor(bootstrapSongsTracker, { silent: true });
  }

  function parseAriaLabel(label, fallbackAlbum) {
    const raw = cleanText(label);
    const albumText = cleanText(fallbackAlbum);
    if (!raw) {
      return {
        album: albumText,
        artist: ""
      };
    }

    if (albumText) {
      const rawLower = raw.toLowerCase();
      const albumLower = albumText.toLowerCase();
      if (rawLower.startsWith(albumLower)) {
        const artist = cleanText(raw.slice(albumText.length).replace(/^,\s*/, ""));
        return {
          album: albumText,
          artist
        };
      }
    }

    const parts = raw.split(",").map(x => cleanText(x)).filter(Boolean);
    if (parts.length >= 2) {
      return {
        album: parts[0],
        artist: parts.slice(1).join(", ")
      };
    }

    return {
      album: cleanText(fallbackAlbum || raw),
      artist: ""
    };
  }

  function getAllScrollCandidates() {
    const preferredSelectors = [
      '[data-testid="lockup-virtual-scrolling-component"]',
      '#scrollable-page-override',
      '[data-testid="track-list"]',
      '[data-testid="track-list-section"]',
      '[data-testid="virtual-rows"]'
    ];
    const preferredNodes = preferredSelectors
      .flatMap(selector => Array.from(document.querySelectorAll(selector)))
      .filter((el, index, list) => list.indexOf(el) === index)
      .filter(el => {
        if (!el || el.closest("#amr_panel")) return false;
        const style = getComputedStyle(el);
        const overflowY = style.overflowY;
        return (
          (overflowY === "auto" || overflowY === "scroll" || el.scrollHeight > el.clientHeight + 100) &&
          el.clientHeight > 150
        );
      });

    const nodes = Array.from(document.querySelectorAll("main, section, div"))
      .filter(el => {
        if (!el || el.closest("#amr_panel")) return false;
        const style = getComputedStyle(el);
        const overflowY = style.overflowY;
        return (
          (overflowY === "auto" || overflowY === "scroll") &&
          el.scrollHeight > el.clientHeight + 100 &&
          el.clientHeight > 150
        );
      })
      .sort((a, b) => {
        const scoreA = (a.scrollHeight - a.clientHeight) + a.clientHeight;
        const scoreB = (b.scrollHeight - b.clientHeight) + b.clientHeight;
        return scoreB - scoreA;
      });

    const candidates = preferredNodes.length ? preferredNodes : nodes;
    const rootScroller = document.scrollingElement || document.documentElement;
    if (
      rootScroller &&
      !candidates.includes(rootScroller) &&
      rootScroller.scrollHeight > rootScroller.clientHeight + 100
    ) {
      candidates.push(rootScroller);
    }

    return candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);
  }

  function getPlaylistScrollCandidates() {
    const preferredSelectors = [
      '[data-testid="track-list"]',
      '[data-testid="track-list-section"]',
      '[data-testid="track-list-item"]',
      "#scrollable-page-override"
    ];
    const preferredNodes = preferredSelectors
      .flatMap(selector => Array.from(document.querySelectorAll(selector)))
      .map(node => node?.closest?.("main, section, div") || node)
      .filter((node, index, list) => !!node && list.indexOf(node) === index)
      .filter(node => {
        if (!node || node.closest("#amr_panel")) return false;
        const style = getComputedStyle(node);
        const overflowY = style.overflowY;
        return (
          (overflowY === "auto" || overflowY === "scroll" || node.scrollHeight > node.clientHeight + 100) &&
          node.clientHeight > 150
        );
      })
      .sort((a, b) => b.scrollHeight - a.scrollHeight);

    return preferredNodes.length ? preferredNodes : getAllScrollCandidates();
  }

  async function waitForPlaylistRowsOrCandidates(timeout = 15000, stopFn = null) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
      if (stopFn && stopFn()) {
        return {
          rows: [],
          candidates: []
        };
      }

      const rows = extractVisiblePlaylistTracks();
      const candidates = getPlaylistScrollCandidates();
      if (rows.length || candidates.length) {
        return { rows, candidates };
      }

      await sleep(500);
    }

    return {
      rows: extractVisiblePlaylistTracks(),
      candidates: getPlaylistScrollCandidates()
    };
  }

  async function tryPlaylistScroller(scroller, scrollerIndex, totalScrollers, rounds = 260, stopFn = null) {
    const found = new Map();
    const isRootScroller = scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body;

    if (stopFn && stopFn()) return null;

    if (isRootScroller) {
      window.scrollTo(0, 0);
    } else {
      scroller.scrollTop = 0;
    }
    triggerScrollActivity(scroller, -Math.max(1200, Math.floor((scroller.clientHeight || 800) * 2.5)));
    await sleep(1200);
    mergePlaylistTracks(found, extractVisiblePlaylistTracks());

    let stableRounds = 0;
    let lastCount = found.size;
    let lastTop = -1;
    let lastHeight = -1;

    for (let i = 0; i < rounds; i++) {
      if (stopFn && stopFn()) return null;

      const step = Math.max(300, Math.floor((scroller.clientHeight || 800) * 0.85));
      if (isRootScroller) {
        window.scrollTo(0, Math.min(scroller.scrollTop + step, scroller.scrollHeight));
      } else {
        scroller.scrollTop = Math.min(scroller.scrollTop + step, scroller.scrollHeight);
      }
      triggerScrollActivity(scroller, step);

      await sleep(900);
      mergePlaylistTracks(found, extractVisiblePlaylistTracks());

      const nowCount = found.size;
      const nowTop = scroller.scrollTop;
      const nowHeight = scroller.scrollHeight;
      const reachedBottom = nowTop + scroller.clientHeight >= nowHeight - 5;
      const stable = nowCount === lastCount && nowTop === lastTop && nowHeight === lastHeight;

      logExportPlaylists(`滚动中：count=${formatWholeNumber(nowCount)}, top=${formatWholeNumber(nowTop)}, height=${formatWholeNumber(nowHeight)}, client=${formatWholeNumber(scroller.clientHeight)}`);
      updateExportPlaylistsState({
        phase: "capturing",
        status: `正在滚动第 ${scrollerIndex + 1} / ${totalScrollers} 个容器`,
        current: `滚动位置 ${formatWholeNumber(nowTop)} / ${formatWholeNumber(nowHeight)}\n累计歌曲 ${formatWholeNumber(nowCount)} 首`,
        testedScrollers: scrollerIndex + 1,
        totalScrollers,
        exportedCount: nowCount
      });

      if (reachedBottom || stable) {
        stableRounds += 1;
      } else {
        stableRounds = 0;
      }

      lastCount = nowCount;
      lastTop = nowTop;
      lastHeight = nowHeight;

      if (stableRounds >= 6) break;
    }

    return {
      scroller,
      items: Array.from(found.values()),
      count: found.size
    };
  }

  async function waitForSongsScrollCandidates(timeout = 15000, stopFn = null) {
    const selectors = [
      '[data-testid="track-list"]',
      '[data-testid="track-list-section"]',
      '[data-testid="lockup-virtual-scrolling-component"]',
      '[data-testid="virtual-rows"]'
    ];
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
      if (stopFn && stopFn()) return [];
      const candidates = getAllScrollCandidates();
      if (candidates.length) {
        return candidates;
      }

      const hasSongsDom = selectors.some(selector => document.querySelector(selector));
      if (hasSongsDom) {
        const rootScroller = document.scrollingElement || document.documentElement;
        if (rootScroller && rootScroller.scrollHeight > rootScroller.clientHeight + 100) {
          return [rootScroller];
        }
      }

      await sleep(500);
    }

    return getAllScrollCandidates();
  }

  async function waitForAlbumsScrollCandidates(timeout = 15000, stopFn = null) {
    const selectors = [
      '[data-testid="product-lockup"]',
      '[data-testid="lockup-virtual-scrolling-component"]',
      '[data-testid="virtual-rows"]'
    ];
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
      if (stopFn && stopFn()) return [];
      const candidates = getAllScrollCandidates();
      if (candidates.length) {
        return candidates;
      }

      const hasAlbumsDom = selectors.some(selector => document.querySelector(selector));
      if (hasAlbumsDom) {
        const rootScroller = document.scrollingElement || document.documentElement;
        if (rootScroller && rootScroller.scrollHeight > rootScroller.clientHeight + 100) {
          return [rootScroller];
        }
      }

      await sleep(500);
    }

    return getAllScrollCandidates();
  }

  async function tryAlbumsScroller(scroller, tracker, scrollerIndex, totalScrollers, rounds = 260, stopFn = null) {
    if (stopFn && stopFn()) return false;
    const isRootScroller = scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body;
    if (isRootScroller) {
      window.scrollTo(0, 0);
    } else {
      scroller.scrollTop = 0;
    }
    triggerScrollActivity(scroller, -Math.max(800, Math.floor((scroller.clientHeight || 800) * 2.5)));
    await sleep(900);

    let stableRounds = 0;
    let lastCount = tracker.itemsById.size;
    let lastPages = tracker.pageUrls.size;
    let lastScrollTop = -1;
    let lastScrollHeight = -1;

    for (let i = 0; i < rounds; i++) {
      if (stopFn && stopFn()) return false;
      const step = Math.max(1800, Math.floor((scroller.clientHeight || 800) * 3.5));
      if (isRootScroller) {
        window.scrollTo(0, Math.min(scroller.scrollTop + step, scroller.scrollHeight));
      } else {
        scroller.scrollTop = Math.min(scroller.scrollTop + step, scroller.scrollHeight);
      }
      triggerScrollActivity(scroller, step);

      await sleep(700);

      const nowCount = tracker.itemsById.size;
      const nowPages = tracker.pageUrls.size;
      const nowTop = scroller.scrollTop;
      const nowHeight = scroller.scrollHeight;
      const reachedBottom = nowTop + scroller.clientHeight >= nowHeight - 5;
      const noProgress = nowCount === lastCount && nowPages === lastPages && nowTop === lastScrollTop && nowHeight === lastScrollHeight;

      updateExportAlbumsState({
        phase: "capturing",
        status: `正在滚动第 ${scrollerIndex + 1} / ${totalScrollers} 个容器`,
        current: `滚动位置 ${formatWholeNumber(nowTop)} / ${formatWholeNumber(nowHeight)}\n累计分页 ${formatWholeNumber(nowPages)} 页\n累计专辑 ${formatWholeNumber(nowCount)} 张${tracker.total ? ` / ${formatWholeNumber(tracker.total)}` : ""}`,
        testedScrollers: scrollerIndex + 1,
        totalScrollers,
        capturedPages: nowPages,
        exportedCount: nowCount
      });

      if (reachedBottom || noProgress) {
        stableRounds += 1;
      } else {
        stableRounds = 0;
      }

      lastCount = nowCount;
      lastPages = nowPages;
      lastScrollTop = nowTop;
      lastScrollHeight = nowHeight;

      if (stableRounds >= 8) break;
    }

    await sleep(1000);
    return !(stopFn && stopFn());
  }

  function isHiddenAlbumCard(card) {
    if (!card) return true;

    const row = card.closest(".virtual-row");
    if (row) {
      const rowStyle = getComputedStyle(row);
      if (rowStyle.visibility === "hidden" || rowStyle.display === "none") {
        return true;
      }
      if (!row.hasAttribute("data-testid") && rowStyle.contain.includes("content")) {
        return true;
      }
    }

    const style = getComputedStyle(card);
    if (style.visibility === "hidden" || style.display === "none") {
      return true;
    }

    return false;
  }

  function dedupeAlbumItems(items) {
    const map = new Map();

    for (const item of items) {
      const artist = cleanText(item?.artist);
      const album = cleanText(item?.album);
      const rawLabel = cleanText(item?.rawLabel);
      if (!album) continue;

      const key = `${normalize(artist)}|||${normalize(album)}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { artist, album, rawLabel });
        continue;
      }

      if (!existing.artist && artist) existing.artist = artist;
      if (!existing.rawLabel && rawLabel) existing.rawLabel = rawLabel;
    }

    return Array.from(map.values());
  }

  function extractVisibleAlbums() {
    const cards = Array.from(document.querySelectorAll('[data-testid="product-lockup"]'));
    const items = [];

    for (const card of cards) {
      if (isHiddenAlbumCard(card)) continue;

      const title = cleanText(
        card.querySelector('[data-testid="product-lockup-title"]')?.textContent ||
        card.querySelector('[data-testid="product-lockup-link"]')?.textContent ||
        card.querySelector(".product-lockup__title")?.textContent
      );
      if (!title) continue;

      const subtitleTexts = Array.from(card.querySelectorAll('[data-testid="product-lockup-subtitle"]'))
        .map(node => cleanText(node.textContent))
        .filter(Boolean);

      let artist = subtitleTexts.join(", ");
      const aria = card.getAttribute("aria-label") ||
        card.querySelector('[data-testid="product-lockup-link"]')?.getAttribute("aria-label") ||
        "";

      if (!artist) {
        const parsed = parseAriaLabel(aria, title);
        artist = parsed.artist;
      }

      if (!artist) {
        const texts = Array.from(card.querySelectorAll("a, span, div, p"))
          .map(el => cleanText(el.textContent))
          .filter(Boolean);
        const uniq = [...new Set(texts)];
        artist = uniq.find(t => t !== title) || "";
      }

      items.push({
        artist,
        album: title,
        rawLabel: aria
      });
    }

    if (!items.length) {
      const links = Array.from(document.querySelectorAll('a[data-testid="product-lockup-link"]'));
      for (const a of links) {
        if (isHiddenAlbumCard(a.closest('[data-testid="product-lockup"]'))) continue;

        const text = cleanText(a.textContent);
        const aria = a.getAttribute("aria-label") || "";
        const parsed = parseAriaLabel(aria, text);
        if (!parsed.album) continue;

        let artist = parsed.artist;
        const card = a.closest('[data-testid="lockup-control"]') || a.parentElement;

        if (!artist && card) {
          const texts = Array.from(card.querySelectorAll("a, span, div, p"))
            .map(el => cleanText(el.textContent))
            .filter(Boolean);
          const uniq = [...new Set(texts)];
          artist = uniq.find(t => t !== parsed.album) || "";
        }

        items.push({
          artist,
          album: parsed.album,
          rawLabel: aria
        });
      }
    }

    return dedupeAlbumItems(items);
  }

  function mergeIntoMap(map, items) {
    for (const item of items) {
      const key = `${normalize(item.artist)}|||${normalize(item.album)}`;
      if (!map.has(key)) {
        map.set(key, item);
      }
    }
  }

  async function tryAlbumScroller(scroller, rounds = 220) {
    const found = new Map();

    scroller.scrollTop = 0;
    await sleep(1200);
    mergeIntoMap(found, extractVisibleAlbums());

    let stableRounds = 0;
    let lastCount = found.size;
    let lastScrollTop = -1;
    let lastScrollHeight = -1;

    for (let i = 0; i < rounds; i++) {
      const step = Math.max(300, Math.floor(scroller.clientHeight * 0.8));
      scroller.scrollTop = Math.min(scroller.scrollTop + step, scroller.scrollHeight);
      scroller.dispatchEvent(new WheelEvent("wheel", {
        deltaY: step,
        bubbles: true,
        cancelable: true
      }));

      await sleep(1000);
      mergeIntoMap(found, extractVisibleAlbums());

      const nowCount = found.size;
      const nowTop = scroller.scrollTop;
      const nowHeight = scroller.scrollHeight;
      const reachedBottom = nowTop + scroller.clientHeight >= nowHeight - 5;
      const notGrowing = nowCount === lastCount && nowTop === lastScrollTop && nowHeight === lastScrollHeight;

      logExportAlbums(`滚动中：count=${formatWholeNumber(nowCount)}, top=${formatWholeNumber(nowTop)}, height=${formatWholeNumber(nowHeight)}, client=${formatWholeNumber(scroller.clientHeight)}`);
      updateExportAlbumsState({
        status: `滚动抓取中（已抓到 ${nowCount} 张）`,
        current: `滚动位置 ${formatWholeNumber(nowTop)} / ${formatWholeNumber(nowHeight)} ｜ 可视高度 ${formatWholeNumber(scroller.clientHeight)}`
      });

      if (reachedBottom || notGrowing) {
        stableRounds++;
      } else {
        stableRounds = 0;
      }

      lastCount = nowCount;
      lastScrollTop = nowTop;
      lastScrollHeight = nowHeight;

      if (stableRounds >= 6) break;
    }

    return {
      scroller,
      items: Array.from(found.values()),
      count: found.size
    };
  }

  async function exportAlbumsFromLibrary(options = {}) {
    const {
      skipReload = false,
      resumedFromPending = false,
      reloadAttempt = 1
    } = options;

    if (exportAlbumsState.running) {
      alert("导出任务正在执行中");
      return;
    }

    if (skipReload && !onLibraryAlbumsPage()) {
      updateExportAlbumsState({
        running: false,
        phase: "waiting-page",
        status: "正在等待专辑页面完成加载",
        current: `当前路径：${location.pathname}\n正在等待进入资料库-专辑页面...`,
        testedScrollers: 0,
        totalScrollers: 0,
        capturedPages: 0,
        exportedCount: 0
      });
      logExportAlbums(`等待专辑页面完成加载：${location.pathname}`);
      return;
    }

    if (!skipReload) {
      clearLogs();
      setPendingExportAlbumsReload();
      updateExportAlbumsState({
        running: false,
        phase: "reloading",
        status: "正在刷新专辑页面",
        current: `即将刷新到标准专辑页：${buildLibraryAlbumsUrl()}`,
        testedScrollers: 0,
        totalScrollers: 0,
        capturedPages: 0,
        exportedCount: 0
      });
      logExportAlbums("准备刷新到标准资料库专辑页，确保拦截到第一页请求");
      location.href = buildLibraryAlbumsUrl();
      return;
    }

    if (resumedFromPending) {
      clearPendingExportAlbumsReload();
    }

    clearLogs();
    updateExportAlbumsState({
      running: true,
      phase: "preparing",
      status: "正在准备拦截分页请求",
      current: `当前页面：${location.pathname}`,
      testedScrollers: 0,
      totalScrollers: 0,
      capturedPages: 0,
      exportedCount: 0
    });
    logExportAlbums("开始拦截资料库专辑分页请求");

    const tracker = createAlbumsExportTracker();
    if (bootstrapAlbumsTracker) {
      mergeAlbumsTracker(tracker, bootstrapAlbumsTracker);
      bootstrapAlbumsTracker = null;
    }
    ensureAlbumsRequestInterceptor(tracker, { silent: false });
    const stopFn = () => isExportAlbumsStopped();

    try {
      updateExportAlbumsState({
        phase: "finding-scroller",
        status: "正在等待专辑列表加载",
        current: `当前页面：${location.pathname}\n正在等待专辑列表与滚动区域出现...`,
        testedScrollers: 0,
        totalScrollers: 0,
        capturedPages: 0,
        exportedCount: 0
      });
      logExportAlbums("正在等待专辑列表滚动区域出现");

      const candidates = await waitForAlbumsScrollCandidates(15000, stopFn);
      if (stopFn()) return;
      const topCandidates = candidates.slice(0, 8);

      updateExportAlbumsState({
        phase: "capturing",
        status: "正在回到专辑列表顶部",
        current: `当前页面：${location.pathname}\n准备从顶部重新触发 offset=0 分页请求...`,
        testedScrollers: 0,
        totalScrollers: topCandidates.length,
        capturedPages: tracker.pageUrls.size,
        exportedCount: tracker.itemsById.size
      });
      logExportAlbums("正在回到专辑列表顶部，尽量从 offset=0 开始抓取");
      await resetSongsListToTop(topCandidates, stopFn);
      if (stopFn()) return;

      if (!hasCapturedAlbumsOffset(tracker, 0)) {
        logExportAlbums("尚未捕获 offset=0，等待首屏分页请求");
        await waitForAlbumsOffset(tracker, 0, 6000, stopFn);
        if (stopFn()) return;
      }

      if (!hasCapturedAlbumsOffset(tracker, 0) && tracker.itemsById.size === 0 && reloadAttempt < EXPORT_RELOAD_MAX_ATTEMPTS) {
        const nextAttempt = reloadAttempt + 1;
        updateExportAlbumsState({
          running: false,
          phase: "reloading",
          status: "首屏分页未命中，自动重试",
          current: `第 ${reloadAttempt} 次刷新未捕获 offset=0，准备自动进行第 ${nextAttempt} 次刷新。`,
          testedScrollers: 0,
          totalScrollers: topCandidates.length,
          capturedPages: 0,
          exportedCount: 0
        });
        logExportAlbums(`首轮未捕获 offset=0，自动重试第 ${nextAttempt} 次刷新`);
        setPendingExportAlbumsReload(String(nextAttempt));
        location.href = buildLibraryAlbumsUrl();
        return;
      }

      updateExportAlbumsState({
        phase: "finding-scroller",
        status: "正在寻找滚动容器",
        current: `当前页面：${location.pathname}\n候选滚动容器：${formatWholeNumber(topCandidates.length)} 个`,
        testedScrollers: 0,
        totalScrollers: topCandidates.length,
        capturedPages: tracker.pageUrls.size,
        exportedCount: tracker.itemsById.size
      });
      logExportAlbums(`候选滚动容器数量：${formatWholeNumber(candidates.length)}`);

      if (!topCandidates.length) {
        if (tracker.itemsById.size > 0) {
          logExportAlbums(`未识别到滚动容器，但已捕获 ${formatWholeNumber(tracker.itemsById.size)} 张专辑，直接导出已捕获数据`);
        } else {
          logExportAlbums("没找到明显的滚动容器");
        }

        updateExportAlbumsState({
          running: false,
          phase: tracker.itemsById.size === 0 ? "no-scroller" : "capturing",
          status: tracker.itemsById.size === 0 ? "未找到滚动容器" : "已捕获首屏专辑数据",
          current: tracker.itemsById.size === 0
            ? "当前页面未识别到明显的专辑列表滚动区域。"
            : `未识别到滚动容器，改为导出已捕获的 ${formatWholeNumber(tracker.itemsById.size)} 张专辑。`,
          capturedPages: tracker.pageUrls.size,
          exportedCount: tracker.itemsById.size
        });
        if (tracker.itemsById.size === 0) {
          return;
        }
      }

      for (let i = 0; i < topCandidates.length; i++) {
        logExportAlbums(`测试第 ${i + 1} 个滚动容器`);
        await tryAlbumsScroller(topCandidates[i], tracker, i, topCandidates.length, 260, stopFn);
        if (stopFn()) return;

        if (tracker.total && tracker.itemsById.size >= tracker.total) {
          break;
        }

        if (tracker.itemsById.size > 0 && tracker.pageUrls.size > 0) {
          break;
        }
      }

      logExportAlbums("滚动已完成，等待后台分页请求收尾");
      await waitForAlbumsRequestsToSettle(tracker, {
        quietMs: tracker.total && tracker.itemsById.size < tracker.total ? 4500 : 2500,
        maxWaitMs: 20000
      }, stopFn);
      if (stopFn()) return;

      const items = Array.from(tracker.itemsById.values())
        .sort((a, b) => a.name.localeCompare(b.name) || a.artistName.localeCompare(b.artistName) || a.id.localeCompare(b.id));

      if (!items.length) {
        updateExportAlbumsState({
          running: false,
          phase: "empty-result",
          status: "没有捕获到专辑数据",
          current: "请确认当前页面已加载专辑列表，并且向下滚动时会触发分页请求。",
          capturedPages: tracker.pageUrls.size,
          exportedCount: 0
        });
        logExportAlbums("没有捕获到任何专辑分页数据");
        return;
      }

      const csv = buildAlbumsCsv(items);
      const exportPayload = {
        exportedAt: formatChinaDateTime(),
        storefront: getStorefront(),
        displayLanguage: getLanguage(),
        displayLanguageName: getLanguageLabel(getLanguage()),
        items
      };
      download("apple_music_library_albums.csv", csv, "text/csv;charset=utf-8");
      download("apple_music_library_albums.json", JSON.stringify(exportPayload, null, 2), "application/json");

      updateExportAlbumsState({
        running: false,
        phase: "completed",
        status: `导出完成，共 ${formatWholeNumber(items.length)} 张专辑`,
        current: `已捕获分页 ${formatWholeNumber(tracker.pageUrls.size)} 页${tracker.total ? ` / 预估 ${formatWholeNumber(tracker.total)} 张` : ""}\n导出文件：apple_music_library_albums.csv\n导出文件：apple_music_library_albums.json`,
        testedScrollers: topCandidates.length ? Math.min(topCandidates.length, Math.max(1, exportAlbumsState.testedScrollers)) : 0,
        totalScrollers: topCandidates.length,
        capturedPages: tracker.pageUrls.size,
        exportedCount: items.length
      });
      logExportAlbums(`导出完成，共 ${formatWholeNumber(items.length)} 张专辑`);
    } catch (error) {
      updateExportAlbumsState({
        running: false,
        phase: "error",
        status: "导出失败",
        current: cleanText(error?.message || String(error) || "未知错误")
      });
      logExportAlbums(`导出失败：${error?.stack || error?.message || error}`);
    } finally {
      teardownAlbumsRequestInterceptor();
    }
  }

  function resumeExportAlbumsAfterReload() {
    const startedAt = Date.now();
    const timeout = 30000;

    updateExportAlbumsState({
      running: false,
      phase: "waiting-page",
      status: "正在等待专辑页面完成加载",
      current: `当前路径：${location.pathname}\n正在等待进入资料库-专辑页面...`,
      testedScrollers: 0,
      totalScrollers: 0,
      capturedPages: 0,
      exportedCount: 0
    });

    const tick = () => {
      if (!getPendingExportAlbumsReload()) return;

      if (onLibraryAlbumsPage()) {
        const reloadAttempt = parsePendingExportReloadAttempt(getPendingExportAlbumsReload());
        logExportAlbums(`检测到待继续的导出专辑任务，当前路径：${location.pathname}${location.search}`);
        Promise.resolve(exportAlbumsFromLibrary({ skipReload: true, resumedFromPending: true, reloadAttempt }))
          .finally(() => {
            if (getPendingExportAlbumsReload()) {
              setTimeout(tick, 500);
            }
          });
        return;
      }

      if (Date.now() - startedAt >= timeout) {
        clearPendingExportAlbumsReload();
        updateExportAlbumsState({
          running: false,
          phase: "error",
          status: "等待页面超时",
          current: `自动跳转到标准专辑页超时。\n当前路径：${location.pathname}`,
          testedScrollers: 0,
          totalScrollers: 0,
          capturedPages: 0,
          exportedCount: 0
        });
        logExportAlbums(`等待专辑页超时：${location.pathname}`);
        return;
      }

      setTimeout(tick, 500);
    };

    setTimeout(tick, 500);
  }

  function setupPendingAlbumsBootstrapInterceptor() {
    if (!getPendingExportAlbumsReload() || albumsInterceptorRestore || songsInterceptorRestore) {
      return;
    }

    bootstrapAlbumsTracker = createAlbumsExportTracker();
    ensureAlbumsRequestInterceptor(bootstrapAlbumsTracker, { silent: true });
  }

  async function exportPlaylistFromDom() {
    if (exportPlaylistsState.running) {
      alert("导出任务正在执行中");
      return;
    }

    if (!onPlaylistDetailPage()) {
      updateExportPlaylistsState({
        running: false,
        phase: "wrong-page",
        status: "当前页面不是播放列表详情页",
        current: `请在播放列表详情页执行。\n当前路径：${location.pathname}\n示例：/library/playlist/p.9oDKLZQUP6zG9ga`,
        testedScrollers: 0,
        totalScrollers: 0,
        exportedCount: 0
      });
      logExportPlaylists(`当前页面不是播放列表详情页：${location.pathname}${location.search}`);
      alert("请在播放列表详情页执行导出播放列表");
      return;
    }

    const stopFn = () => isExportPlaylistsStopped();
    const playlistName = getPlaylistName();
    const playlistDescription = getPlaylistDescription();

    updateExportPlaylistsState({
      running: true,
      phase: "preparing",
      status: "正在准备导出播放列表",
      current: `播放列表：${playlistName}\n正在等待歌曲列表与滚动区域出现...`,
      testedScrollers: 0,
      totalScrollers: 0,
      exportedCount: 0
    });
    logExportPlaylists(`开始导出播放列表：${playlistName}`);

    try {
      const { rows, candidates } = await waitForPlaylistRowsOrCandidates(15000, stopFn);
      if (stopFn()) return;

      const topCandidates = candidates.slice(0, 8);
      logExportPlaylists(`候选滚动容器数量：${candidates.length}`);

      updateExportPlaylistsState({
        phase: "finding-scroller",
        status: topCandidates.length ? "正在测试滚动容器" : "正在整理当前可见歌曲",
        current: topCandidates.length
          ? `播放列表：${playlistName}\n候选滚动容器：${formatWholeNumber(topCandidates.length)} 个`
          : `播放列表：${playlistName}\n当前可见歌曲：${formatWholeNumber(rows.length)} 首`,
        testedScrollers: 0,
        totalScrollers: topCandidates.length,
        exportedCount: rows.length
      });

      let items = [];

      if (!topCandidates.length) {
        if (!rows.length) {
          updateExportPlaylistsState({
            running: false,
            phase: "empty-result",
            status: "没有找到可导出的播放列表歌曲",
            current: "请先打开某个播放列表详情页，并确保歌曲列表已经加载。"
          });
          logExportPlaylists("没有抓到歌曲。请确认当前页面就是播放列表详情页。");
          return;
        }

        logExportPlaylists("未识别到明显的滚动容器，改为直接导出当前可见歌曲");
        items = rows;
      } else {
        const results = [];
        for (let i = 0; i < topCandidates.length; i++) {
          if (stopFn()) return;
          logExportPlaylists(`测试第 ${i + 1} 个滚动容器`);
          try {
            const result = await tryPlaylistScroller(topCandidates[i], i, topCandidates.length, 260, stopFn);
            if (stopFn()) return;
            if (result) {
              results.push(result);
              logExportPlaylists(`第 ${i + 1} 个容器抓到 ${formatWholeNumber(result.count)} 首`);
            }
          } catch (error) {
            logExportPlaylists(`第 ${i + 1} 个容器失败：${cleanText(error?.message || error)}`);
          }
        }

        results.sort((a, b) => b.count - a.count);
        const best = results[0];
        items = best?.items || rows;
      }

      if (stopFn()) return;

      items = sortPlaylistItemsForExport(items);

      if (!items.length) {
        updateExportPlaylistsState({
          running: false,
          phase: "empty-result",
          status: "没有找到可导出的播放列表歌曲",
          current: "请先打开某个播放列表详情页，并确保歌曲列表已经加载。"
        });
        logExportPlaylists("没有抓到歌曲。请确认当前页面就是播放列表详情页。");
        return;
      }

      const csv = buildPlaylistCsv(playlistName, playlistDescription, items);
      const payload = buildPlaylistExportPayload(playlistName, playlistDescription, items);
      const filenameBase = sanitizeFilename(`apple_music_playlist_${playlistName}`, "apple_music_playlist");

      download(`${filenameBase}.csv`, csv, "text/csv;charset=utf-8");
      download(`${filenameBase}.json`, JSON.stringify(payload, null, 2), "application/json");

      updateExportPlaylistsState({
        running: false,
        phase: "completed",
        status: `导出完成，共 ${formatWholeNumber(items.length)} 首歌曲`,
        current: `播放列表：${playlistName}\n导出文件：${filenameBase}.csv\n导出文件：${filenameBase}.json`,
        testedScrollers: topCandidates.length ? Math.min(topCandidates.length, Math.max(exportPlaylistsState.testedScrollers, 1)) : 0,
        totalScrollers: topCandidates.length,
        exportedCount: items.length
      });
      logExportPlaylists(`导出完成，共 ${formatWholeNumber(items.length)} 首`);
    } catch (error) {
      if (stopFn()) return;
      updateExportPlaylistsState({
        running: false,
        phase: "error",
        status: "导出失败",
        current: cleanText(error?.message || String(error) || "未知错误")
      });
      logExportPlaylists(`导出失败：${error?.stack || error?.message || error}`);
    }
  }

  function makeSearchUrl(item) {
    const q = getSearchQuery(item);
    const sf = getStorefront();
    return buildLanguageAwareUrl(`https://music.apple.com/${sf}/search?term=${encodeURIComponent(q)}`);
  }

  function getImportMediaLabel(mediaType) {
    if (mediaType === "songs") return "歌曲";
    if (mediaType === "playlists") return "播放列表";
    return "专辑";
  }

  function getPayloadList(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.tracks)) return payload.tracks;
    if (Array.isArray(payload?.items)) return payload.items;
    return [];
  }

  function detectImportPayloadKind(payload) {
    if (!payload || typeof payload !== "object") {
      return Array.isArray(payload) ? "albums" : "unknown";
    }

    if (Array.isArray(payload?.tracks) || cleanText(payload?.playlistName || payload?.playlistDescription)) {
      return "playlists";
    }

    const items = getPayloadList(payload).slice(0, 5).filter(Boolean);
    if (!items.length) {
      return Array.isArray(payload) ? "albums" : "unknown";
    }

    const hasAlbumNameField = items.some(item => cleanText(item?.albumName));
    const hasAlbumField = items.some(item => cleanText(item?.album));
    const hasSongLikeId = items.every(item => cleanText(item?.id));

    if (hasSongLikeId && hasAlbumNameField && !hasAlbumField) {
      return "songs";
    }

    return "albums";
  }

  function validateImportPayloadForMediaType(payload, mediaType) {
    const expectedLabel = getImportMediaLabel(mediaType);
    const detectedKind = detectImportPayloadKind(payload);
    const detectedLabel = getImportMediaLabel(detectedKind);
    const list = getPayloadList(payload);

    if (mediaType === "playlists") {
      if (!payload || typeof payload !== "object" || !Array.isArray(payload?.tracks)) {
        return {
          ok: false,
          message: `导入${expectedLabel}时，JSON 必须包含 tracks 数组。当前文件不是播放列表导出 JSON。`
        };
      }

      if (!cleanText(payload?.playlistName || payload?.name)) {
        return {
          ok: false,
          message: "导入播放列表时，JSON 缺少播放列表名 playlistName。"
        };
      }

      const invalidItem = list.find(item => !cleanText(item?.id));
      if (invalidItem) {
        return {
          ok: false,
          message: "导入播放列表时，tracks 中每一条都必须包含歌曲 id。"
        };
      }

      return { ok: true, list };
    }

    if (mediaType === "songs") {
      if (detectedKind === "playlists") {
        return {
          ok: false,
          message: `当前文件是${detectedLabel}导出 JSON，不是${expectedLabel}导出 JSON。`
        };
      }

      if (!list.length) {
        return {
          ok: false,
          message: "导入歌曲时，JSON 中没有可用的 items 数据。"
        };
      }

      const invalidItem = list.find(item => !cleanText(item?.id));
      if (invalidItem) {
        return {
          ok: false,
          message: "导入歌曲时，items 中每一条都必须包含歌曲 id。"
        };
      }

      const sampleHasAlbumName = list.some(item => cleanText(item?.albumName));
      if (!sampleHasAlbumName) {
        return {
          ok: false,
          message: "当前文件不像歌曲导出 JSON，缺少 albumName 字段。"
        };
      }

      return { ok: true, list };
    }

    if (detectedKind === "songs" || detectedKind === "playlists") {
      return {
        ok: false,
        message: `当前文件是${detectedLabel}导出 JSON，不是${expectedLabel}导出 JSON。`
      };
    }

    if (!list.length) {
      return {
        ok: false,
        message: "导入专辑时，JSON 中没有可用的 items 数据。"
      };
    }

    const invalidAlbum = list.find(item => !(cleanText(item?.id) || cleanText(item?.album || item?.name || item?.title)));
    if (invalidAlbum) {
      return {
        ok: false,
        message: "导入专辑时，每一条至少需要包含专辑 id 或专辑名。"
      };
    }

    return { ok: true, list };
  }

  function mapImportItems(rawItems, mediaType) {
    return rawItems
      .map(x => mediaType === "songs" || mediaType === "playlists"
        ? {
            id: cleanText(x.id),
            name: cleanText(x.name || x.song || x.title || ""),
            artistName: cleanText(x.artistName || x.artist || ""),
            albumName: cleanText(x.albumName || x.album || "")
          }
        : {
            id: cleanText(x.id),
            name: cleanText(x.name || x.album || x.title || ""),
            artistName: cleanText(x.artistName || x.artist || ""),
            album: cleanText(x.album || x.name || x.title || ""),
            artist: cleanText(x.artist || x.artistName || "")
          })
      .filter(x => mediaType === "songs" || mediaType === "playlists" ? x.id : (x.id || x.album));
  }

  function getSearchQuery(item) {
    return `${item?.artist || ""} ${item?.album || ""}`.trim();
  }

  function getImportMediaType(state) {
    const mediaType = cleanText(state?.mediaType).toLowerCase();
    if (mediaType === "songs") return "songs";
    if (mediaType === "playlists") return "playlists";
    return "albums";
  }

  function isImportProcessingState(state) {
    const shaped = ensureImportStateShape(state);
    if (!shaped) return false;
    if (shaped.pendingAction === "process-current-item") return true;
    if (shaped.running) return true;
    return !IMPORT_IDLE_PHASES.has(cleanText(shaped.phase));
  }

  function ensureImportStateShape(state) {
    if (!state || typeof state !== "object") return state;
    if (!Array.isArray(state.items)) state.items = [];
    if (!Array.isArray(state.done)) state.done = [];
    if (!Array.isArray(state.failed)) state.failed = [];
    if (!Array.isArray(state.skipped)) state.skipped = [];
    if (!Array.isArray(state.missing)) state.missing = [];
    if (typeof state.resultDialogShown !== "boolean") state.resultDialogShown = false;
    if (!["songs", "albums", "playlists"].includes(state.mediaType)) {
      state.mediaType = "albums";
    }
    if (typeof state.playlistName !== "string") state.playlistName = "";
    if (typeof state.playlistDescription !== "string") state.playlistDescription = "";
    if (typeof state.playlistCreated !== "boolean") state.playlistCreated = false;
    return state;
  }

  function getImportCounts(state) {
    const shaped = ensureImportStateShape(state);
    return {
      total: shaped?.items?.length || 0,
      done: shaped?.done?.length || 0,
      failed: shaped?.failed?.length || 0,
      skipped: shaped?.skipped?.length || 0,
      missing: shaped?.missing?.length || 0
    };
  }

  function getProcessedCount(state) {
    const counts = getImportCounts(state);
    return counts.done + counts.failed + counts.skipped + counts.missing;
  }

  function buildImportResultPayload(state) {
    const shaped = ensureImportStateShape(state || {});
    const mediaType = getImportMediaType(shaped);
    const counts = getImportCounts(shaped);
    const processed = getProcessedCount(shaped);

    const payload = {
      exportedAt: formatChinaDateTime(),
      storefront: getStorefront(),
      displayLanguage: getLanguage(),
      displayLanguageName: getLanguageLabel(getLanguage()),
      mediaType,
      summary: {
        total: counts.total,
        processed,
        success: counts.done,
        failed: counts.failed,
        missing: counts.missing,
        skipped: counts.skipped,
        pending: Math.max(0, counts.total - processed)
      },
      successList: shaped.done,
      failedList: shaped.failed,
      missingList: shaped.missing,
      skippedList: shaped.skipped
    };

    if (mediaType === "playlists") {
      payload.playlistName = cleanText(shaped.playlistName);
      payload.playlistDescription = cleanText(shaped.playlistDescription);
    }

    return payload;
  }

  function csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function getImportResultDetailRow(mediaType, status, item) {
    if (mediaType === "songs" || mediaType === "playlists") {
      return [
        status,
        cleanText(item?.id),
        cleanText(item?.name),
        cleanText(item?.artistName),
        cleanText(item?.albumName),
        cleanText(item?.reason)
      ];
    }

    return [
      status,
      cleanText(item?.id),
      cleanText(item?.name || item?.album),
      cleanText(item?.artistName || item?.artist),
      "",
      cleanText(item?.reason)
    ];
  }

  function buildImportResultCsv(result) {
    const summary = result.summary || {};
    const mediaLabel = result.mediaType === "songs"
      ? "歌曲"
      : (result.mediaType === "playlists" ? "播放列表" : "专辑");
    const rows = [
      ["报表名称", `${mediaLabel}导入结果报表`],
      ["导出时间", result.exportedAt || ""],
      ["当前区服", result.storefront || ""],
      ["显示语言", `${result.displayLanguageName || getLanguageLabel(result.displayLanguage || "")} (${result.displayLanguage || ""})`],
      ["媒体类型", mediaLabel],
      [],
      ["汇总指标", "数值"],
      ["总数", summary.total || 0],
      ["已处理", summary.processed || 0],
      ["成功", summary.success || 0],
      ["失败", summary.failed || 0],
      ["不存在", summary.missing || 0],
      ["跳过", summary.skipped || 0],
      ["待处理", summary.pending || 0],
      [],
      ["明细列表"],
      ["处理结果", "ID", "名称", "歌手名", "专辑名", "原因"]
    ];

    if (result.mediaType === "playlists") {
      rows.splice(5, 0, ["播放列表名", result.playlistName || ""], ["播放列表简介", result.playlistDescription || ""], []);
    }

    const sections = [
      ["成功", result.successList || []],
      ["失败", result.failedList || []],
      ["不存在", result.missingList || []],
      ["跳过", result.skippedList || []]
    ];

    for (const [label, items] of sections) {
      if (!items.length) continue;
      rows.push([`${label}明细`]);
      for (const item of items) {
        rows.push(getImportResultDetailRow(result.mediaType, label, item));
      }
      rows.push([]);
    }

    return rows.map(row => row.map(csvCell).join(",")).join("\n");
  }

  function getActiveProcessingTask() {
    if (isExportAlbumsProcessing()) {
      const pendingReload = !!getPendingExportAlbumsReload();
      const genericCurrent = `正在跳转到标准专辑页：${buildLibraryAlbumsUrl()}`;
      return {
        type: "export-albums",
        title: "正在导出专辑",
        progress: `已导出 ${formatWholeNumber(exportAlbumsState.exportedCount || 0)} 张 ｜ 分页 ${formatWholeNumber(exportAlbumsState.capturedPages || 0)}${exportAlbumsState.totalScrollers ? ` ｜ 容器 ${formatWholeNumber(exportAlbumsState.testedScrollers || 0)}/${formatWholeNumber(exportAlbumsState.totalScrollers)}` : ""}`,
        status: pendingReload && !exportAlbumsState.running && !EXPORT_ACTIVE_PHASES.has(exportAlbumsState.phase)
          ? "正在刷新专辑页面"
          : (exportAlbumsState.status || "正在处理中"),
        current: pendingReload && !exportAlbumsState.running && !EXPORT_ACTIVE_PHASES.has(exportAlbumsState.phase)
          ? genericCurrent
          : (exportAlbumsState.current || "正在处理，请勿操作页面。")
      };
    }

    if (isExportSongsProcessing()) {
      const pendingReload = !!getPendingExportSongsReload();
      const genericCurrent = `正在跳转到标准歌曲页：${buildLibrarySongsUrl()}`;
      return {
        type: "export-songs",
        title: "正在导出歌曲",
        progress: `已导出 ${formatWholeNumber(exportSongsState.exportedCount || 0)} 首 ｜ 分页 ${formatWholeNumber(exportSongsState.capturedPages || 0)}${exportSongsState.totalScrollers ? ` ｜ 容器 ${formatWholeNumber(exportSongsState.testedScrollers || 0)}/${formatWholeNumber(exportSongsState.totalScrollers)}` : ""}`,
        status: pendingReload && !exportSongsState.running && !EXPORT_ACTIVE_PHASES.has(exportSongsState.phase)
          ? "正在刷新歌曲页面"
          : (exportSongsState.status || "正在处理中"),
        current: pendingReload && !exportSongsState.running && !EXPORT_ACTIVE_PHASES.has(exportSongsState.phase)
          ? genericCurrent
          : (exportSongsState.current || "正在处理，请勿操作页面。")
      };
    }

    if (isExportPlaylistsProcessing()) {
      return {
        type: "export-playlists",
        title: "正在导出播放列表",
        progress: `已导出 ${formatWholeNumber(exportPlaylistsState.exportedCount || 0)} 首${exportPlaylistsState.totalScrollers ? ` ｜ 容器 ${formatWholeNumber(exportPlaylistsState.testedScrollers || 0)}/${formatWholeNumber(exportPlaylistsState.totalScrollers)}` : ""}`,
        status: exportPlaylistsState.status || "正在处理中",
        current: exportPlaylistsState.current || "正在处理，请勿操作页面。"
      };
    }

    const state = loadState();
    if (!isImportProcessingState(state)) {
      return null;
    }

    const mediaType = getImportMediaType(state);
    const item = getCurrentItem(state);
    const counts = getImportCounts(state);
    const currentIndex = Math.min((state?.index || 0) + 1, Math.max(counts.total, 1));
    return {
      type: mediaType === "songs"
        ? "import-songs"
        : (mediaType === "playlists" ? "import-playlists" : "import-albums"),
      title: mediaType === "songs"
        ? "正在导入歌曲"
        : (mediaType === "playlists" ? "正在导入播放列表" : "正在导入专辑"),
      progress: `当前第 ${counts.total ? formatWholeNumber(currentIndex) : "0"} / ${formatWholeNumber(counts.total)} 条 ｜ 已处理 ${formatWholeNumber(getProcessedCount(state))} 条`,
      status: state.running ? "正在处理中" : "正在跳转并继续处理",
      current: formatCurrentItem(state, item)
    };
  }

  function stopActiveProcessingTask(task) {
    if (!task) return;
    if (task.type === "export-albums") {
      stopExportAlbumsTask();
      return;
    }
    if (task.type === "export-songs") {
      stopExportSongsTask();
      return;
    }
    if (task.type === "export-playlists") {
      stopExportPlaylistsTask();
      return;
    }
    stopImportTask();
  }

  function getVisibleTopLayerDialog() {
    const dialog = document.querySelector('dialog[data-testid="dialog"][open]');
    return dialog && isVisibleNode(dialog) ? dialog : null;
  }

  function renderProcessingMask() {
    if (!document.body) return;

    const task = getActiveProcessingTask();
    let mask = document.getElementById("__am_processing_mask__");
    const hostDialog = getVisibleTopLayerDialog();

    if (!task) {
      if (mask) mask.remove();
      return;
    }

    if (!mask) {
      mask = document.createElement("div");
      mask.id = "__am_processing_mask__";
      mask.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: ${TOOL_OVERLAY_Z_INDEX};
        background: rgba(0, 0, 0, 0.58);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
      `;
      mask.innerHTML = `
        <div style="width:420px;max-width:92vw;background:rgba(28, 28, 30, 0.98);color:#f5f5f7;border:1px solid rgba(255,255,255,0.08);border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,0.35);padding:16px;font:12px/1.5 -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif;">
          <div id="__am_processing_title__" style="font-size:14px;font-weight:600;margin-bottom:10px;"></div>
          <div id="__am_processing_progress__" style="padding:8px 10px;border-radius:10px;background:#232326;margin-bottom:10px;color:#f5f5f7;"></div>
          <div id="__am_processing_status__" style="padding:8px 10px;border-radius:10px;background:#232326;margin-bottom:10px;"></div>
          <div id="__am_processing_current__" style="padding:10px;border-radius:10px;background:#232326;color:#cfcfcf;white-space:pre-wrap;"></div>
          <div style="display:grid;grid-template-columns:1fr;gap:8px;margin-top:12px;">
            <button id="__am_processing_stop__" style="padding:10px 12px;border:none;border-radius:10px;background:#fa2d48;color:#fff;cursor:pointer;">停止</button>
          </div>
          <div style="margin-top:8px;color:#8e8e93;font-size:11px;">处理中请勿操作页面，停止或处理完成后会自动关闭。</div>
        </div>
      `;
    }

    const desiredHost = hostDialog || document.body;
    if (mask.parentElement !== desiredHost) {
      mask.remove();
      desiredHost.appendChild(mask);
    }

    const card = mask.firstElementChild;
    if (hostDialog) {
      if (!hostDialog.dataset.amrPositionPatched) {
        hostDialog.style.position = "relative";
        hostDialog.dataset.amrPositionPatched = "true";
      }
      mask.style.cssText = `
        position: absolute;
        top: 12px;
        right: 12px;
        inset: auto 12px auto auto;
        z-index: 2147483647;
        background: transparent;
        display: block;
        padding: 0;
        pointer-events: none;
      `;
      if (card) {
        card.style.cssText = `
          width: 280px;
          max-width: min(280px, calc(100vw - 48px));
          background: rgba(28, 28, 30, 0.98);
          color: #f5f5f7;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
          box-shadow: 0 18px 48px rgba(0,0,0,0.35);
          padding: 12px;
          font: 12px/1.5 -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif;
          pointer-events: auto;
        `;
      }
    } else {
      mask.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: ${TOOL_OVERLAY_Z_INDEX};
        background: rgba(0, 0, 0, 0.58);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        pointer-events: auto;
      `;
      if (card) {
        card.style.cssText = `
          width:420px;
          max-width:92vw;
          background:rgba(28, 28, 30, 0.98);
          color:#f5f5f7;
          border:1px solid rgba(255,255,255,0.08);
          border-radius:14px;
          box-shadow:0 18px 48px rgba(0,0,0,0.35);
          padding:16px;
          font:12px/1.5 -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif;
        `;
      }
    }

    mask.querySelector("#__am_processing_title__").textContent = task.title;
    mask.querySelector("#__am_processing_progress__").textContent = task.progress || "处理中";
    mask.querySelector("#__am_processing_status__").textContent = task.status;
    mask.querySelector("#__am_processing_current__").textContent = task.current;
    mask.querySelector("#__am_processing_stop__").onclick = () => stopActiveProcessingTask(task);
  }

  function showImportResultDialog(result) {
    if (!document.body) {
      setTimeout(() => showImportResultDialog(result), 200);
      return;
    }

    const oldMask = document.getElementById("__am_import_result_mask__");
    if (oldMask) oldMask.remove();

    const mediaLabel = result.mediaType === "songs"
      ? "歌曲"
      : (result.mediaType === "playlists" ? "播放列表" : "专辑");
    const summary = result.summary || {};
    const filename = result.mediaType === "songs"
      ? "apple_music_song_restore_result.csv"
      : (result.mediaType === "playlists"
        ? "apple_music_playlist_restore_result.csv"
        : "apple_music_album_restore_result.csv");

    const mask = document.createElement("div");
    mask.id = "__am_import_result_mask__";
    mask.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: ${TOOL_RESULT_Z_INDEX};
      background: rgba(0, 0, 0, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    `;

    const box = document.createElement("div");
    box.style.cssText = `
      width: 420px;
      max-width: 92vw;
      background: rgba(28, 28, 30, 0.98);
      color: #f5f5f7;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px;
      box-shadow: 0 18px 48px rgba(0,0,0,0.35);
      padding: 16px;
      font: 12px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
    `;

    box.innerHTML = `
      <div style="font-size:14px;font-weight:600;margin-bottom:10px;">${mediaLabel}导入结果</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
        <div style="padding:8px;border-radius:10px;background:#232326;">总数：${summary.total || 0}</div>
        <div style="padding:8px;border-radius:10px;background:#232326;">已处理：${summary.processed || 0}</div>
        <div style="padding:8px;border-radius:10px;background:#232326;">成功：${summary.success || 0}</div>
        <div style="padding:8px;border-radius:10px;background:#232326;">失败：${summary.failed || 0}</div>
        <div style="padding:8px;border-radius:10px;background:#232326;">不存在：${summary.missing || 0}</div>
        <div style="padding:8px;border-radius:10px;background:#232326;">跳过：${summary.skipped || 0}</div>
      </div>
      <div style="padding:10px;border-radius:10px;background:#232326;color:#cfcfcf;white-space:pre-wrap;">当前区服：${result.storefront || ""}
显示语言：${getLanguageLabel(result.displayLanguage || "")} (${result.displayLanguage || ""})
${result.mediaType === "playlists" ? `播放列表名：${result.playlistName || ""}\n播放列表简介：${result.playlistDescription || ""}\n` : ""}失败列表：${result.failedList?.length || 0} 条
不存在列表：${result.missingList?.length || 0} 条
跳过列表：${result.skippedList?.length || 0} 条
成功列表：${result.successList?.length || 0} 条</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;">
        <button id="__am_import_result_download__" style="padding:9px 10px;border:none;border-radius:10px;background:#fa2d48;color:#fff;cursor:pointer;">下载结果 CSV</button>
        <button id="__am_import_result_close__" style="padding:9px 10px;border:none;border-radius:10px;background:#3a3a3c;color:#fff;cursor:pointer;">关闭</button>
      </div>
      <div style="margin-top:8px;color:#8e8e93;font-size:11px;">文件名：${filename}</div>
    `;

    mask.appendChild(box);
    document.body.appendChild(mask);

    const close = () => mask.remove();
    mask.addEventListener("click", (event) => {
      if (event.target === mask) close();
    });
    box.querySelector("#__am_import_result_close__").onclick = close;
    box.querySelector("#__am_import_result_download__").onclick = () => {
      download(filename, buildImportResultCsv(result), "text/csv;charset=utf-8");
      close();
    };
  }

  function autoShowImportResultDialog(state) {
    const shaped = ensureImportStateShape(state);
    if (!shaped || shaped.resultDialogShown) return false;

    const result = buildImportResultPayload(shaped);
    if ((result.summary?.total || 0) <= 0 || (result.summary?.pending || 0) > 0) {
      return false;
    }

    shaped.resultDialogShown = true;
    saveState(shaped);
    render();
    showImportResultDialog({
      ...result,
      mediaType: getImportMediaType(shaped)
    });
    return true;
  }

  function persistImportProgress(state, completionLog = "全部完成") {
    const shaped = ensureImportStateShape(state);
    const item = getCurrentItem(shaped);

    if (!item) {
      shaped.running = false;
      shaped.runToken = null;
      shaped.pendingAction = null;
      shaped.phase = "completed";
      saveState(shaped);
      render();
      log(completionLog);
      autoShowImportResultDialog(shaped);
      return true;
    }

    saveState(shaped);
    render();
    return false;
  }

  function getItemNavigationUrl(state, item) {
    if (!item) return "";
    if (["songs", "playlists"].includes(getImportMediaType(state))) {
      return buildSongUrl(item.id);
    }
    return cleanText(item?.id)
      ? buildAlbumUrl(item.id)
      : makeSearchUrl(item);
  }

  function formatCurrentItem(state, item) {
    if (!item) return "已全部处理完成";

    if (getImportMediaType(state) === "playlists") {
      return `播放列表：${state?.playlistName || "(空)"}\n简介：${state?.playlistDescription || "(空)"}\nID：${item.id}\n歌曲：${item.name || "(空)"}\n艺人：${item.artistName || "(空)"}\n专辑：${item.albumName || "(空)"}`;
    }

    if (getImportMediaType(state) === "songs") {
      return `ID：${item.id}\n歌曲：${item.name || "(空)"}\n艺人：${item.artistName || "(空)"}\n专辑：${item.albumName || "(空)"}`;
    }

    return `ID：${item.id || "(空)"}\n专辑：${item.name || item.album || "(空)"}\n艺人：${item.artistName || item.artist || "(空)"}`;
  }

  function scoreMatch(targetArtist, targetAlbum, candArtist, candAlbum) {
    let score = 0;

    const ta = normalize(targetArtist);
    const tb = normalize(targetAlbum);
    const ca = normalize(candArtist);
    const cb = normalize(candAlbum);

    if (tb && cb === tb) score += 70;
    else if (tb && cb && (cb.includes(tb) || tb.includes(cb))) score += 30;

    if (ta && ca === ta) score += 50;
    else if (ta && ca && (ca.includes(ta) || ta.includes(ca))) score += 20;

    return score;
  }

  function scoreAlbumCandidate(targetArtist, targetAlbum, candidate) {
    let score = 0;

    const ta = normalize(targetArtist);
    const tb = normalize(targetAlbum);
    const ca = normalize(candidate.artist);
    const cb = normalize(candidate.title);
    const ct = normalize(candidate.type);

    if (ct === normalize("专辑") || ct === normalize("album")) {
      score += 40;
    } else {
      score -= 50;
    }

    if (tb && cb === tb) score += 80;
    else if (tb && cb && (cb.includes(tb) || tb.includes(cb))) score += 30;

    if (ta && ca === ta) score += 60;
    else if (ta && ca && (ca.includes(ta) || ta.includes(ca))) score += 20;

    console.log(`评分: ${score} | 目标：${targetArtist} - ${targetAlbum} | 当前候选：${candidate.artist} - ${candidate.title}`);

    return score;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? ensureImportStateShape(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function removeState() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function loadLogs() {
    try {
      const raw = localStorage.getItem(LOG_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveLogs(logs) {
    localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logs));
  }

  function clearLogs() {
    localStorage.removeItem(LOG_STORAGE_KEY);
  }

  function prepareLogsForTransferAction() {
    clearLogs();
    syncLogBox();
  }

  function syncLogBox() {
    const logs = loadLogs();
    const boxes = document.querySelectorAll(".amr-log-box");
    if (!boxes.length) return;

    for (const box of boxes) {
      box.innerHTML = "";
      for (const text of logs) {
        const line = document.createElement("div");
        line.textContent = text;
        box.appendChild(line);
      }
    }
  }

  function getCurrentItem(state) {
    return state?.items?.[state.index] || null;
  }

  function stopImportTask(logMessage = "已手动停止导入任务") {
    const state = loadState();
    if (!state) return false;
    state.running = false;
    state.runToken = null;
    state.phase = "stopped";
    state.pendingAction = null;
    saveState(state);
    currentRunToken = null;
    render();
    log(logMessage);
    return true;
  }

  function newRunToken() {
    return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  function isRunValid(token) {
    const state = loadState();
    return !!state && state.running && state.runToken === token && currentRunToken === token;
  }

  function log(msg) {
    console.log("[AM Restore]", msg);
    const logs = loadLogs();
    logs.unshift(`[${new Date().toLocaleTimeString()}] ${msg}`);
    saveLogs(logs.slice(0, 200));
    syncLogBox();
  }

  async function pickJsonFile() {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.onchange = async () => {
        try {
          const file = input.files[0];
          if (!file) return reject(new Error("未选择文件"));
          const text = await file.text();
          resolve(JSON.parse(text));
        } catch (e) {
          reject(e);
        }
      };
      input.click();
    });
  }

  function getActionMeta(action) {
    switch (action) {
      case "export-albums":
        return {
          title: "导出专辑",
          desc: "导出当前资料库中的专辑收藏记录。"
        };
      case "export-songs":
        return {
          title: "导出歌曲",
          desc: "在资料库歌曲页模拟滚动，并拦截分页接口导出歌曲记录。"
        };
      case "export-playlists":
        return {
          title: "导出播放列表",
          desc: "从当前播放列表详情页按页面顺序抓取歌曲，并导出成可重建歌单的 CSV / JSON。"
        };
      case "import-playlists":
        return {
          title: "导入播放列表",
          desc: "按歌曲 ID 逐条打开歌曲详情页，并按顺序加入或新建目标播放列表。"
        };
      case "import-albums":
        return {
          title: "导入专辑",
          desc: "按专辑 ID 逐条打开专辑详情页，自动判断是否可添加到资料库。"
        };
      case "import-songs":
        return {
          title: "导入歌曲",
          desc: "按歌曲 ID 逐条打开歌曲详情页，自动判断是否可添加到资料库。"
        };
      default:
        return {
          title: "Apple Music 迁移工具",
          desc: "请选择一个二级菜单。"
        };
    }
  }

  function ensurePanel() {
    if (!document.body) return null;

    ensureToolScopedStyles();

    let panel = document.getElementById("amr_panel");
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = "amr_panel";
    panel.style.cssText = `
      position: fixed;
      top: 16px;
      left: ${getDefaultPanelPosition().left}px;
      width: ${PANEL_HIDDEN_WIDTH}px;
      z-index: ${TOOL_PANEL_Z_INDEX};
      background: rgba(28, 28, 30, 0.96);
      color: #f5f5f7;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      box-shadow: 0 10px 28px rgba(0,0,0,0.28);
      padding: 10px;
      font: 12px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
    `;
    panel.innerHTML = `
      <div id="amr_drag_handle" style="display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:move;">
        <strong style="flex:1;min-width:0;font-size:13px;font-weight:600;letter-spacing:0.1px;white-space:nowrap;">Apple Music 迁移工具</strong>
        <button id="amr_toggle_details" style="background:#3a3a3c;color:#fff;border:none;border-radius:999px;padding:3px 9px;cursor:pointer;font-size:11px;line-height:1.2;">显示</button>
      </div>

      <div id="amr_storefront_bar" style="display:none;margin-top:8px;padding:8px;background:#232326;border-radius:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div id="amr_storefront_status" style="color:#d2d2d7;font-size:11px;line-height:1.4;"></div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
            <button id="amr_switch_chinese" style="padding:5px 8px;border:none;border-radius:999px;background:#3a3a3c;color:#fff;font-size:11px;cursor:pointer;">切换语言</button>
            <button id="amr_toggle_storefront_picker" style="padding:5px 8px;border:none;border-radius:999px;background:#3a3a3c;color:#fff;font-size:11px;cursor:pointer;">切换区服</button>
          </div>
        </div>
        <div id="amr_storefront_picker_menu" style="display:none;width:100%;margin-top:6px;"></div>
        <div id="amr_language_picker_menu" style="display:none;width:100%;margin-top:6px;"></div>
      </div>

      <div id="amr_primary_menu" style="display:none;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;">
        <button id="amr_menu_export" style="padding:7px 8px;border:none;border-radius:8px;cursor:pointer;background:#2c2c2e;color:#fff;font-size:11px;">导出</button>
        <button id="amr_menu_import" style="padding:7px 8px;border:none;border-radius:8px;cursor:pointer;background:#2c2c2e;color:#fff;font-size:11px;">导入</button>
      </div>

      <div id="amr_export_submenu" style="display:none;grid-template-columns:1fr;gap:6px;margin-top:6px;">
        <button id="amr_view_export_albums" style="padding:7px 8px;border:none;border-radius:8px;cursor:pointer;background:#1f1f22;color:#fff;font-size:11px;text-align:left;">导出专辑</button>
        <button id="amr_view_export_songs" style="padding:7px 8px;border:none;border-radius:8px;cursor:pointer;background:#1f1f22;color:#fff;font-size:11px;text-align:left;">导出歌曲</button>
        <button id="amr_view_export_playlists" style="padding:7px 8px;border:none;border-radius:8px;cursor:pointer;background:#1f1f22;color:#fff;font-size:11px;text-align:left;">导出播放列表</button>
      </div>

      <div id="amr_import_submenu" style="display:none;grid-template-columns:1fr;gap:6px;margin-top:6px;">
        <button id="amr_view_import_albums" style="padding:7px 8px;border:none;border-radius:8px;cursor:pointer;background:#1f1f22;color:#fff;font-size:11px;text-align:left;">导入专辑</button>
        <button id="amr_view_import_songs" style="padding:7px 8px;border:none;border-radius:8px;cursor:pointer;background:#1f1f22;color:#fff;font-size:11px;text-align:left;">导入歌曲</button>
        <button id="amr_view_import_playlists" style="padding:7px 8px;border:none;border-radius:8px;cursor:pointer;background:#1f1f22;color:#fff;font-size:11px;text-align:left;">导入播放列表</button>
      </div>

      <div id="amr_detail_container" style="display:none;margin-top:8px;border-top:1px solid rgba(255,255,255,0.08);padding-top:8px;">
        <div id="amr_placeholder_view" style="display:none;">
          <div id="amr_placeholder_title" style="font-size:12px;font-weight:600;margin-bottom:6px;"></div>
          <div id="amr_placeholder_desc" style="padding:8px;background:#24242b;border-radius:8px;color:#cfcfcf;font-size:11px;"></div>
        </div>

        <div id="amr_album_export_view" style="display:none;">
          <div id="amr_export_status" style="margin-bottom:6px;color:#cfcfcf;font-size:11px;"></div>
          <div id="amr_export_current" style="padding:8px;background:#2a2a2a;border-radius:8px;margin-bottom:8px;white-space:pre-wrap;font-size:11px;"></div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <button id="amr_export_albums_start" style="padding:8px;border:none;border-radius:8px;cursor:pointer;font-size:11px;">开始导出专辑</button>
            <button id="amr_export_albums_clear_log" style="padding:8px;border:none;border-radius:8px;cursor:pointer;font-size:11px;">清空日志</button>
          </div>

          <div id="amr_export_log" class="amr-log-box" style="margin-top:8px;font-size:11px;color:#b8b8b8;max-height:220px;overflow:auto;background:#1e1e1e;padding:8px;border-radius:8px;"></div>
        </div>

        <div id="amr_song_export_view" style="display:none;">
          <div id="amr_export_songs_status" style="margin-bottom:6px;color:#cfcfcf;font-size:11px;"></div>
          <div id="amr_export_songs_current" style="padding:8px;background:#2a2a2a;border-radius:8px;margin-bottom:8px;white-space:pre-wrap;font-size:11px;"></div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <button id="amr_export_songs_start" style="padding:8px;border:none;border-radius:8px;cursor:pointer;font-size:11px;">开始导出歌曲</button>
            <button id="amr_export_songs_clear_log" style="padding:8px;border:none;border-radius:8px;cursor:pointer;font-size:11px;">清空日志</button>
          </div>

          <div id="amr_export_songs_log" class="amr-log-box" style="margin-top:8px;font-size:11px;color:#b8b8b8;max-height:220px;overflow:auto;background:#1e1e1e;padding:8px;border-radius:8px;"></div>
        </div>

        <div id="amr_playlist_export_view" style="display:none;">
          <div id="amr_export_playlists_status" style="margin-bottom:6px;color:#cfcfcf;font-size:11px;"></div>
          <div id="amr_export_playlists_current" style="padding:8px;background:#2a2a2a;border-radius:8px;margin-bottom:8px;white-space:pre-wrap;font-size:11px;"></div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <button id="amr_export_playlists_start" style="padding:8px;border:none;border-radius:8px;cursor:pointer;font-size:11px;">开始导出播放列表</button>
            <button id="amr_export_playlists_clear_log" style="padding:8px;border:none;border-radius:8px;cursor:pointer;font-size:11px;">清空日志</button>
          </div>

          <div id="amr_export_playlists_log" class="amr-log-box" style="margin-top:8px;font-size:11px;color:#b8b8b8;max-height:220px;overflow:auto;background:#1e1e1e;padding:8px;border-radius:8px;"></div>
        </div>

        <div id="amr_album_import_view" style="display:none;">
          <div id="amr_status" style="margin-bottom:6px;color:#cfcfcf;font-size:11px;"></div>
          <div id="amr_current" style="padding:8px;background:#2a2a2a;border-radius:8px;margin-bottom:8px;white-space:pre-wrap;font-size:11px;"></div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <button id="amr_import" style="padding:8px;border:none;border-radius:8px;cursor:pointer;font-size:11px;">导入 JSON</button>
            <button id="amr_start" style="padding:8px;border:none;border-radius:8px;cursor:pointer;font-size:11px;">开始导入</button>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;">
            <button id="amr_reset" style="padding:8px;border:none;border-radius:8px;cursor:pointer;font-size:11px;">清空进度</button>
            <button id="amr_clear_import_log" style="padding:8px;border:none;border-radius:8px;cursor:pointer;font-size:11px;">清空日志</button>
          </div>

          <div id="amr_log" class="amr-log-box" style="margin-top:8px;font-size:11px;color:#b8b8b8;max-height:220px;overflow:auto;background:#1e1e1e;padding:8px;border-radius:8px;"></div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    initPanelDrag(panel);
    applyPanelPosition(panel);

    panel.querySelector("#amr_toggle_details").onclick = () => {
      uiState.detailsVisible = !uiState.detailsVisible;
      if (!uiState.detailsVisible) {
        uiState.openMenu = null;
        uiState.activeAction = null;
        uiState.storefrontPickerVisible = false;
        uiState.languagePickerVisible = false;
      }
      render();
    };

    panel.querySelector("#amr_menu_export").onclick = () => {
      uiState.openMenu = uiState.openMenu === "export" ? null : "export";
      uiState.activeAction = null;
      render();
    };

    panel.querySelector("#amr_menu_import").onclick = () => {
      uiState.openMenu = uiState.openMenu === "import" ? null : "import";
      uiState.activeAction = null;
      render();
    };

    panel.querySelector("#amr_toggle_storefront_picker").onclick = () => {
      uiState.storefrontPickerVisible = !uiState.storefrontPickerVisible;
      uiState.languagePickerVisible = false;
      render();
    };

    panel.querySelector("#amr_switch_chinese").onclick = () => {
      uiState.languagePickerVisible = !uiState.languagePickerVisible;
      uiState.storefrontPickerVisible = false;
      render();
    };

    panel.addEventListener("click", (event) => {
      const storefrontButton = event.target.closest("[data-amr-storefront-option]");
      if (storefrontButton) {
        const value = cleanText(storefrontButton.getAttribute("data-amr-storefront-option")).toLowerCase();
        if (!value) return;
        uiState.storefrontPickerVisible = false;
        setPendingStorefrontSwitch(value);
        setSavedStorefront(value);
        log(`已切换使用区服为 ${getStorefrontLabel(value)} (${value})`);
        location.href = buildLanguageAwareUrl(`https://music.apple.com/${value}`);
        return;
      }

      const languageButton = event.target.closest("[data-amr-language-option]");
      if (!languageButton) return;
      const value = normalizeLanguageCode(languageButton.getAttribute("data-amr-language-option"));
      if (!value) return;
      uiState.languagePickerVisible = false;
      switchPageLanguage(value);
    });

    panel.querySelector("#amr_view_export_albums").onclick = () => {
      uiState.openMenu = "export";
      uiState.activeAction = "export-albums";
      uiState.detailsVisible = true;
      render();
    };

    panel.querySelector("#amr_view_export_songs").onclick = () => {
      uiState.openMenu = "export";
      uiState.activeAction = "export-songs";
      uiState.detailsVisible = true;
      render();
    };

    panel.querySelector("#amr_view_export_playlists").onclick = () => {
      uiState.openMenu = "export";
      uiState.activeAction = "export-playlists";
      uiState.detailsVisible = true;
      render();
    };

    panel.querySelector("#amr_view_import_albums").onclick = () => {
      uiState.openMenu = "import";
      uiState.activeAction = "import-albums";
      uiState.detailsVisible = true;
      render();
    };

    panel.querySelector("#amr_view_import_songs").onclick = () => {
      uiState.openMenu = "import";
      uiState.activeAction = "import-songs";
      uiState.detailsVisible = true;
      render();
    };

    panel.querySelector("#amr_view_import_playlists").onclick = () => {
      uiState.openMenu = "import";
      uiState.activeAction = "import-playlists";
      uiState.detailsVisible = true;
      render();
    };

    panel.querySelector("#amr_export_albums_start").onclick = async () => {
      prepareLogsForTransferAction();
      await exportAlbumsFromLibrary();
    };

    panel.querySelector("#amr_export_albums_clear_log").onclick = () => {
      clearLogs();
      syncLogBox();
      logExportAlbums("日志已清空");
    };

    panel.querySelector("#amr_export_songs_start").onclick = async () => {
      prepareLogsForTransferAction();
      await exportSongsFromLibrary();
    };

    panel.querySelector("#amr_export_songs_clear_log").onclick = () => {
      clearLogs();
      syncLogBox();
      logExportSongs("日志已清空");
    };

    panel.querySelector("#amr_export_playlists_start").onclick = async () => {
      prepareLogsForTransferAction();
      await exportPlaylistFromDom();
    };

    panel.querySelector("#amr_export_playlists_clear_log").onclick = () => {
      clearLogs();
      syncLogBox();
      logExportPlaylists("日志已清空");
    };

    panel.querySelector("#amr_import").onclick = async () => {
      prepareLogsForTransferAction();
      const payload = await pickJsonFile();
      const mediaType = uiState.activeAction === "import-songs"
        ? "songs"
        : (uiState.activeAction === "import-playlists" ? "playlists" : "albums");
      const validation = validateImportPayloadForMediaType(payload, mediaType);
      if (!validation.ok) {
        log(`导入${getImportMediaLabel(mediaType)} JSON 失败：${validation.message}`);
        alert(validation.message);
        return;
      }

      const items = mapImportItems(validation.list, mediaType);
      if (!items.length) {
        const message = `导入${getImportMediaLabel(mediaType)} JSON 失败：文件中没有可用条目。`;
        log(message);
        alert(message);
        return;
      }

      const state = {
        mediaType,
        index: 0,
        items,
        done: [],
        failed: [],
        skipped: [],
        missing: [],
        resultDialogShown: false,
        running: false,
        phase: "idle",
        runToken: null,
        pendingAction: null,
        playlistName: mediaType === "playlists"
          ? cleanText(payload?.playlistName || payload?.name || "未命名播放列表")
          : "",
        playlistDescription: cleanText(payload?.playlistDescription || payload?.description || ""),
        playlistCreated: false
      };
      saveState(state);
      render();
      log(`已导入 ${items.length} ${mediaType === "songs" ? "首歌曲" : (mediaType === "playlists" ? "首歌单歌曲" : "张专辑")}`);
      if (items.length > 500) {
        const warning = "当前导入条目较多,执行时间较长,请耐心等待";
        log(warning);
        alert(warning);
      }
    };

    panel.querySelector("#amr_start").onclick = async () => {
      prepareLogsForTransferAction();
      const state = loadState();
      if (!state) return alert("请先导入 JSON");
      state.running = true;
      state.runToken = newRunToken();
      state.phase = "continuous";
      state.pendingAction = "process-current-item";
      saveState(state);
      currentRunToken = state.runToken;
      render();
      await autoLoop(state.runToken);
    };

    panel.querySelector("#amr_clear_import_log").onclick = () => {
      clearLogs();
      syncLogBox();
      log("日志已清空");
    };

    panel.querySelector("#amr_reset").onclick = () => {
      if (confirm("确定清空当前进度吗？")) {
        removeState();
        alert("已清空");
        location.reload();
      }
    };

    return panel;
  }

  function render() {
    const panel = ensurePanel();
    if (!panel) return;
    renderProcessingMask();

    const primaryMenu = panel.querySelector("#amr_primary_menu");
    const storefrontBar = panel.querySelector("#amr_storefront_bar");
    const storefrontPickerMenu = panel.querySelector("#amr_storefront_picker_menu");
    const languagePickerMenu = panel.querySelector("#amr_language_picker_menu");
    const storefrontPickerButton = panel.querySelector("#amr_toggle_storefront_picker");
    const switchChineseButton = panel.querySelector("#amr_switch_chinese");
    const detailContainer = panel.querySelector("#amr_detail_container");
    const exportSubmenu = panel.querySelector("#amr_export_submenu");
    const importSubmenu = panel.querySelector("#amr_import_submenu");
    const exportMenuButton = panel.querySelector("#amr_menu_export");
    const importMenuButton = panel.querySelector("#amr_menu_import");
    const exportAlbumsButton = panel.querySelector("#amr_view_export_albums");
    const exportSongsButton = panel.querySelector("#amr_view_export_songs");
    const exportPlaylistsButton = panel.querySelector("#amr_view_export_playlists");
    const importAlbumsButton = panel.querySelector("#amr_view_import_albums");
    const importSongsButton = panel.querySelector("#amr_view_import_songs");
    const importPlaylistsButton = panel.querySelector("#amr_view_import_playlists");
    const toggleButton = panel.querySelector("#amr_toggle_details");
    const placeholderView = panel.querySelector("#amr_placeholder_view");
    const albumExportView = panel.querySelector("#amr_album_export_view");
    const songExportView = panel.querySelector("#amr_song_export_view");
    const playlistExportView = panel.querySelector("#amr_playlist_export_view");
    const albumImportView = panel.querySelector("#amr_album_import_view");

    panel.style.display = "block";
    const shouldShowPrimary = uiState.detailsVisible;
    const shouldShowSubmenu = shouldShowPrimary && !!uiState.openMenu;
    const shouldShowDetails = shouldShowPrimary && !!uiState.activeAction;
    const previousRect = panel.getBoundingClientRect();
    panel.style.width = shouldShowPrimary ? `${PANEL_EXPANDED_WIDTH}px` : `${PANEL_HIDDEN_WIDTH}px`;
    const preferredRight = Number.isFinite(previousRect.right) && previousRect.right > 0
      ? previousRect.right
      : null;
    applyPanelPosition(panel, { preferredRight });

    primaryMenu.style.display = shouldShowPrimary ? "grid" : "none";
    storefrontBar.style.display = shouldShowPrimary ? "block" : "none";
    storefrontPickerMenu.style.display = shouldShowPrimary && uiState.storefrontPickerVisible ? "block" : "none";
    languagePickerMenu.style.display = shouldShowPrimary && uiState.languagePickerVisible ? "block" : "none";
    exportSubmenu.style.display = uiState.openMenu === "export" && shouldShowPrimary ? "grid" : "none";
    importSubmenu.style.display = uiState.openMenu === "import" && shouldShowPrimary ? "grid" : "none";
    exportMenuButton.style.background = uiState.openMenu === "export" ? "#fa2d48" : "#2c2c2e";
    importMenuButton.style.background = uiState.openMenu === "import" ? "#fa2d48" : "#2c2c2e";
    exportMenuButton.style.color = "#fff";
    importMenuButton.style.color = "#fff";
    exportAlbumsButton.style.background = uiState.activeAction === "export-albums" ? "#fa2d48" : "#1f1f22";
    exportSongsButton.style.background = uiState.activeAction === "export-songs" ? "#fa2d48" : "#1f1f22";
    exportPlaylistsButton.style.background = uiState.activeAction === "export-playlists" ? "#fa2d48" : "#1f1f22";
    importAlbumsButton.style.background = uiState.activeAction === "import-albums" ? "#fa2d48" : "#1f1f22";
    importSongsButton.style.background = uiState.activeAction === "import-songs" ? "#fa2d48" : "#1f1f22";
    importPlaylistsButton.style.background = uiState.activeAction === "import-playlists" ? "#fa2d48" : "#1f1f22";
    toggleButton.textContent = uiState.detailsVisible ? "隐藏" : "显示";
    detailContainer.style.display = shouldShowDetails ? "block" : "none";
    panel.querySelector("#amr_storefront_status").textContent = getStorefrontSummary();
    storefrontPickerButton.textContent = uiState.storefrontPickerVisible ? "收起区服" : "切换区服";
    switchChineseButton.textContent = uiState.languagePickerVisible ? "收起语言" : "切换语言";
    renderPickerMenu(storefrontPickerMenu, STOREFRONT_OPTIONS, "storefront");
    renderPickerMenu(languagePickerMenu, LANGUAGE_OPTIONS, "language");
    saveUIState();

    const actionMeta = getActionMeta(uiState.activeAction);
    placeholderView.style.display = shouldShowDetails && !["import-albums", "import-songs", "import-playlists", "export-albums", "export-songs", "export-playlists"].includes(uiState.activeAction) ? "block" : "none";
    albumExportView.style.display = shouldShowDetails && uiState.activeAction === "export-albums" ? "block" : "none";
    songExportView.style.display = shouldShowDetails && uiState.activeAction === "export-songs" ? "block" : "none";
    playlistExportView.style.display = shouldShowDetails && uiState.activeAction === "export-playlists" ? "block" : "none";
    albumImportView.style.display = shouldShowDetails && ["import-albums", "import-songs", "import-playlists"].includes(uiState.activeAction) ? "block" : "none";
    panel.querySelector("#amr_placeholder_title").textContent = actionMeta.title;
    panel.querySelector("#amr_placeholder_desc").textContent = actionMeta.desc;
    panel.querySelector("#amr_export_albums_start").textContent = exportAlbumsState.running ? "导出中..." : "开始导出专辑";
    panel.querySelector("#amr_export_albums_start").disabled = exportAlbumsState.running;
    panel.querySelector("#amr_export_albums_start").style.opacity = exportAlbumsState.running ? "0.7" : "1";
    panel.querySelector("#amr_export_songs_start").textContent = exportSongsState.running ? "导出中..." : "开始导出歌曲";
    panel.querySelector("#amr_export_songs_start").disabled = exportSongsState.running;
    panel.querySelector("#amr_export_songs_start").style.opacity = exportSongsState.running ? "0.7" : "1";
    panel.querySelector("#amr_export_playlists_start").textContent = exportPlaylistsState.running ? "导出中..." : "开始导出播放列表";
    panel.querySelector("#amr_export_playlists_start").disabled = exportPlaylistsState.running;
    panel.querySelector("#amr_export_playlists_start").style.opacity = exportPlaylistsState.running ? "0.7" : "1";

    syncLogBox();

    if (uiState.activeAction === "export-albums") {
      panel.querySelector("#amr_export_status").textContent =
        `状态 ${exportAlbumsState.status} ｜ 已测容器 ${formatWholeNumber(exportAlbumsState.testedScrollers)}/${formatWholeNumber(exportAlbumsState.totalScrollers)} ｜ 分页 ${formatWholeNumber(exportAlbumsState.capturedPages)} ｜ 已导出 ${formatWholeNumber(exportAlbumsState.exportedCount)}`;
      panel.querySelector("#amr_export_current").textContent = exportAlbumsState.current;
      return;
    }

    if (uiState.activeAction === "export-songs") {
      panel.querySelector("#amr_export_songs_status").textContent =
        `状态 ${exportSongsState.status} ｜ 已测容器 ${formatWholeNumber(exportSongsState.testedScrollers)}/${formatWholeNumber(exportSongsState.totalScrollers)} ｜ 分页 ${formatWholeNumber(exportSongsState.capturedPages)} ｜ 已导出 ${formatWholeNumber(exportSongsState.exportedCount)}`;
      panel.querySelector("#amr_export_songs_current").textContent = exportSongsState.current;
      return;
    }

    if (uiState.activeAction === "export-playlists") {
      panel.querySelector("#amr_export_playlists_status").textContent =
        `状态 ${exportPlaylistsState.status} ｜ 已测容器 ${formatWholeNumber(exportPlaylistsState.testedScrollers)}/${formatWholeNumber(exportPlaylistsState.totalScrollers)} ｜ 已导出 ${formatWholeNumber(exportPlaylistsState.exportedCount)}`;
      panel.querySelector("#amr_export_playlists_current").textContent = exportPlaylistsState.current;
      return;
    }

    if (!["import-albums", "import-songs", "import-playlists"].includes(uiState.activeAction)) {
      return;
    }

    const state = loadState();
    const uiMediaType = uiState.activeAction === "import-songs"
      ? "songs"
      : (uiState.activeAction === "import-playlists" ? "playlists" : "albums");
    const uiNoun = uiMediaType === "songs" ? "歌曲" : (uiMediaType === "playlists" ? "播放列表" : "专辑");
    const matchedState = state && getImportMediaType(state) === uiMediaType ? state : null;
    const counts = getImportCounts(matchedState || { mediaType: uiMediaType });

    panel.querySelector("#amr_import").textContent = `导入${uiNoun} JSON`;
    panel.querySelector("#amr_start").textContent = `开始导入${uiNoun}`;

    if (!matchedState) {
      panel.querySelector("#amr_status").textContent = `还没导入 ${uiNoun} JSON ｜ 当前区服 ${getStorefront()}`;
      panel.querySelector("#amr_current").textContent = `请先点击“导入${uiNoun} JSON”`;
      return;
    }

    const stateMediaType = getImportMediaType(matchedState);
    const item = getCurrentItem(matchedState);

    if (stateMediaType === "songs" || stateMediaType === "playlists") {
      panel.querySelector("#amr_status").textContent =
        `区服 ${getStorefront()} ｜ 已处理 ${formatWholeNumber(getProcessedCount(matchedState))}/${formatWholeNumber(counts.total)} ｜ 成功 ${formatWholeNumber(counts.done)} ｜ 不存在 ${formatWholeNumber(counts.missing)} ｜ 跳过 ${formatWholeNumber(counts.skipped)} ｜ 失败 ${formatWholeNumber(counts.failed)} ｜ 状态 ${matchedState.running ? "运行中" : "未运行"} ｜ 阶段 ${matchedState.phase || "idle"}`;
    } else {
      panel.querySelector("#amr_status").textContent =
        `区服 ${getStorefront()} ｜ 已处理 ${formatWholeNumber(getProcessedCount(matchedState))}/${formatWholeNumber(counts.total)} ｜ 成功 ${formatWholeNumber(counts.done)} ｜ 不存在 ${formatWholeNumber(counts.missing)} ｜ 跳过 ${formatWholeNumber(counts.skipped)} ｜ 失败 ${formatWholeNumber(counts.failed)} ｜ 状态 ${matchedState.running ? "运行中" : "未运行"} ｜ 阶段 ${matchedState.phase || "idle"}`;
    }

    panel.querySelector("#amr_current").textContent = formatCurrentItem(matchedState, item);
  }

  async function waitFor(fn, timeout = 15000, interval = 300, token = null) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (token && !isRunValid(token)) return null;
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  function onSearchPage() {
    try {
      const url = new URL(location.href);
      const path = url.pathname.toLowerCase();
      return path.endsWith("/search") && url.searchParams.has("term");
    } catch {
      return location.pathname.toLowerCase().includes("/search") && location.search.includes("term=");
    }
  }

  function onSongPage() {
    return !!getCurrentSongIdFromUrl();
  }

  function onAlbumPage() {
    return !!getCurrentAlbumIdFromUrl();
  }

  function getCurrentAlbumIdFromUrl() {
    try {
      const match = new URL(location.href).pathname.match(/\/album\/(?:[^/]+\/)?(\d+)(?:\/|$)/i);
      return cleanText(match?.[1] || "");
    } catch {
      const match = location.pathname.match(/\/album\/(?:[^/]+\/)?(\d+)(?:\/|$)/i);
      return cleanText(match?.[1] || "");
    }
  }

  function albumPageMatchesItem(item) {
    return cleanText(item?.id) && cleanText(item?.id) === getCurrentAlbumIdFromUrl();
  }

  function getCurrentSongIdFromUrl() {
    try {
      const match = new URL(location.href).pathname.match(/\/song\/(?:[^/]+\/)?(\d+)(?:\/|$)/i);
      return cleanText(match?.[1] || "");
    } catch {
      const match = location.pathname.match(/\/song\/(?:[^/]+\/)?(\d+)(?:\/|$)/i);
      return cleanText(match?.[1] || "");
    }
  }

  function songPageMatchesItem(item) {
    return cleanText(item?.id) && cleanText(item?.id) === getCurrentSongIdFromUrl();
  }

  function getCurrentSearchTerm() {
    try {
      const url = new URL(location.href);
      return cleanText(url.searchParams.get("term") || "");
    } catch {
      const params = new URLSearchParams(location.search);
      return cleanText(params.get("term") || "");
    }
  }

  function searchPageMatchesItem(item) {
    if (!item || !onSearchPage()) return false;

    const currentTerm = normalize(getCurrentSearchTerm());
    const targetTerm = normalize(getSearchQuery(item));
    if (!currentTerm || !targetTerm) return false;

    return currentTerm === targetTerm;
  }

  function isAlbumType(type) {
    const normalized = normalize(type);
    return normalized === normalize("专辑") || normalized === normalize("album");
  }

  function getNodeTextCandidates(node) {
    if (!node) return [];
    return [
      cleanText(node.getAttribute?.("title") || ""),
      cleanText(node.getAttribute?.("aria-label") || ""),
      cleanText(node.textContent || "")
    ].filter(Boolean);
  }

  function nodeMatchesKeywords(node, keywords, mode = "includes") {
    if (!node || !Array.isArray(keywords) || !keywords.length) return false;
    const candidates = getNodeTextCandidates(node)
      .map(value => normalize(value))
      .filter(Boolean);
    return candidates.some(value => keywords.some(keyword => {
      const expected = normalize(keyword);
      if (!expected) return false;
      return mode === "exact" ? value === expected : value.includes(expected);
    }));
  }

  function findAddButton(root) {
    if (!root) return null;

    const directButton = root.querySelector('[data-testid="add-to-library-button"]');
    if (directButton && !directButton.closest("#amr_panel")) {
      return directButton;
    }

    return Array.from(root.querySelectorAll("button"))
      .find(node => !node.closest("#amr_panel") && nodeMatchesKeywords(node, ADD_TO_LIBRARY_KEYWORDS)) || null;
  }

  function findButtonByKeywords(root, keywords) {
    if (!root) return null;

    const nodes = Array.from(root.querySelectorAll("button, [role='button'], [role='menuitem']"));
    return nodes.find(node => {
      if (!isVisibleNode(node) || node.closest("#amr_panel")) return false;
      return nodeMatchesKeywords(node, keywords);
    }) || null;
  }

  function isVisibleNode(node) {
    if (!node) return false;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getVisibleContextualMenuScope() {
    const menuItem = Array.from(document.querySelectorAll(".contextual-menu-item"))
      .find(node => isVisibleNode(node) && !node.closest("#amr_panel"));
    if (!menuItem) return null;

    return (
      menuItem.closest('[role="menu"]') ||
      menuItem.closest("ul") ||
      menuItem.parentElement ||
      menuItem
    );
  }

  async function ensureContextualMenuOpen(token = null) {
    const existing = getVisibleContextualMenuScope();
    if (existing) return existing;

    if (token && !isRunValid(token)) return null;

    const moreButton = findMoreButton(document);
    if (!moreButton) return null;

    moreButton.click();
    await sleep(450);
    return getVisibleContextualMenuScope();
  }

  function findSongPageErrorMarker() {
    return document.querySelector('[data-testid="page-error-title"]');
  }

  function findAlbumPageErrorMarker() {
    return document.querySelector('[data-testid="page-error-title"]');
  }

  function findAlbumAddButton(root = document) {
    return findButtonByKeywords(root, ADD_TO_LIBRARY_KEYWORDS);
  }

  function findAlbumRemoveButton(root = document) {
    return findButtonByKeywords(root, REMOVE_FROM_LIBRARY_KEYWORDS);
  }

  function findSongAddButton(root = document) {
    return findButtonByKeywords(root, ADD_TO_LIBRARY_KEYWORDS);
  }

  function findSongRemoveButton(root = document) {
    return findButtonByKeywords(root, REMOVE_FROM_LIBRARY_KEYWORDS);
  }

  function findAddToPlaylistButton(root = document) {
    const buttons = Array.from(root.querySelectorAll("button"))
      .filter(node => {
        if (!isVisibleNode(node) || node.closest("#amr_panel")) return false;
        const matched = nodeMatchesKeywords(node, ADD_TO_PLAYLIST_KEYWORDS, "exact");
        if (!matched) return false;
        if (node.getAttribute("aria-haspopup") === "true") return true;
        return !!node.closest(".contextual-menu-item")?.querySelector(".contextual-menu-item--nested");
      });

    return buttons[0] || null;
  }

  function getVisibleNestedPlaylistMenu(addToPlaylistButton) {
    const menuItem = addToPlaylistButton?.closest(".contextual-menu-item");
    if (!menuItem) return null;

    const nested = menuItem.querySelector(".contextual-menu-item--nested .contextual-menu--nested");
    if (!nested || !isVisibleNode(nested)) return null;
    return nested;
  }

  function setNativeInputValue(input, value) {
    if (!input) return;
    const prototype = input instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement?.prototype
      : window.HTMLInputElement?.prototype;
    const descriptor = prototype
      ? Object.getOwnPropertyDescriptor(prototype, "value")
      : null;

    if (descriptor?.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function ensureAddToPlaylistSubmenuOpen(token = null) {
    const menuScope = await ensureContextualMenuOpen(token);
    if (!menuScope) return null;

    const addToPlaylistButton = findAddToPlaylistButton(menuScope);
    if (!addToPlaylistButton) return null;

    const hoverTarget = addToPlaylistButton.closest(".contextual-menu-item") || addToPlaylistButton;
    triggerPointerSequence(hoverTarget);
    triggerPointerSequence(addToPlaylistButton);
    addToPlaylistButton.dispatchEvent(new MouseEvent("mouseenter", {
      bubbles: true,
      cancelable: true,
      view: window
    }));

    const nested = await waitFor(() => {
      if (token && !isRunValid(token)) return null;
      const submenu = getVisibleNestedPlaylistMenu(addToPlaylistButton);
      if (!submenu) return null;
      const buttons = Array.from(submenu.querySelectorAll("button")).filter(node => isVisibleNode(node));
      return buttons.length ? submenu : null;
    }, 5000, 200, token);

    return nested;
  }

  function findPlaylistOptionButtonInSubmenu(submenu, playlistName) {
    const normalizedName = cleanText(playlistName);
    if (!submenu || !normalizedName) return null;

    const buttons = Array.from(submenu.querySelectorAll(".contextual-menu-item button"))
      .filter(node => isVisibleNode(node));

    return buttons.find(button => {
      const text = cleanText(button.getAttribute("title") || button.textContent || "");
      if (!text || nodeMatchesKeywords(button, NEW_PLAYLIST_KEYWORDS, "exact") || nodeMatchesKeywords(button, ADD_TO_PLAYLIST_KEYWORDS, "exact")) return false;
      return text === normalizedName;
    }) || null;
  }

  function findNewPlaylistButtonInSubmenu(submenu) {
    if (!submenu) return null;
    return Array.from(submenu.querySelectorAll(".contextual-menu-item button"))
      .find(button => nodeMatchesKeywords(button, NEW_PLAYLIST_KEYWORDS, "exact")) || null;
  }

  async function createPlaylistFromDialog(playlistName, playlistDescription, token = null) {
    const dialog = await waitFor(() => {
      if (token && !isRunValid(token)) return null;
      const node = document.querySelector('dialog[data-testid="dialog"][open]');
      return node && isVisibleNode(node) ? node : null;
    }, 5000, 200, token);
    if (!dialog) {
      return { ok: false, reason: "playlist-dialog-not-found" };
    }

    const titleInput = dialog.querySelector('[data-testid="playlist-title-input"]');
    const descriptionInput = dialog.querySelector('[data-testid="playlist-description-input"]');
    const submitButton = dialog.querySelector('button[type="submit"]');
    if (!titleInput || !submitButton) {
      return { ok: false, reason: "playlist-dialog-fields-missing" };
    }

    setNativeInputValue(titleInput, cleanText(playlistName));
    if (descriptionInput) {
      setNativeInputValue(descriptionInput, cleanText(playlistDescription));
    }

    const enabledSubmit = await waitFor(() => {
      if (token && !isRunValid(token)) return null;
      return !submitButton.disabled ? submitButton : null;
    }, 3000, 100, token);
    if (!enabledSubmit) {
      return { ok: false, reason: "playlist-create-submit-disabled" };
    }

    enabledSubmit.click();
    await sleep(1500);

    const closed = await waitFor(() => {
      if (token && !isRunValid(token)) return true;
      const node = document.querySelector('dialog[data-testid="dialog"][open]');
      return !node;
    }, 7000, 250, token);

    return closed ? { ok: true, mode: "created-playlist" } : { ok: false, reason: "playlist-dialog-not-closed" };
  }

  async function addCurrentSongToPlaylist(state, item, token = null) {
    const playlistName = cleanText(state?.playlistName);
    if (!playlistName) {
      return { ok: false, reason: "playlist-name-missing" };
    }

    const submenu = await ensureAddToPlaylistSubmenuOpen(token);
    if (!submenu) {
      return { ok: false, reason: "playlist-submenu-not-found" };
    }

    const existingPlaylistButton = findPlaylistOptionButtonInSubmenu(submenu, playlistName);
    if (existingPlaylistButton) {
      state.playlistCreated = true;
      existingPlaylistButton.click();
      await sleep(1200);
      return { ok: true, mode: "added-to-existing-playlist" };
    }

    if (state?.playlistCreated) {
      return { ok: false, reason: "playlist-not-found-after-create" };
    }

    const newPlaylistButton = findNewPlaylistButtonInSubmenu(submenu);
    if (!newPlaylistButton) {
      return { ok: false, reason: "new-playlist-button-not-found" };
    }

    newPlaylistButton.click();
    const createResult = await createPlaylistFromDialog(state?.playlistName, state?.playlistDescription, token);
    if (!createResult.ok) {
      return createResult;
    }

    state.playlistCreated = true;
    await sleep(PLAYLIST_CREATION_SETTLE_MS);
    return createResult;
  }

  async function resolvePlaylistSongPageState(item, token = null) {
    const startedAt = Date.now();
    let lastMenuOpenAt = 0;

    while (Date.now() - startedAt < 20000) {
      if (token && !isRunValid(token)) {
        return { status: "stopped" };
      }

      if (!songPageMatchesItem(item)) {
        await sleep(250);
        continue;
      }

      if (findSongPageErrorMarker()) {
        return { status: "missing" };
      }

      let menuScope = getVisibleContextualMenuScope();
      if (!menuScope && Date.now() - lastMenuOpenAt > 1000) {
        lastMenuOpenAt = Date.now();
        menuScope = await ensureContextualMenuOpen(token);
      }

      if (!menuScope) {
        await sleep(350);
        continue;
      }

      const addToPlaylistButton = findAddToPlaylistButton(menuScope);
      if (addToPlaylistButton) {
        return { status: "addable-to-playlist", button: addToPlaylistButton };
      }

      await sleep(350);
    }

    return { status: "unknown" };
  }

  async function resolveAlbumPageState(item, token = null) {
    const startedAt = Date.now();
    let lastMenuOpenAt = 0;

    while (Date.now() - startedAt < 20000) {
      if (token && !isRunValid(token)) {
        return { status: "stopped" };
      }

      if (!albumPageMatchesItem(item)) {
        await sleep(250);
        continue;
      }

      if (findAlbumPageErrorMarker()) {
        return { status: "missing" };
      }

      let menuScope = getVisibleContextualMenuScope();
      if (!menuScope && Date.now() - lastMenuOpenAt > 1000) {
        lastMenuOpenAt = Date.now();
        menuScope = await ensureContextualMenuOpen(token);
      }

      if (!menuScope) {
        await sleep(350);
        continue;
      }

      const removeButton = findAlbumRemoveButton(menuScope);
      if (removeButton) {
        return { status: "already-added", button: removeButton };
      }

      const addButton = findAlbumAddButton(menuScope);
      if (addButton) {
        return { status: "addable", button: addButton };
      }

      await sleep(350);
    }

    return { status: "unknown" };
  }

  async function addCurrentAlbumToLibrary(item, token = null, existingAddButton = null) {
    const addButton = existingAddButton || findAlbumAddButton(getVisibleContextualMenuScope() || document);
    if (!addButton) {
      return { ok: false, reason: "no-add-button" };
    }

    addButton.click();
    await sleep(1200);

    const startedAt = Date.now();
    let lastMenuOpenAt = 0;
    while (Date.now() - startedAt < 7000) {
      if (token && !isRunValid(token)) {
        return { ok: false, reason: "stopped" };
      }

      let menuScope = getVisibleContextualMenuScope();
      if (!menuScope && Date.now() - lastMenuOpenAt > 1000) {
        lastMenuOpenAt = Date.now();
        menuScope = await ensureContextualMenuOpen(token);
      }

      if (menuScope) {
        const removeButton = findAlbumRemoveButton(menuScope);
        if (removeButton) {
          return { ok: true, mode: "album-add-confirmed" };
        }
      }

      await sleep(350);
    }

    return { ok: false, reason: "album-add-not-confirmed" };
  }

  async function resolveSongPageState(item, token = null) {
    const startedAt = Date.now();
    let lastMenuOpenAt = 0;

    while (Date.now() - startedAt < 20000) {
      if (token && !isRunValid(token)) {
        return { status: "stopped" };
      }

      if (!songPageMatchesItem(item)) {
        await sleep(250);
        continue;
      }

      if (findSongPageErrorMarker()) {
        return { status: "missing" };
      }

      let menuScope = getVisibleContextualMenuScope();
      if (!menuScope && Date.now() - lastMenuOpenAt > 1000) {
        lastMenuOpenAt = Date.now();
        menuScope = await ensureContextualMenuOpen(token);
      }

      if (!menuScope) {
        await sleep(350);
        continue;
      }

      const removeButton = findSongRemoveButton(menuScope);
      if (removeButton) {
        return { status: "already-added", button: removeButton };
      }

      const addButton = findSongAddButton(menuScope);
      if (addButton) {
        return { status: "addable", button: addButton };
      }

      await sleep(350);
    }

    return { status: "unknown" };
  }

  async function addCurrentSongToLibrary(item, token = null, existingAddButton = null) {
    const addButton = existingAddButton || findSongAddButton(getVisibleContextualMenuScope() || document);
    if (!addButton) {
      return { ok: false, reason: "no-add-button" };
    }

    addButton.click();
    await sleep(1200);

    const startedAt = Date.now();
    let lastMenuOpenAt = 0;
    while (Date.now() - startedAt < 7000) {
      if (token && !isRunValid(token)) {
        return { ok: false, reason: "stopped" };
      }

      let menuScope = getVisibleContextualMenuScope();
      if (!menuScope && Date.now() - lastMenuOpenAt > 1000) {
        lastMenuOpenAt = Date.now();
        menuScope = await ensureContextualMenuOpen(token);
      }

      if (menuScope) {
        const removeButton = findSongRemoveButton(menuScope);
        if (removeButton) {
          return { ok: true, mode: "song-add-confirmed" };
        }
      }

      await sleep(350);
    }

    return { ok: false, reason: "song-add-not-confirmed" };
  }

  function findMoreButton(root) {
    if (!root) return null;

    const selectors = [
      'button[data-testid="more-button"]',
      'button[aria-label*="更多"]',
      'button[aria-label*="More"]',
      'button[title*="更多"]',
      'button[title*="More"]'
    ];

    for (const selector of selectors) {
      const button = root.querySelector(selector);
      if (button) return button;
    }

    return null;
  }

  function triggerPointerSequence(element) {
    if (!element) return;

    const events = ["mouseenter", "mouseover", "mousemove"];
    for (const type of events) {
      element.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window
      }));
    }
  }

  function parseCandidateMeta(subtitle, aria) {
    let type = "";
    let artist = "";

    if (subtitle.includes("·")) {
      const parts = subtitle.split("·").map(x => cleanText(x)).filter(Boolean);
      if (parts.length >= 1) type = parts[0];
      if (parts.length >= 2) artist = parts.slice(1).join(" · ");
    }

    if (!artist && aria) {
      const parts = aria.split("·").map(x => cleanText(x)).filter(Boolean);
      if (parts.length >= 3) {
        type = type || parts[1];
        artist = artist || parts[2];
      }
    }

    return { type, artist };
  }

  function getCardTitle(card, anchor) {
    const titleSelectors = [
      '[data-testid="top-search-result-title"]',
      '[data-testid="lockup-title"]',
      '[data-testid="artwork-lockup__title"]',
      '[aria-level]'
    ];

    for (const selector of titleSelectors) {
      const text = cleanText(card.querySelector(selector)?.textContent);
      if (text) return text;
    }

    return cleanText(anchor?.textContent || card.getAttribute("aria-label") || "");
  }

  function getCardSubtitle(card) {
    const subtitleSelectors = [
      '[data-testid="top-search-result-subtitle"]',
      '[data-testid="lockup-subtitle"]',
      '[data-testid="artwork-lockup__subtitle"]'
    ];

    for (const selector of subtitleSelectors) {
      const text = cleanText(card.querySelector(selector)?.textContent);
      if (text) return text;
    }

    const textNodes = Array.from(card.querySelectorAll("div, span"))
      .map(node => cleanText(node.textContent))
      .filter(Boolean);

    return textNodes.find(text => text.includes("·")) || "";
  }

  function getCandidateCardRoots() {
    const directCards = Array.from(document.querySelectorAll('[data-testid="top-search-result"]'));
    if (directCards.length) return directCards;

    const albumAnchors = Array.from(document.querySelectorAll('a[href*="/album/"]'));
    const roots = albumAnchors
      .map(anchor =>
        anchor.closest('[data-testid="top-search-result"]') ||
        anchor.closest("li") ||
        anchor.closest('[role="listitem"]') ||
        anchor.closest("article") ||
        anchor.closest("section") ||
        anchor.parentElement
      )
      .filter(Boolean);

    return Array.from(new Set(roots));
  }

  function getSearchAlbumCandidates() {
    const cards = getCandidateCardRoots();
    const results = [];

    for (const card of cards) {
      const anchor =
        card.querySelector('a[data-testid="click-action"]') ||
        card.querySelector('a[href*="/album/"]') ||
        null;
      const title = getCardTitle(card, anchor);
      const subtitle = getCardSubtitle(card);

      const aria = cleanText(card.getAttribute("aria-label") || "");
      const href = anchor?.href || "";
      const addBtn = findAddButton(card);
      const { type, artist } = parseCandidateMeta(subtitle, aria);

      results.push({
        title,
        artist,
        type,
        aria,
        href,
        addBtn,
        card
      });
    }

    const filtered = results.filter(x => x.title && (x.href.includes("/album/") || isAlbumType(x.type)));
    if (filtered.length) {
      log(`识别到 ${filtered.length} 个专辑候选`);
      return filtered;
    }

    if (results.length) {
      log(`只识别到 ${results.length} 个非专辑或信息不完整候选，回退为全量候选`);
    }

    return results.filter(x => x.title);
  }

  async function waitForSearchResults(token = null) {
    return await waitFor(() => {
      if (!onSearchPage()) return null;
      const list = getSearchAlbumCandidates();
      return list.length ? list : null;
    }, 20000, 400, token);
  }

  function showCandidatePicker(targetItem, candidates) {
    return new Promise((resolve) => {
      const old = document.getElementById("__am_candidate_picker__");
      if (old) old.remove();

      const box = document.createElement("div");
      box.id = "__am_candidate_picker__";
      box.style.cssText = `
        position: fixed;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 720px;
        max-width: 90vw;
        max-height: 80vh;
        overflow: auto;
        z-index: ${TOOL_OVERLAY_Z_INDEX};
        background: rgba(25,25,25,0.98);
        color: #fff;
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.45);
        padding: 16px;
        font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      `;

      const title = document.createElement("div");
      title.style.marginBottom = "12px";
      title.innerHTML = `
        <div style="font-size:18px;font-weight:600;">请选择正确的专辑卡片</div>
        <div style="margin-top:6px;color:#cfcfcf;">
          目标：${targetItem.artist || "(空)"} - ${targetItem.album}
        </div>
        <div style="margin-top:6px;color:#ffcc99;">
          自动判断不够确定，请手动确认后点击对应按钮。
        </div>
      `;
      box.appendChild(title);

      const list = document.createElement("div");
      list.style.display = "grid";
      list.style.gap = "10px";

      candidates.forEach((c, idx) => {
        const row = document.createElement("div");
        row.style.cssText = `
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 10px;
          padding: 10px;
          background: rgba(255,255,255,0.03);
        `;

        row.innerHTML = `
          <div style="font-weight:600;">${idx + 1}. ${c.title}</div>
          <div style="color:#cfcfcf;margin-top:4px;">${c.type || "(未知类型)"} ｜ ${c.artist || "(未知艺人)"}</div>
          <div style="color:#999;margin-top:4px;word-break:break-all;">${c.aria || ""}</div>
        `;

        const btns = document.createElement("div");
        btns.style.marginTop = "8px";
        btns.style.display = "flex";
        btns.style.gap = "8px";

        const chooseBtn = document.createElement("button");
        chooseBtn.textContent = "选这个并添加";
        chooseBtn.style.cssText = "padding:8px 12px;border:none;border-radius:8px;cursor:pointer;";
        chooseBtn.onclick = () => {
          box.remove();
          resolve(c);
        };

        const openBtn = document.createElement("button");
        openBtn.textContent = "打开详情页";
        openBtn.style.cssText = "padding:8px 12px;border:none;border-radius:8px;cursor:pointer;";
        openBtn.onclick = () => {
          if (c.href) window.open(c.href, "_blank");
        };

        btns.appendChild(chooseBtn);
        btns.appendChild(openBtn);
        row.appendChild(btns);
        list.appendChild(row);
      });

      const bottom = document.createElement("div");
      bottom.style.marginTop = "12px";
      bottom.style.display = "flex";
      bottom.style.gap = "8px";

      const skipBtn = document.createElement("button");
      skipBtn.textContent = "取消，让我手动处理";
      skipBtn.style.cssText = "padding:10px 14px;border:none;border-radius:8px;cursor:pointer;";
      skipBtn.onclick = () => {
        box.remove();
        resolve(null);
      };

      bottom.appendChild(skipBtn);

      box.appendChild(list);
      box.appendChild(bottom);
      document.body.appendChild(box);
    });
  }

  async function clickMenuItemByText(textList, token = null) {
    const menuItem = await waitFor(() => {
      if (token && !isRunValid(token)) return null;

      const nodes = Array.from(document.querySelectorAll('button, [role="menuitem"], li'));
      return nodes.find(node => nodeMatchesKeywords(node, textList)) || null;
    }, 5000, 200, token);

    if (!menuItem) return false;

    menuItem.click();
    return true;
  }

  async function tryAddCandidateToLibrary(chosen, token = null) {
    if (!chosen?.card) {
      return { ok: false, reason: "missing-card" };
    }

    chosen.card.scrollIntoView({ block: "center", inline: "nearest" });
    triggerPointerSequence(chosen.card);
    await sleep(300);

    const directAddButton = findAddButton(chosen.card);
    if (directAddButton) {
      directAddButton.click();
      await sleep(1200);

      const stillHasAddButton = findAddButton(chosen.card);
      if (!stillHasAddButton || stillHasAddButton !== directAddButton) {
        return { ok: true, mode: "search-card-direct-add" };
      }

      return { ok: true, mode: "search-card-add-clicked" };
    }

    const moreButton = findMoreButton(chosen.card);
    if (!moreButton) {
      return { ok: false, reason: "no-add-or-more-button" };
    }

    moreButton.click();
    await sleep(400);

    const menuClicked = await clickMenuItemByText([
      ...ADD_TO_LIBRARY_KEYWORDS
    ], token);

    if (!menuClicked) {
      return { ok: false, reason: "no-menu-add-action" };
    }

    await sleep(1000);
    return { ok: true, mode: "search-card-menu-add" };
  }

  async function pickAndAddFromSearch(targetItem, token = null) {
    const candidates = await waitForSearchResults(token);
    if (!candidates || !candidates.length) {
      log("搜索页没有找到任何候选卡片");
      return { ok: false, reason: "no-candidates" };
    }

    const scored = candidates.map(c => ({
      ...c,
      score: scoreAlbumCandidate(targetItem.artist, targetItem.album, c)
    }));

    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    const second = scored[1];

    log(`搜索候选最佳分数：${best ? best.score : "N/A"}`);

    let chosen = null;

    if (
      best &&
      best.score >= 160 &&
      (!second || best.score - second.score >= 30)
    ) {
      chosen = best;
      log(`自动选择：${best.artist} - ${best.title}`);
    } else {
      const albumCandidates = scored.filter(x =>
        normalize(x.type) === normalize("专辑") || normalize(x.type) === normalize("album")
      );

      chosen = await showCandidatePicker(targetItem, albumCandidates.length ? albumCandidates : scored);
      if (!chosen) {
        return { ok: false, reason: "manual-cancel" };
      }
      log(`人工选择：${chosen.artist} - ${chosen.title}`);
    }

    if (token && !isRunValid(token)) {
      return { ok: false, reason: "stopped" };
    }

    const addResult = await tryAddCandidateToLibrary(chosen, token);
    if (addResult.ok) {
      log(`已触发添加动作：${addResult.mode}`);
    } else {
      log(`未能触发添加动作：${addResult.reason}`);
    }

    return addResult;
  }

  async function processOne(continuous, token = null) {
    const state = loadState();
    if (!state) return;
    const mediaType = getImportMediaType(state);

    const item = getCurrentItem(state);
    if (!item) {
      state.running = false;
      state.runToken = null;
      state.pendingAction = null;
      state.phase = "completed";
      persistImportProgress(state);
      return;
    }

    if (mediaType === "playlists") {
      render();

      if (!onSongPage() || !songPageMatchesItem(item)) {
        state.pendingAction = "process-current-item";
        state.phase = continuous ? "navigating-playlist-song-continuous" : "navigating-playlist-song-single-step";
        saveState(state);
        log(`当前页面不是当前播放列表歌曲条目的详情页，准备打开：${item.id} ｜ 当前URL ${location.pathname}${location.search}`);
        location.href = buildSongUrl(item.id);
        return;
      }

      if (state.pendingAction) {
        state.pendingAction = null;
        state.phase = continuous ? "continuous-playlist-song-loaded" : "single-step-playlist-song-loaded";
        saveState(state);
        render();
        log(`已进入歌曲页，开始加入播放列表：${state.playlistName || "(未命名播放列表)"} ｜ ${location.pathname}${location.search}`);
      }

      const pageState = await resolvePlaylistSongPageState(item, token);
      if (continuous && token && !isRunValid(token)) return;

      if (pageState.status === "missing") {
        state.missing.push({ ...item, reason: "song-not-available" });
        state.index += 1;
        state.phase = "idle";
        state.pendingAction = null;
        persistImportProgress(state, "播放列表导入全部完成");
        log(`歌曲不存在或当前区服不可用，已跳过：${item.id} ｜ ${item.name || "(无标题)"}`);
        return;
      }

      if (pageState.status === "addable-to-playlist") {
        const addResult = await addCurrentSongToPlaylist(state, item, token);
        if (continuous && token && !isRunValid(token)) return;

        if (addResult.ok) {
          state.done.push(item);
          state.index += 1;
          state.phase = "idle";
          state.pendingAction = null;
          persistImportProgress(state, "播放列表导入全部完成");
          log(`已加入播放列表：${state.playlistName || "(未命名播放列表)"} ｜ ${item.id} ｜ ${item.name || "(无标题)"} ｜ ${addResult.mode}`);
          return;
        }

        state.failed.push({ ...item, reason: addResult.reason || "playlist-add-failed" });
        state.phase = "need-manual-check";
        state.pendingAction = null;
        if (continuous) {
          state.running = false;
          state.runToken = null;
          currentRunToken = null;
        }
        saveState(state);
        render();
        log(`加入播放列表失败，已停下：${item.id} ｜ ${item.name || "(无标题)"} ｜ ${addResult.reason}`);
        return;
      }

      if (pageState.status === "stopped") {
        return;
      }

      state.failed.push({ ...item, reason: `playlist-song-page-${pageState.status || "unknown"}` });
      state.phase = "need-manual-check";
      state.pendingAction = null;
      if (continuous) {
        state.running = false;
        state.runToken = null;
        currentRunToken = null;
      }
      saveState(state);
      render();
      log(`播放列表导入页状态无法识别，已停下：${item.id} ｜ ${item.name || "(无标题)"} ｜ ${pageState.status}`);
      return;
    }

    if (mediaType === "songs") {
      render();

      if (!onSongPage() || !songPageMatchesItem(item)) {
        state.pendingAction = "process-current-item";
        state.phase = continuous ? "navigating-song-continuous" : "navigating-song-single-step";
        saveState(state);
        log(`当前页面不是当前歌曲条目的详情页，准备打开：${item.id} ｜ 当前URL ${location.pathname}${location.search}`);
        location.href = buildSongUrl(item.id);
        return;
      }

      if (state.pendingAction) {
        state.pendingAction = null;
        state.phase = continuous ? "continuous-song-loaded" : "single-step-song-loaded";
        saveState(state);
        render();
        log(`已进入歌曲页，开始判断资料库状态：${location.pathname}${location.search}`);
      }

      const pageState = await resolveSongPageState(item, token);
      if (continuous && token && !isRunValid(token)) return;

      if (pageState.status === "missing") {
        state.missing.push(item);
        state.index += 1;
        state.phase = "idle";
        state.pendingAction = null;
        persistImportProgress(state);
        log(`歌曲不存在或当前区服不可用，已跳过：${item.id} ｜ ${item.name || "(无标题)"}`);
        return;
      }

      if (pageState.status === "already-added") {
        state.skipped.push({ ...item, reason: "already-in-library" });
        state.index += 1;
        state.phase = "idle";
        state.pendingAction = null;
        persistImportProgress(state);
        log(`歌曲已存在资料库中，已跳过：${item.id} ｜ ${item.name || "(无标题)"}`);
        return;
      }

      if (pageState.status === "addable") {
        const addResult = await addCurrentSongToLibrary(item, token, pageState.button);
        if (continuous && token && !isRunValid(token)) return;

        if (addResult.ok) {
          state.done.push(item);
          state.index += 1;
          state.phase = "idle";
          state.pendingAction = null;
          persistImportProgress(state);
          log(`歌曲添加成功：${item.id} ｜ ${item.name || "(无标题)"} ｜ ${addResult.mode}`);
          return;
        }

        state.failed.push({ ...item, reason: addResult.reason || "song-add-failed" });
        state.phase = "need-manual-check";
        state.pendingAction = null;
        if (continuous) {
          state.running = false;
          state.runToken = null;
          currentRunToken = null;
        }
        saveState(state);
        render();
        log(`歌曲添加失败，已停下：${item.id} ｜ ${item.name || "(无标题)"} ｜ ${addResult.reason}`);
        return;
      }

      if (pageState.status === "stopped") {
        return;
      }

      state.failed.push({ ...item, reason: `song-page-${pageState.status || "unknown"}` });
      state.phase = "need-manual-check";
      state.pendingAction = null;
      if (continuous) {
        state.running = false;
        state.runToken = null;
        currentRunToken = null;
      }
      saveState(state);
      render();
      log(`歌曲页状态无法识别，已停下：${item.id} ｜ ${item.name || "(无标题)"} ｜ ${pageState.status}`);
      return;
    }

    if (cleanText(item?.id)) {
      render();

      if (!onAlbumPage() || !albumPageMatchesItem(item)) {
        state.pendingAction = "process-current-item";
        state.phase = continuous ? "navigating-album-continuous" : "navigating-album-single-step";
        saveState(state);
        log(`当前页面不是当前专辑条目的详情页，准备打开：${item.id} ｜ 当前URL ${location.pathname}${location.search}`);
        location.href = buildAlbumUrl(item.id);
        return;
      }

      if (state.pendingAction) {
        state.pendingAction = null;
        state.phase = continuous ? "continuous-album-loaded" : "single-step-album-loaded";
        saveState(state);
        render();
        log(`已进入专辑页，开始判断资料库状态：${location.pathname}${location.search}`);
      }

      const pageState = await resolveAlbumPageState(item, token);
      if (continuous && token && !isRunValid(token)) return;

      if (pageState.status === "missing") {
        state.missing.push(item);
        state.index += 1;
        state.phase = "idle";
        state.pendingAction = null;
        persistImportProgress(state);
        log(`专辑不存在或当前区服不可用，已跳过：${item.id} ｜ ${item.name || item.album || "(无标题)"}`);
        return;
      }

      if (pageState.status === "already-added") {
        state.skipped.push({ ...item, reason: "already-in-library" });
        state.index += 1;
        state.phase = "idle";
        state.pendingAction = null;
        persistImportProgress(state);
        log(`专辑已存在资料库中，已跳过：${item.id} ｜ ${item.name || item.album || "(无标题)"}`);
        return;
      }

      if (pageState.status === "addable") {
        const addResult = await addCurrentAlbumToLibrary(item, token, pageState.button);
        if (continuous && token && !isRunValid(token)) return;

        if (addResult.ok) {
          state.done.push(item);
          state.index += 1;
          state.phase = "idle";
          state.pendingAction = null;
          persistImportProgress(state);
          log(`专辑添加成功：${item.id} ｜ ${item.name || item.album || "(无标题)"} ｜ ${addResult.mode}`);
          return;
        }

        state.failed.push({ ...item, reason: addResult.reason || "album-add-failed" });
        state.phase = "need-manual-check";
        state.pendingAction = null;
        if (continuous) {
          state.running = false;
          state.runToken = null;
          currentRunToken = null;
        }
        saveState(state);
        render();
        log(`专辑添加失败，已停下：${item.id} ｜ ${item.name || item.album || "(无标题)"} ｜ ${addResult.reason}`);
        return;
      }

      if (pageState.status === "stopped") {
        return;
      }

      state.failed.push({ ...item, reason: `album-page-${pageState.status || "unknown"}` });
      state.phase = "need-manual-check";
      state.pendingAction = null;
      if (continuous) {
        state.running = false;
        state.runToken = null;
        currentRunToken = null;
      }
      saveState(state);
      render();
      log(`专辑页状态无法识别，已停下：${item.id} ｜ ${item.name || item.album || "(无标题)"} ｜ ${pageState.status}`);
      return;
    }

    render();

    if (!onSearchPage() || !searchPageMatchesItem(item)) {
      state.pendingAction = "process-current-item";
      state.phase = continuous ? "navigating-search-continuous" : "navigating-search-single-step";
      saveState(state);
      log(`当前页面不是当前条目的搜索页，准备打开搜索：${item.artist} - ${item.album} ｜ 当前URL ${location.pathname}${location.search} ｜ 当前term ${getCurrentSearchTerm() || "(空)"}`);
      location.href = makeSearchUrl(item);
      return;
    }

    if (state.pendingAction) {
      state.pendingAction = null;
      state.phase = continuous ? "continuous-search-loaded" : "single-step-search-loaded";
      saveState(state);
      render();
      log(`已进入搜索页，开始识别候选：${location.pathname}${location.search}`);
    }

    const result = await pickAndAddFromSearch(item, token);
    if (continuous && token && !isRunValid(token)) return;

    if (result.ok) {
      state.done.push(item);
      state.index += 1;
      state.phase = "idle";
      state.pendingAction = null;
      persistImportProgress(state);
      log(`成功：${item.artist} - ${item.album}`);
      return;
    }

    if (result.reason === "manual-cancel") {
      state.phase = "need-manual-check";
      state.pendingAction = null;
      if (continuous) {
        state.running = false;
        state.runToken = null;
        currentRunToken = null;
      }
      saveState(state);
      render();
      log(`已停下，等待你手动确认：${item.artist} - ${item.album}`);
      return;
    }

    state.failed.push({ ...item, reason: result.reason || "unknown-error" });
    state.phase = "need-manual-check";
    state.pendingAction = null;
    if (continuous) {
      state.running = false;
      state.runToken = null;
      currentRunToken = null;
    }
    saveState(state);
    render();
    log(`失败，已停下：${item.artist} - ${item.album} ｜ ${result.reason}`);
  }

  async function autoLoop(token) {
    while (isRunValid(token)) {
      await processOne(true, token);

      if (!isRunValid(token)) break;

      const state = loadState();
      const item = getCurrentItem(state);
      if (!state || !state.running || !item) break;

      await sleep(1500);
      if (!isRunValid(token)) break;

      location.href = getItemNavigationUrl(state, item);
      return;
    }
  }

  function boot() {
    loadUIState();
    ensurePanel();
    render();

    const pendingSwitch = getPendingStorefrontSwitch();
    if (pendingSwitch) {
      const current = getStorefrontFromUrl();
      clearPendingStorefrontSwitch();
      if (current !== pendingSwitch) {
        alert("区服切换失败,请检查网络环境");
      }
    }

    const pendingLanguage = getPendingLanguageSwitch();
    if (pendingLanguage) {
      const currentLanguage = getCurrentLanguage();
      clearPendingLanguageSwitch();
      if (normalizeLanguageCode(currentLanguage) !== pendingLanguage) {
        alert("语言切换失败,请检查网络环境");
      }
    }

    const sf = getStorefrontFromUrl();
    if (sf && !getSavedStorefront()) setSavedStorefront(sf);
    const currentLanguage = getCurrentLanguage();
    if (currentLanguage) setSavedLanguage(currentLanguage);

    const pendingExportAlbumsReload = getPendingExportAlbumsReload();
    if (pendingExportAlbumsReload) {
      resumeExportAlbumsAfterReload();
      return;
    }

    const pendingExportSongsReload = getPendingExportSongsReload();
    if (pendingExportSongsReload) {
      resumeExportSongsAfterReload();
      return;
    }

    const state = loadState();
    if (state?.running && state?.runToken) {
      currentRunToken = state.runToken;
      log("检测到连续处理任务，准备继续执行");
      setTimeout(() => autoLoop(state.runToken), 1500);
      return;
    }

    if (
      state?.pendingAction === "process-current-item" &&
      (
        (getImportMediaType(state) === "albums" && (onAlbumPage() || onSearchPage())) ||
        (["songs", "playlists"].includes(getImportMediaType(state)) && onSongPage())
      )
    ) {
      const mediaType = getImportMediaType(state);
      const pageLabel = mediaType === "songs" || mediaType === "playlists"
        ? "歌曲页"
        : (onAlbumPage() ? "专辑页" : "搜索页");
      log(`检测到待继续的单步任务，准备在${pageLabel}继续处理`);
      setTimeout(() => processOne(false), 1500);
    }
  }

  function startBoot() {
    if (bootStarted) return;

    if (!document.body) {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startBoot, { once: true });
      } else {
        setTimeout(startBoot, 50);
      }
      return;
    }

    bootStarted = true;
    boot();
  }

  setupPendingAlbumsBootstrapInterceptor();
  setupPendingSongsBootstrapInterceptor();
  startBoot();
})();
