/**
 * NKUST Course Quota Highlighter - Popup Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  const fetchModeSelect = document.getElementById('fetchMode');
  const thresholdSlider = document.getElementById('lowQuotaThreshold');
  const thresholdValue = document.getElementById('thresholdValue');
  const btnRefresh = document.getElementById('btnRefresh');
  const saveNotice = document.getElementById('saveNotice');

  // 1. 讀取並顯示現有設定
  if (chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get({
      fetchMode: 'auto',
      lowQuotaThreshold: 5
    }, (items) => {
      fetchModeSelect.value = items.fetchMode;
      thresholdSlider.value = items.lowQuotaThreshold;
      thresholdValue.textContent = `${items.lowQuotaThreshold} 人以下`;
    });
  }

  // 2. 監聽拉桿變更
  thresholdSlider.addEventListener('input', () => {
    const val = parseInt(thresholdSlider.value, 10);
    thresholdValue.textContent = `${val} 人以下`;
    saveSettings();
  });

  // 3. 監聽載入模式變更
  fetchModeSelect.addEventListener('change', () => {
    saveSettings();
  });

  // 4. 清除快取 / 重新整理
  btnRefresh.addEventListener('click', () => {
    btnRefresh.disabled = true;
    btnRefresh.textContent = '重整中...';

    notifyActiveTab({ type: 'CLEAR_CACHE' }, () => {
      setTimeout(() => {
        btnRefresh.disabled = false;
        btnRefresh.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
          重新整理 / 清除快取
        `;
        showNotice('快取已清除並重新整理');
      }, 500);
    });
  });

  function saveSettings() {
    const newSettings = {
      fetchMode: fetchModeSelect.value,
      lowQuotaThreshold: parseInt(thresholdSlider.value, 10)
    };

    if (chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set(newSettings, () => {
        showNotice('設定已儲存並生效');
        notifyActiveTab({
          type: 'SETTINGS_UPDATED',
          settings: newSettings
        });
      });
    }
  }

  function showNotice(text) {
    saveNotice.textContent = text;
    saveNotice.classList.add('show');
    setTimeout(() => {
      saveNotice.classList.remove('show');
    }, 2000);
  }

  function notifyActiveTab(message, callback) {
    if (!chrome.tabs) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
          if (chrome.runtime.lastError) {
            // 忽略未注入 content script 的 tab 錯誤
          }
          if (callback) callback(response);
        });
      } else if (callback) {
        callback();
      }
    });
  }
});
