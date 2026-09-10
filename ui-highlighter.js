/**
 * NKUST Course Quota Highlighter - UI Highlighter Module
 * 負責將名額狀態與顏色指標以非破壞性方式呈現在 DOM 上。
 */

class NkustUiHighlighter {
  constructor() {
    this.config = window.NKUST_CONFIG;
  }

  /**
   * 標註整列課程列與注入名額小標籤
   */
  highlightRow(rowElement, quotaInfo) {
    if (!rowElement) return;

    // 清除既有狀態 class
    this.clearRowStatus(rowElement);

    const { status, remaining, capacity, enrolled, isMock, isTarget } = quotaInfo;

    // 1. 為 <tr> 附加狀態樣式 Class
    rowElement.classList.add(`nkust-status-${status}`);
    rowElement.setAttribute('data-nkust-status', status);

    if (isTarget) {
      rowElement.classList.add('nkust-row-target');
      rowElement.setAttribute('data-nkust-target', 'true');
    }

    // 2. 找到課名欄位 (td:nth-child(4)) 與人數小圖示 (.selcrsnum)
    const nameCell = rowElement.querySelector(this.config.SELECTORS.cellCourseName);
    if (!nameCell) return;

    const usersIcon = nameCell.querySelector(this.config.SELECTORS.usersIcon);

    // 3. 取得或建立名額標籤 Badge
    let badge = nameCell.querySelector('.nkust-quota-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'nkust-quota-badge';
      if (usersIcon && usersIcon.nextSibling) {
        usersIcon.parentNode.insertBefore(badge, usersIcon.nextSibling);
      } else {
        nameCell.appendChild(badge);
      }
    }

    // 更新 Badge 樣式與文字
    badge.className = `nkust-quota-badge nkust-badge-${status}${isTarget ? ' nkust-badge-target' : ''}`;

    let displayText = '';
    let tooltipText = '';

    const resInfo = (typeof reserved === 'number' && reserved > 0) ? ` (保留: ${reserved}人)` : '';

    if (status === this.config.STATUS.LOADING) {
      displayText = '查詢中...';
      tooltipText = '正在安全取得名額資訊...';
    } else if (status === this.config.STATUS.FULL) {
      displayText = '已額滿';
      tooltipText = `限修: ${capacity ?? '-'}人 | 已選: ${enrolled ?? '-'}人${resInfo} | 剩餘: 0人`;
    } else if (remaining !== null && remaining > 0) {
      // 只要 remaining > 0，一律顯示名額，絕不誤判不可選
      displayText = `餘 ${remaining}`;
      tooltipText = `限修: ${capacity ?? '-'}人 | 已選: ${enrolled ?? '-'}人${resInfo} | 剩餘: ${remaining}人`;
      if (isMock) tooltipText += ' (本地測試模擬數據)';
    } else if (status === this.config.STATUS.AVAILABLE || status === this.config.STATUS.LOW) {
      displayText = `餘 ${remaining ?? '?'}`;
      tooltipText = `限修: ${capacity ?? '-'}人 | 已選: ${enrolled ?? '-'}人${resInfo} | 剩餘: ${remaining ?? '?'}人`;
      if (isMock) tooltipText += ' (本地測試模擬數據)';
    } else if (status === this.config.STATUS.ERROR || quotaInfo.error) {
      displayText = '查詢失敗';
      tooltipText = quotaInfo.error
        ? `名額查詢失敗 (${quotaInfo.error})，請稍後重新整理`
        : '名額查詢失敗，請稍後重新整理';
    } else if (status === this.config.STATUS.UNAVAILABLE) {
      displayText = '不可選';
      tooltipText = '此課程停開或容量為 0';
    } else {
      displayText = '未知';
      tooltipText = '無法確認名額狀態，請稍後重新整理';
    }

    if (isTarget) {
      displayText = `🎯 ${displayText}`;
      tooltipText = `[目標追蹤] ${tooltipText}`;
    }

    badge.textContent = displayText;
    badge.title = tooltipText;

    // 4. 若加選按鈕為 disabled 或限修，加強不可選提示
    const addBtn = rowElement.querySelector(this.config.SELECTORS.addButton);
    if (addBtn && (addBtn.disabled || addBtn.textContent.includes('限修'))) {
      rowElement.classList.add('nkust-row-disabled');
    }
  }

  /**
   * 設定為載入中狀態
   */
  setRowLoading(rowElement, isTarget = false) {
    if (!rowElement) return;
    this.highlightRow(rowElement, {
      status: this.config.STATUS.LOADING,
      remaining: null,
      isTarget
    });
  }

  /**
   * 清除整列之狀態 Class
   */
  clearRowStatus(rowElement) {
    rowElement.classList.remove(
      'nkust-status-available',
      'nkust-status-low',
      'nkust-status-full',
      'nkust-status-unavailable',
      'nkust-status-error',
      'nkust-status-loading',
      'nkust-row-disabled',
      'nkust-row-target'
    );
    rowElement.removeAttribute('data-nkust-status');
    rowElement.removeAttribute('data-nkust-target');
  }

  /**
   * 清除頁面所有注入的高亮與標籤
   */
  clearAll() {
    const rows = document.querySelectorAll(this.config.SELECTORS.courseRows);
    rows.forEach(row => {
      this.clearRowStatus(row);
      const badge = row.querySelector('.nkust-quota-badge');
      if (badge) badge.remove();
    });
  }

  /**
   * 顯示或更新選課頁面上的輕量級刷新指示器 (無遮蔽非阻擋懸浮標籤)
   * @param {number} current - 目前已完成查詢的課程數
   * @param {number} total - 本次需查詢的總課程數
   */
  showRefreshProgress(current, total) {
    let indicator = document.querySelector('.nkust-refresh-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'nkust-refresh-indicator nkust-indicator-loading';
      document.body.appendChild(indicator);
    }

    indicator.classList.remove('nkust-indicator-complete', 'nkust-indicator-warning', 'nkust-indicator-hide');
    indicator.classList.add('nkust-indicator-loading');

    const progressText = (typeof current === 'number' && typeof total === 'number' && total > 0)
      ? ` ${current} / ${total}`
      : '';

    indicator.innerHTML = `
      <span class="nkust-indicator-icon nkust-spin">🔄</span>
      <span class="nkust-indicator-text">正在更新名額…${progressText}</span>
    `;
  }

  /**
   * 刷新完成通知 (自動淡出，不阻礙使用者選課操作)
   * @param {boolean} hasErrors - 是否有部分課程查詢失敗
   */
  showRefreshComplete(hasErrors = false) {
    const indicator = document.querySelector('.nkust-refresh-indicator');
    if (!indicator) return;

    indicator.classList.remove('nkust-indicator-loading');

    if (hasErrors) {
      indicator.classList.add('nkust-indicator-warning');
      indicator.innerHTML = `
        <span class="nkust-indicator-icon">⚠</span>
        <span class="nkust-indicator-text">名額更新完成，但部分課程查詢失敗</span>
      `;
    } else {
      indicator.classList.add('nkust-indicator-complete');
      indicator.innerHTML = `
        <span class="nkust-indicator-icon">✓</span>
        <span class="nkust-indicator-text">名額已更新</span>
      `;
    }

    clearTimeout(this._indicatorTimer);
    this._indicatorTimer = setTimeout(() => {
      indicator.classList.add('nkust-indicator-hide');
      setTimeout(() => {
        if (indicator.parentNode) {
          indicator.parentNode.removeChild(indicator);
        }
      }, 350);
    }, hasErrors ? 2500 : 1500);
  }
}

window.nkustUiHighlighter = new NkustUiHighlighter();
