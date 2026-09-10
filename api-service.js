/**
 * NKUST Course Quota Highlighter - API & Parsing Service
 * 負責快取管理、安全排程佇列、伺服器 HTML 解析，以及計算剩餘名額。
 */

class NkustApiService {
  constructor() {
    // 記憶體快取: EncodeCrsno -> { capacity, enrolled, reserved, remaining, status, timestamp }
    this.cache = new Map();
    
    // 請求佇列
    this.queue = [];
    this.activeRequests = 0;
    this.isProcessing = false;

    // 進行中的請求中斷控制器集合
    this.activeControllers = new Set();
    // 進行中的任務映射 (cacheKey -> task)
    this.activeTasks = new Map();
    // 學年期快取避免重複查詢 DOM 與重複 log
    this._cachedAcademic = null;
    
    // 設定參考
    this.config = window.NKUST_CONFIG;
  }

  /**
   * 取得快取的名額資料 (含 TTL 檢查，過期自動視為 cache miss)
   */
  getCached(key) {
    if (!key) return null;
    const item = this.cache.get(key);
    if (!item) return null;

    const settings = (this.config && this.config.getSettings)
      ? this.config.getSettings()
      : (this.config ? this.config.DEFAULTS : {});
    const ttlMs = ((settings && settings.cacheTTLSec) ? settings.cacheTTLSec : 20) * 1000;

    if (Date.now() - item.timestamp > ttlMs) {
      this.cache.delete(key);
      return null;
    }

    // 動態根據當前 lowQuotaThreshold 更新狀態 (若有確切剩餘名額且非不可選)
    if (item.remaining !== null && item.remaining > 0 && item.capacity !== 0) {
      const threshold = (settings && settings.lowQuotaThreshold) || 5;
      item.status = item.remaining <= threshold
        ? this.config.STATUS.LOW
        : this.config.STATUS.AVAILABLE;
    }

    return item;
  }

  /**
   * 設定快取
   */
  setCached(key, data) {
    if (!key) return;
    this.cache.set(key, {
      ...data,
      timestamp: Date.now()
    });
  }

  /**
   * 清除快取 (可指定特定 keys 或清空全部)
   */
  clearCache(keys = null) {
    if (Array.isArray(keys)) {
      keys.forEach(k => this.cache.delete(k));
    } else {
      this.cache.clear();
      this._cachedAcademic = null;
    }
  }

  /**
   * 清除尚未執行的排隊佇列
   */
  clearQueue() {
    this.queue = [];
  }

  /**
   * 取消目前正在發送與處理中的所有 active requests (使用 AbortController)
   */
  cancelActiveRequests() {
    for (const controller of this.activeControllers) {
      try {
        controller.abort();
      } catch (e) {
        // 忽略單一取消失敗
      }
    }
    this.activeControllers.clear();
    this.activeTasks.clear();
  }

  /**
   * 取得當前學年與學期（嘗試多種選擇器以增加容錯性）
   */
  getAcademicYearAndSemester() {
    if (this._cachedAcademic) {
      return this._cachedAcademic;
    }

    const yearSel = [
      '#SchoolYear',
      '[name="SchoolYear"]',
      'input#SchoolYear',
      'input[name="SchoolYear"]'
    ].find(sel => {
      const el = document.querySelector(sel);
      return el && el.value !== '';
    });
    const semSel = [
      '#Semester',
      '[name="Semester"]',
      'input#Semester',
      'input[name="Semester"]'
    ].find(sel => {
      const el = document.querySelector(sel);
      return el && el.value !== '';
    });

    const yearEl = yearSel ? document.querySelector(yearSel) : null;
    const semEl = semSel ? document.querySelector(semSel) : null;

    const year = yearEl ? yearEl.value : '115';
    const semester = semEl ? semEl.value : '1';
    console.log('[NKUST Highlighter] Academic year:', year, 'semester:', semester);
    this._cachedAcademic = { year, semester };
    return this._cachedAcademic;
  }

  /**
   * 產生查詢參數（POST body 或 URL query string）
   */
  buildParams(courseData, { year, semester }) {
    const params = new URLSearchParams();
    params.append('selCrsno', courseData.encodeCrsno);
    params.append('selSchoolYear', year);
    params.append('selSemester', semester);
    return params;
  }

