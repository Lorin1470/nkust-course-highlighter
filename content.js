/**
 * NKUST Course Quota Highlighter - Content Script
 * 核心協調器：監聽 Kendo Grid DOM 動態變更、擷取課程資料並調度名額解析與 UI 著色。
 */

(function () {
  'use strict';

  const config = window.NKUST_CONFIG;
  const apiService = window.nkustApiService;
  const uiHighlighter = window.nkustUiHighlighter;

  let currentSettings = { ...config.DEFAULTS };
  let observer = null;
  let debounceTimer = null;

  /**
   * 初始化設定並啟動監聽
   */
  async function init() {
    console.log('[NKUST Highlighter] 插件已啟動 (選課/搶課優化版)');
    
    // 載入使用者偏好設定 (若有)
    await loadSettings();

    // 初始檢驗目前頁面
    scanAndProcessCourses();

    // 啟動 DOM 監聽器
    setupMutationObserver();

    // 監聽來自 Popup 彈跳選單的即時設定變更
    setupMessageListener();
  }

  /**
   * 讀取儲存的使用者設定
   */
  async function loadSettings() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get(config.DEFAULTS, (items) => {
          if (items) {
            currentSettings = { ...config.DEFAULTS, ...items };
            config.updateSettings(currentSettings);
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * 判斷課程列是否在目前螢幕或容器可視範圍內 (提高可見課程的優先序)
   */
  function isRowVisible(row) {
    if (!row || !row.getBoundingClientRect) return false;
    const rect = row.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;

    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const inWindow = rect.top < windowHeight && rect.bottom > 0;
    if (!inWindow) return false;

    const scrollParent = row.closest('.k-grid-content');
    if (scrollParent) {
      const parentRect = scrollParent.getBoundingClientRect();
      return rect.top < parentRect.bottom && rect.bottom > parentRect.top;
    }
    return true;
  }

  /**
   * 掃描並處理當前表格內的所有課程列 (支援優先級與手動更新)
   * @param {Object} options - { forceRefresh: boolean, isManualRefresh: boolean }
   */
  function scanAndProcessCourses(options = {}) {
    const rows = document.querySelectorAll(config.SELECTORS.courseRows);
    if (!rows || rows.length === 0) return;

    const settings = config.getSettings ? config.getSettings() : currentSettings;
    const targetList = Array.isArray(settings.targetCourses) ? settings.targetCourses : [];

    rows.forEach(row => {
      const courseData = extractCourseDataFromRow(row);
      if (!courseData.encodeCrsno && !courseData.crsno && !courseData.courseId) return;

      const cacheKey = courseData.encodeCrsno || courseData.crsno || courseData.courseId;
      const isTarget = targetList.includes(courseData.crsno);

      // 若非強制刷新，且快取仍有效，直接使用快取渲染並標記
      if (!options.forceRefresh) {
        const cached = apiService.getCached(cacheKey);
        if (cached) {
          row.setAttribute('data-nkust-processed', 'true');
          uiHighlighter.highlightRow(row, { ...cached, isTarget });
          return;
        }

        // 若已處理過且快取尚未過期 (防重複掃描)
        if (row.getAttribute('data-nkust-processed') === 'true' && row.getAttribute('data-nkust-status')) {
          return;
        }
      }

      row.setAttribute('data-nkust-processed', 'true');

      // 判定佇列優先級 (數字越小越優先)
      // 1: 手動觸發 / 目標課程 (最高優先)
      // 2: 眼前螢幕可見課程 (次高優先)
      // 3: 頁面其餘課程 (一般)
      let priority = config.PRIORITY.NORMAL;
      if (options.isManualRefresh || isTarget) {
        priority = config.PRIORITY.MANUAL;
      } else if (isRowVisible(row)) {
        priority = config.PRIORITY.VISIBLE;
      }

      if (settings.fetchMode === 'auto' || options.isManualRefresh || isTarget) {
        // 先顯示載入中狀態 (包含目標課號提示)
        uiHighlighter.setRowLoading(row, isTarget);

        apiService.enqueue(courseData, (result) => {
          uiHighlighter.highlightRow(row, { ...result, isTarget });
          if (typeof options.onTaskFinished === 'function') {
            options.onTaskFinished(result, courseData);
          }
        }, priority);
      } else {
        // Hover 模式：滑鼠移過人數圖示才載入
        setupHoverTrigger(row, courseData, isTarget);
      }
    });
  }

  /**
   * 從單一 <tr> 擷取課號、加密課號、課程 ID
   */
  function extractCourseDataFromRow(row) {
    // 課號文字 (td:nth-child(3))
    const crsnoCell = row.querySelector(config.SELECTORS.cellCourseNo);
    const crsno = crsnoCell ? crsnoCell.textContent.trim() : '';

    // 加密課號 EncodeCrsno (來自 i.selcrsnum 的 data-id)
    const usersIcon = row.querySelector(config.SELECTORS.usersIcon);
    const encodeCrsno = usersIcon ? usersIcon.getAttribute('data-id') : '';

    // 課程名稱
    const courseLink = row.querySelector(config.SELECTORS.courseInfoLink);
    const courseId = courseLink ? courseLink.getAttribute('data-id') : '';
    const courseName = courseLink ? courseLink.textContent.trim() : '';

    // 加選按鈕上的 data-no / data-id
    const addBtn = row.querySelector(config.SELECTORS.addButton);
    const btnNo = addBtn ? addBtn.getAttribute('data-no') : '';
    const btnId = addBtn ? addBtn.getAttribute('data-id') : '';

    return {
      crsno: crsno || btnNo,
      encodeCrsno,
      courseId: courseId || btnId,
      courseName,
      rowElement: row
    };
  }

  /**
   * 為 Hover 模式設定事件觸發
   */
  function setupHoverTrigger(row, courseData, isTarget = false) {
    const usersIcon = row.querySelector(config.SELECTORS.usersIcon) || row;
    
    const onHover = () => {
      const cacheKey = courseData.encodeCrsno || courseData.crsno || courseData.courseId;
      const cached = apiService.getCached(cacheKey);
      if (cached) {
        uiHighlighter.highlightRow(row, { ...cached, isTarget });
        return;
      }

      uiHighlighter.setRowLoading(row, isTarget);
      // 使用者互動觸發給予最高優先度 MANUAL (1)
      apiService.enqueue(courseData, (result) => {
        uiHighlighter.highlightRow(row, { ...result, isTarget });
      }, config.PRIORITY.MANUAL);
    };

    usersIcon.addEventListener('mouseenter', onHover, { once: true });
  }

  /**
   * 建立 MutationObserver 監聽動態表格變更 (換頁、搜尋、筆數切換)
   * 增加自我防護，忽略自身添加的 Badge 與 Refresh Indicator，避免無限觸發
   */
  function setupMutationObserver() {
    const targetNode = document.querySelector(config.SELECTORS.gridContainer) || document.body;

    observer = new MutationObserver((mutations) => {
      let shouldScan = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // 忽略插件自產的 Badge、狀態標籤與刷新指示器
              if (node.classList && (
                node.classList.contains('nkust-quota-badge') ||
                node.classList.contains('nkust-refresh-indicator') ||
                node.querySelector('.nkust-quota-badge') ||
                node.querySelector('.nkust-refresh-indicator')
              )) {
                continue;
              }
              if (node.matches && (node.matches('tr') || node.querySelector('tr') || node.matches('.k-grid-table'))) {
                shouldScan = true;
                break;
              }
            }
          }
        }
        if (shouldScan) break;
      }

      if (shouldScan) {
        clearTimeout(debounceTimer);
        const settings = config.getSettings ? config.getSettings() : currentSettings;
        debounceTimer = setTimeout(() => {
          scanAndProcessCourses();
        }, settings.debounceMs || 250);
      }
    });

    observer.observe(targetNode, {
      childList: true,
      subtree: true
    });
  }

  /**
   * 監聽 Popup 即時指令與設定更新
   */
  function setupMessageListener() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'SETTINGS_UPDATED') {
          currentSettings = { ...currentSettings, ...request.settings };
          config.updateSettings(currentSettings);

          // 重新掃描並更新現有畫面的名額狀態 (保留有效快取)
          document.querySelectorAll(config.SELECTORS.courseRows).forEach(row => {
            row.removeAttribute('data-nkust-processed');
          });
          scanAndProcessCourses();
          sendResponse({ success: true });
        } else if (request.type === 'REFRESH_QUOTAS' || request.type === 'CLEAR_CACHE') {
          // 1. 取消目前所有 active requests (使用 AbortController 防止新舊競爭)
          apiService.cancelActiveRequests();
          // 2. 清空待辦排隊佇列
          apiService.clearQueue();
          // 3. 清空記憶體快取
          apiService.clearCache();

          // 4. 重設 DOM 處理標籤
          const allRows = document.querySelectorAll(config.SELECTORS.courseRows);
          allRows.forEach(row => {
            row.removeAttribute('data-nkust-processed');
          });

          // 計算有效課程列總數，並啟動頁面刷新指示器
          const validRows = Array.from(allRows).filter(row => {
            const d = extractCourseDataFromRow(row);
            return !!(d.encodeCrsno || d.crsno || d.courseId);
          });
          const total = validRows.length;
          let completed = 0;
          let hasErrors = false;

          if (total > 0) {
            uiHighlighter.showRefreshProgress(0, total);
          } else {
            uiHighlighter.showRefreshComplete(false);
          }

          // 5. 立即以最高優先度重新查詢名額，並更新進度
          scanAndProcessCourses({
            forceRefresh: true,
            isManualRefresh: true,
            onTaskFinished: (result) => {
              completed++;
              if (result && result.status === config.STATUS.ERROR) {
                hasErrors = true;
              }
              uiHighlighter.showRefreshProgress(completed, total);
              if (completed >= total) {
                uiHighlighter.showRefreshComplete(hasErrors);
              }
            }
          });

          sendResponse({ success: true, count: total });
        }
        return true;
      });
    }
  }

  // 當 DOM 準備完畢後啟動
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
