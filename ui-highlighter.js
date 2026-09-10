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
}

window.nkustUiHighlighter = new NkustUiHighlighter();
