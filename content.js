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
    console.log('[NKUST Highlighter] 插件已啟動');
    
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
            currentSettings = { ...currentSettings, ...items };
            config.DEFAULTS.lowQuotaThreshold = currentSettings.lowQuotaThreshold;
            config.DEFAULTS.fetchMode = currentSettings.fetchMode;
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * 掃描並處理當前表格內的所有課程列
   */
  function scanAndProcessCourses() {
    const rows = document.querySelectorAll(config.SELECTORS.courseRows);
    if (!rows || rows.length === 0) return;

    // 針對每一筆課程進行分析
    rows.forEach(row => {
      // 避免重複綁定 hover
      if (row.getAttribute('data-nkust-processed') === 'true') {
        const status = row.getAttribute('data-nkust-status');
        if (status) return; // 已經標註完畢
      }

      const courseData = extractCourseDataFromRow(row);
      if (!courseData.encodeCrsno && !courseData.crsno && !courseData.courseId) return;

      row.setAttribute('data-nkust-processed', 'true');

      const cacheKey = courseData.encodeCrsno || courseData.crsno || courseData.courseId;
      const cached = apiService.getCached(cacheKey);

      if (cached) {
        uiHighlighter.highlightRow(row, cached);
        return;
      }

      if (currentSettings.fetchMode === 'auto') {
        // 自動模式：先顯示載入中，並排入安全佇列
        uiHighlighter.setRowLoading(row);
        apiService.enqueue(courseData, (result) => {
          uiHighlighter.highlightRow(row, result);
        });
      } else {
        // Hover 模式：滑鼠移過人數圖示時才即時發送高優先度請求
        setupHoverTrigger(row, courseData);
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
  function setupHoverTrigger(row, courseData) {
    const usersIcon = row.querySelector(config.SELECTORS.usersIcon) || row;
    
    const onHover = () => {
      const cacheKey = courseData.encodeCrsno || courseData.crsno || courseData.courseId;
      const cached = apiService.getCached(cacheKey);
      if (cached) {
        uiHighlighter.highlightRow(row, cached);
        return;
      }

      uiHighlighter.setRowLoading(row);
      apiService.enqueue(courseData, (result) => {
        uiHighlighter.highlightRow(row, result);
      }, true); // 高優先度
    };

    usersIcon.addEventListener('mouseenter', onHover, { once: true });
  }

  /**
   * 建立 MutationObserver 監聽動態表格變更 (換頁、搜尋、筆數切換)
   */
  function setupMutationObserver() {
    const targetNode = document.querySelector(config.SELECTORS.gridContainer) || document.body;

    observer = new MutationObserver((mutations) => {
      let shouldScan = false;

      for (const mutation of mutations) {
        // 若有新節點增加或 tbody 內容改變
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
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
        debounceTimer = setTimeout(() => {
          scanAndProcessCourses();
        }, config.DEFAULTS.debounceMs);
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
          config.DEFAULTS.lowQuotaThreshold = currentSettings.lowQuotaThreshold;
          config.DEFAULTS.fetchMode = currentSettings.fetchMode;

          // 重新掃描並更新現有畫面的名額狀態
          uiHighlighter.clearAll();
          // 重設 processed 狀態以重新著色
          document.querySelectorAll(config.SELECTORS.courseRows).forEach(row => {
            row.removeAttribute('data-nkust-processed');
          });
          scanAndProcessCourses();
          sendResponse({ success: true });
        } else if (request.type === 'CLEAR_CACHE') {
          apiService.clearCache();
          uiHighlighter.clearAll();
          document.querySelectorAll(config.SELECTORS.courseRows).forEach(row => {
            row.removeAttribute('data-nkust-processed');
          });
          scanAndProcessCourses();
          sendResponse({ success: true });
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
