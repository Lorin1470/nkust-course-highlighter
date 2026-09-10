/**
 * NKUST Course Quota Highlighter - Popup Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  const fetchModeSelect = document.getElementById('fetchMode');
  const cacheTTLSelect = document.getElementById('cacheTTLSec');
  const targetCoursesInput = document.getElementById('targetCourses');
  const thresholdSlider = document.getElementById('lowQuotaThreshold');
  const thresholdValue = document.getElementById('thresholdValue');
  const btnRefresh = document.getElementById('btnRefresh');
  const saveNotice = document.getElementById('saveNotice');

  // 1. 讀取並顯示現有設定
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get({
      fetchMode: 'auto',
      lowQuotaThreshold: 5,
      cacheTTLSec: 20,
      targetCourses: []
    }, (items) => {
      if (fetchModeSelect) fetchModeSelect.value = items.fetchMode;
      if (thresholdSlider) thresholdSlider.value = items.lowQuotaThreshold;
      if (thresholdValue) thresholdValue.textContent = `${items.lowQuotaThreshold} 人以下`;
      if (cacheTTLSelect) cacheTTLSelect.value = String(items.cacheTTLSec || 20);
      if (targetCoursesInput && Array.isArray(items.targetCourses)) {
        targetCoursesInput.value = items.targetCourses.join(', ');
      }
    });
  }

  // 2. 監聽拉桿變更
  if (thresholdSlider) {
    thresholdSlider.addEventListener('input', () => {
      const val = parseInt(thresholdSlider.value, 10);
      if (thresholdValue) thresholdValue.textContent = `${val} 人以下`;
      saveSettings();
    });
  }

  // 3. 監聽載入模式與快取變更
  if (fetchModeSelect) {
    fetchModeSelect.addEventListener('change', () => {
      saveSettings();
    });
  }

  if (cacheTTLSelect) {
    cacheTTLSelect.addEventListener('change', () => {
      saveSettings();
    });
  }

  // 4. 監聽目標課程輸入變更
  if (targetCoursesInput) {
    targetCoursesInput.addEventListener('change', () => {
      saveSettings();
    });
  }

  // 5. 手動「立即更新名額」按鈕
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      btnRefresh.disabled = true;
      btnRefresh.innerHTML = `
        <svg class="nkust-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
        更新名額中...
      `;

      notifyActiveTab({ type: 'REFRESH_QUOTAS' }, (res) => {
        setTimeout(() => {
          btnRefresh.disabled = false;
          btnRefresh.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
            🔄 立即更新名額 (重新查詢)
          `;
          const countMsg = (res && typeof res.count === 'number')
            ? `已排程刷新 ${res.count} 門課程名額`
            : '已清空快取並優先更新名額';
          showNotice(countMsg);
        }, 400);
      });
    });
  }

  function saveSettings() {
    // 解析目標課號清單 (支援逗號、空格分隔)
    const rawTarget = targetCoursesInput ? targetCoursesInput.value : '';
    const targetCourses = rawTarget
      .split(/[,，\s]+/)
      .map(s => s.trim())
      .filter(Boolean);

    const newSettings = {
      fetchMode: fetchModeSelect ? fetchModeSelect.value : 'auto',
      lowQuotaThreshold: thresholdSlider ? parseInt(thresholdSlider.value, 10) : 5,
      cacheTTLSec: cacheTTLSelect ? parseInt(cacheTTLSelect.value, 10) : 20,
      targetCourses
    };

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set(newSettings, () => {
        showNotice('設定已儲存並即時套用');
        notifyActiveTab({
          type: 'SETTINGS_UPDATED',
          settings: newSettings
        });
      });
    }
  }

  function showNotice(text) {
    if (!saveNotice) return;
    saveNotice.textContent = text;
    saveNotice.classList.add('show');
    setTimeout(() => {
      saveNotice.classList.remove('show');
    }, 2500);
  }

  function notifyActiveTab(message, callback) {
    if (typeof chrome === 'undefined' || !chrome.tabs) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
          if (chrome.runtime.lastError) {
            // 忽略未注入 content script 或非選課頁面之錯誤
          }
          if (callback) callback(response);
        });
      } else if (callback) {
        callback();
      }
    });
  }
});