  /**
   * 透過 POST 發送請求（application/x-www-form-urlencoded）
   */
  async postFetch(url, params, signal) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: params.toString(),
      credentials: 'include',
      signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  }

  /**
   * 透過 GET 發送請求（查詢字串）
   */
  async getFetch(url, params, signal) {
    const fullUrl = `${url}?${params.toString()}`;
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'include',
      signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  }

  /**
   * 排入查詢佇列 (支援多級優先度、重複排隊升級與完成回呼)
   * @param {Object} courseData - 課程資訊
   * @param {Function} onResult - 回呼函數
   * @param {number|boolean} priority - 優先級 (1: 手動/目標, 2: 可視範圍, 3: 一般, 4: 低；或 true/false)
   */
  enqueue(courseData, onResult, priority = 3) {
    const { encodeCrsno, crsno, courseId } = courseData;
    const cacheKey = encodeCrsno || crsno || courseId;
    if (!cacheKey) return;

    // 若已有快取且未過期，直接回傳
    const cached = this.getCached(cacheKey);
    if (cached) {
      if (typeof onResult === 'function') {
        onResult(cached);
      }
      return;
    }

    // 優先度轉換 (相容布林值與數字)
    const prio = typeof priority === 'boolean'
      ? (priority ? (this.config.PRIORITY?.MANUAL || 1) : (this.config.PRIORITY?.NORMAL || 3))
      : (Number(priority) || 3);

    // 1. 若佇列中已有該課號排隊，附加回呼並升級優先級 (避免漏掉 task 回呼與重複請求)
    const existingTask = this.queue.find(item => item.cacheKey === cacheKey);
    if (existingTask) {
      if (typeof onResult === 'function') {
        existingTask.callbacks.push(onResult);
      }
      if (prio < existingTask.priority) {
        existingTask.priority = prio;
        this.queue.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
      }
      return;
    }

    // 2. 若該課號正在向伺服器請求中 (in-flight)，附加回呼，等候完成時一併通知
    const inFlightTask = this.activeTasks.get(cacheKey);
    if (inFlightTask) {
      if (typeof onResult === 'function') {
        inFlightTask.callbacks.push(onResult);
      }
      return;
    }

    const task = {
      courseData,
      cacheKey,
      callbacks: typeof onResult === 'function' ? [onResult] : [],
      priority: prio,
      createdAt: Date.now()
    };

    // 依優先級 (升冪) 與 建立時間 排序插入
    this.queue.push(task);
    this.queue.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);

    this.processQueue();
  }

  /**
   * 執行佇列處理器 (受最大並發數與間隔節流保護，依優先序依序取出，支援中斷)
   */
  processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const settings = (this.config && this.config.getSettings)
        ? this.config.getSettings()
        : (this.config ? this.config.DEFAULTS : {});
      const maxConcurrency = (settings && settings.maxConcurrency) || 3;
      const delayMs = (settings && settings.requestDelayMs) || 60;

      while (this.queue.length > 0 && this.activeRequests < maxConcurrency) {
        const task = this.queue.shift();
        this.activeRequests++;
        this.activeTasks.set(task.cacheKey, task);

        const controller = new AbortController();
        this.activeControllers.add(controller);

        this.fetchQuota(task.courseData, controller.signal)
          .then(result => {
            // 若請求已被中斷取消，不寫入快取也不觸發回呼
            if (controller.signal.aborted) return;
            if (result && result.status !== this.config.STATUS.ERROR) {
              this.setCached(task.cacheKey, result);
            }
            task.callbacks.forEach(cb => {
              try {
                cb(result);
              } catch (e) {
                console.error('[NKUST Highlighter] Callback execution error:', e);
              }
            });
          })
          .catch(err => {
            // 若為手動刷新觸發的取消，靜默忽略，不顯示為錯誤也不污染新查詢結果
            if (controller.signal.aborted || (err && (err.name === 'AbortError' || err.message?.includes('aborted')))) {
              return;
            }
            console.warn('[NKUST Highlighter] 取得名額失敗:', task.cacheKey, err);
            const failResult = {
              status: this.config.STATUS.ERROR,
              remaining: null,
              capacity: null,
              enrolled: null,
              error: err.message || '伺服器回應異常或連線中斷'
            };
            task.callbacks.forEach(cb => {
              try {
                cb(failResult);
              } catch (e) {
                console.error('[NKUST Highlighter] Callback error on failure:', e);
              }
            });
          })
          .finally(() => {
            this.activeControllers.delete(controller);
            this.activeTasks.delete(task.cacheKey);
            this.activeRequests = Math.max(0, this.activeRequests - 1);
            // 延遲後繼續處理下一個，防止突發大量請求衝擊校務系統
            setTimeout(() => {
              this.processQueue();
            }, delayMs);
          });
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 核心請求方法：向學校伺服器索取名額 HTML 片段並解析 (支援 signal)
   */
  async fetchQuota(courseData, signal) {
    const { encodeCrsno, courseId, crsno, courseName } = courseData;
    const isLocalFile = window.location.protocol === 'file:';

    // 若為本地測試檔案 (file://)，提供 Mock 測試資料以供視覺檢視
    if (isLocalFile) {
      return this.generateMockOrLocalData(crsno, courseId, courseName);
    }

    const { year, semester } = this.getAcademicYearAndSemester();
    
    // 首選：SimplifiedCourseSelectionInfo (選課人數資訊端點)
    let url = this.config.ENDPOINTS.simplifiedInfo;
    let params = this.buildParams(courseData, { year, semester });

    // 嘗試 POST
    try {
      const html = await this.postFetch(url, params, signal);
      return this.parseQuotaHtml(html);
    } catch (postErr) {
      if ((signal && signal.aborted) || postErr.name === 'AbortError') throw postErr;
      console.warn('[NKUST Highlighter] POST failed, trying GET:', postErr);
      // 嘗試 GET
      try {
        const html = await this.getFetch(url, params, signal);
        return this.parseQuotaHtml(html);
      } catch (getErr) {
        if ((signal && signal.aborted) || getErr.name === 'AbortError') throw getErr;
        console.warn('[NKUST Highlighter] GET also failed, trying fallback courseDetail:', getErr);
        // 備援方案：若 SimplifiedInfo 失敗，嘗試讀取 CourseDetailByAddSelCrs
        if (courseId) {
          return this.fetchCourseDetailFallback(courseId, { year, semester }, signal);
        }
        throw new Error(`Both POST and GET failed: POST ${postErr.message}, GET ${getErr.message}`);
      }
    }
  }

  /**
   * 備援方案：嘗試以 CourseDetailByAddSelCrs 取得課程限修條件 (支援 signal)
   */
  async fetchCourseDetailFallback(courseId, { year, semester }, signal) {
    const url = this.config.ENDPOINTS.courseDetail;
    let params = new URLSearchParams();
    params.append('id', courseId);
    // 也加入學年學期（有些端點可能需要）
    params.append('selSchoolYear', year);
    params.append('selSemester', semester);

    // 嘗試 POST
    try {
      const html = await this.postFetch(url, params, signal);
      return this.parseQuotaHtml(html);
    } catch (postErr) {
      if ((signal && signal.aborted) || postErr.name === 'AbortError') throw postErr;
      console.warn('[NKUST Highlighter] CourseDetail POST failed, trying GET:', postErr);
      // 嘗試 GET
      try {
        const html = await this.getFetch(url, params, signal);
        return this.parseQuotaHtml(html);
      } catch (getErr) {
        if ((signal && signal.aborted) || getErr.name === 'AbortError') throw getErr;
        throw new Error(`CourseDetail both POST and GET failed: POST ${postErr.message}, GET ${getErr.message}`);
      }
    }
  }

  /**
   * 解析回傳的 HTML 片段，嚴謹提取「限修人數」、「保留人數」、「已選上人數」
   */
  parseQuotaHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    let capacity = null;
    let reserved = 0;
    let enrolled = null;
    let remaining = null;

    // 1. 尋找表格中明確標籤 (如 CourseDetailByAddSelCrs 的 <table> 結構)
    const cells = Array.from(doc.querySelectorAll('td, th'));

    for (let i = 0; i < cells.length; i++) {
      const text = cells[i].textContent.trim();

      if (text.includes('限修人數') || text.includes('限修') || text.includes('容量')) {
        const valCell = cells[i].nextElementSibling;
        if (valCell) {
          const num = parseInt(valCell.textContent.trim(), 10);
          if (!isNaN(num)) capacity = num;
        }
      } else if (text.includes('保留人數')) {
        const valCell = cells[i].nextElementSibling;
        if (valCell) {
          const num = parseInt(valCell.textContent.trim(), 10);
          if (!isNaN(num)) reserved = num;
        }
      } else if (text.includes('已選上人數') || text.includes('選上人數') || text.includes('目前人數')) {
        const valCell = cells[i].nextElementSibling;
        if (valCell) {
          const num = parseInt(valCell.textContent.trim(), 10);
          if (!isNaN(num)) enrolled = num;
        }
      } else if (text.includes('剩餘名額') || text.includes('餘額')) {
        const valCell = cells[i].nextElementSibling;
        if (valCell) {
          const num = parseInt(valCell.textContent.trim(), 10);
          if (!isNaN(num)) remaining = num;
        }
      }
    }

    // 2. 尋找 SimplifiedCourseSelectionInfo 的 Bootstrap 格線標籤結構 (如 #selcrsNumDialog: <div class="col-*"><label>...: </label>value</div>)
    const labels = Array.from(doc.querySelectorAll('label'));
    for (const lbl of labels) {
      const labelText = lbl.textContent.trim();
      const parent = lbl.parentElement;
      if (!parent) continue;

      if (labelText.includes('限修人數')) {
        // 取 label 後方的文字節點或數值
        const clone = parent.cloneNode(true);
        const childLabel = clone.querySelector('label');
        if (childLabel) childLabel.remove();
        const num = parseInt(clone.textContent.trim(), 10);
        if (!isNaN(num)) capacity = num;
      } else if (labelText.includes('保留人數')) {
        const clone = parent.cloneNode(true);
        const childLabel = clone.querySelector('label');
        if (childLabel) childLabel.remove();
        const num = parseInt(clone.textContent.trim(), 10);
        if (!isNaN(num)) reserved = num;
      } else if (labelText.includes('已選上人數') || labelText.includes('選上人數') || labelText.includes('目前人數')) {
        // 數字通常在同層的 <span class="badge ...">19</span> 或文字節點中
        const badge = parent.querySelector('.badge') || parent.querySelector('span');
        if (badge) {
          const num = parseInt(badge.textContent.trim(), 10);
          if (!isNaN(num)) enrolled = num;
        } else {
          const clone = parent.cloneNode(true);
          const childLabel = clone.querySelector('label');
          if (childLabel) childLabel.remove();
          const num = parseInt(clone.textContent.trim(), 10);
          if (!isNaN(num)) enrolled = num;
        }
      } else if (labelText.includes('剩餘名額') || labelText.includes('餘額')) {
        const badge = parent.querySelector('.badge') || parent.querySelector('span');
        if (badge) {
          const num = parseInt(badge.textContent.trim(), 10);
          if (!isNaN(num)) remaining = num;
        }
      }
    }

    // 3. 次要備援：使用正則表達式解析 (包含換行與標籤穿透)
    if (capacity === null) {
      const capMatch = html.match(/限修人數[\s\S]*?(?:<\/label>|<\/td>)\s*(?:<td[^>]*>)?\s*(?:<span[^>]*>)?\s*(\d+)/i);
      if (capMatch) capacity = parseInt(capMatch[1], 10);
    }
    if (enrolled === null) {
      const enrolledMatch = html.match(/(?:已選上人數|選上人數|目前人數)[\s\S]*?(?:<\/label>|<\/td>)\s*(?:<td[^>]*>)?\s*(?:<span[^>]*>)?\s*(\d+)/i);
      if (enrolledMatch) enrolled = parseInt(enrolledMatch[1], 10);
    }
    if (reserved === 0) {
      const resMatch = html.match(/保留人數[\s\S]*?(?:<\/label>|<\/td>)\s*(?:<td[^>]*>)?\s*(?:<span[^>]*>)?\s*(\d+)/i);
      if (resMatch) reserved = parseInt(resMatch[1], 10);
    }
    if (remaining === null) {
      const remMatch = html.match(/(?:剩餘名額|餘額)[\s\S]*?(?:<\/label>|<\/td>)\s*(?:<td[^>]*>)?\s*(?:<span[^>]*>)?\s*(\d+)/i);
      if (remMatch) remaining = parseInt(remMatch[1], 10);
    }

    // 4. 合理性驗證與剩餘名額計算 (Sanity Checks)
    if (capacity !== null && (!Number.isFinite(capacity) || capacity < 0)) {
      capacity = null;
    }
    if (enrolled !== null && (!Number.isFinite(enrolled) || enrolled < 0)) {
      enrolled = null;
    }
    if (reserved !== null && (!Number.isFinite(reserved) || reserved < 0)) {
      reserved = 0;
    }
    if (remaining !== null && (!Number.isFinite(remaining) || remaining < 0)) {
      remaining = Math.max(0, remaining);
    }

    // 若未直接取得 remaining，但有容量與已選人數，則計算剩餘名額 (限修人數 - 已選上人數)
    // 注意：不可扣除保留人數，否則限修大於已選上時會被誤判為額滿
    if (remaining === null && capacity !== null && enrolled !== null) {
      remaining = Math.max(0, capacity - enrolled);
    }

    // 5. 嚴謹判斷狀態 (絕不將「解析失敗」誤判為 UNAVAILABLE 不可選)
    const settings = (this.config && this.config.getSettings)
      ? this.config.getSettings()
      : (this.config ? this.config.DEFAULTS : {});
    const threshold = (settings && settings.lowQuotaThreshold) || 5;

    let status = this.config.STATUS.ERROR;
    let parseError = null;

    if (remaining !== null) {
      if (capacity === 0) {
        // 限修人數為 0，確定為不可選/停開
        status = this.config.STATUS.UNAVAILABLE;
      } else if (remaining <= 0) {
        status = this.config.STATUS.FULL;
      } else if (remaining <= threshold) {
        status = this.config.STATUS.LOW;
      } else {
        status = this.config.STATUS.AVAILABLE;
      }
    } else if (html.includes('額滿') || html.includes('已額滿')) {
      status = this.config.STATUS.FULL;
      remaining = 0;
    } else if (html.includes('停開') || html.includes('不開放') || capacity === 0) {
      status = this.config.STATUS.UNAVAILABLE;
    } else {
      // 找不到可信數據，回傳 ERROR 而非 UNAVAILABLE
      status = this.config.STATUS.ERROR;
      parseError = '無法解析名額資訊';
    }

    return {
      capacity,
      reserved,
      enrolled,
      remaining,
      status,
      error: parseError,
      rawHtml: html
    };
  }

  /**
   * 本地測試輔助方法：根據當前 HTML 檔案中的資料或課號模擬不同名額狀態
   * 讓使用者在開發者模式開啟 加選課程.html 或 加選課程1.html 時，能立即檢視效果與真實解析
   */
  generateMockOrLocalData(crsno, courseId, courseName) {
    // 1. 檢查頁面中是否已經有現成的 #selcrsNumDialog (如 加選課程1.html 內嵌的 FPGA專題實習 0314 實體資料)
    const localNumDialog = document.querySelector('#selcrsNumDialog');
    if (localNumDialog && localNumDialog.innerHTML.trim().length > 0) {
      const dialogContent = localNumDialog.innerHTML;
      const isMatch = (crsno === '0314') || 
                      (courseName && dialogContent.includes(courseName)) ||
                      (crsno && dialogContent.includes(crsno));
      if (isMatch) {
        const parsed = this.parseQuotaHtml(dialogContent);
        if (parsed.remaining !== null) {
          return { ...parsed, isMock: false };
        }
      }
    }

    // 2. 檢查頁面中是否已經有現成的 #dataTable1 (如 加選課程.html 內嵌的 程式設計 1843 詳情表格)
    const localDetail = document.querySelector('#courseDialog #dataTable1');
    if (localDetail) {
      const detailHtml = localDetail.outerHTML;
      const isMatch = (crsno === '1843') || 
                      (courseName && detailHtml.includes(courseName)) ||
                      (crsno && detailHtml.includes(crsno));
      if (isMatch) {
        const parsed = this.parseQuotaHtml(detailHtml);
        if (parsed.remaining !== null) {
          return { ...parsed, isMock: false };
        }
      }
    }

    // 3. 根據課號末碼模擬多元名額情境供全方位驗證：
    // 末碼 1, 2, 3 -> 有名額 (綠色，剩餘 > 5)
    // 末碼 4, 5    -> 名額緊繃 (黃/橘色，剩餘 1~5)
    // 末碼 6, 7, 8 -> 額滿 (紅色，剩餘 0)
    // 末碼 9, 0    -> 名額充裕 (綠色，剩餘 15，絕不誤判不可選)
    const lastDigit = parseInt(String(crsno).slice(-1), 10) || 0;
    let capacity = 40;
    let enrolled = 15;
    let reserved = 0;

    if ([1, 2, 3].includes(lastDigit)) {
      capacity = 45;
      enrolled = 20; // 剩餘 25 -> 綠色
    } else if ([4, 5].includes(lastDigit)) {
      capacity = 40;
      enrolled = 38; // 剩餘 2 -> 橘黃色
    } else if ([6, 7, 8].includes(lastDigit)) {
      capacity = 40;
      enrolled = 40; // 剩餘 0 -> 紅色
    } else {
      capacity = 35;
      enrolled = 20; // 剩餘 15 -> 綠色
    }

    const mockSettings = (this.config && this.config.getSettings)
      ? this.config.getSettings()
      : (this.config ? this.config.DEFAULTS : {});
    const mockThreshold = (mockSettings && mockSettings.lowQuotaThreshold) || 5;

    const remaining = Math.max(0, capacity - enrolled);
    let status = this.config.STATUS.AVAILABLE;
    if (remaining <= 0) {
      status = this.config.STATUS.FULL;
    } else if (remaining <= mockThreshold) {
      status = this.config.STATUS.LOW;
    } else {
      status = this.config.STATUS.AVAILABLE;
    }

    return {
      capacity,
      reserved,
      enrolled,
      remaining,
      status,
      isMock: true
    };
  }
}

window.nkustApiService = new NkustApiService();
