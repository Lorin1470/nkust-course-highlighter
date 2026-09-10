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
    
    // 設定參考
    this.config = window.NKUST_CONFIG;
  }

  /**
   * 取得快取的名額資料
   */
  getCached(key) {
    return this.cache.get(key);
  }

  /**
   * 設定快取
   */
  setCached(key, data) {
    this.cache.set(key, {
      ...data,
      timestamp: Date.now()
    });
  }

  /**
   * 清除快取
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * 取得當前學年與學期
   */
  getAcademicYearAndSemester() {
    const yearElem = document.querySelector(this.config.SELECTORS.schoolYearInput);
    const semElem = document.querySelector(this.config.SELECTORS.semesterInput);
    
    const year = yearElem ? yearElem.value : '115';
    const semester = semElem ? semElem.value : '1';
    return { year, semester };
  }

  /**
   * 排入查詢佇列 (支援優先度與完成回呼)
   */
  enqueue(courseData, onResult, isHighPriority = false) {
    const { encodeCrsno, crsno, courseId } = courseData;
    const cacheKey = encodeCrsno || crsno || courseId;

    // 若已有快取，直接回傳
    const cached = this.getCached(cacheKey);
    if (cached) {
      onResult(cached);
      return;
    }

    // 避免佇列中重複排入同一課號
    const exists = this.queue.some(item => item.cacheKey === cacheKey);
    if (exists) return;

    const task = {
      courseData,
      cacheKey,
      onResult,
      retries: 0
    };

    if (isHighPriority) {
      this.queue.unshift(task);
    } else {
      this.queue.push(task);
    }

    this.processQueue();
  }

  /**
   * 執行佇列處理器 (受最大並發數與間隔節流保護)
   */
  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    const maxConcurrency = this.config.DEFAULTS.maxConcurrency;
    const delayMs = this.config.DEFAULTS.requestDelayMs;

    while (this.queue.length > 0 && this.activeRequests < maxConcurrency) {
      const task = this.queue.shift();
      this.activeRequests++;

      this.fetchQuota(task.courseData)
        .then(result => {
          this.setCached(task.cacheKey, result);
          task.onResult(result);
        })
        .catch(err => {
          console.warn('[NKUST Highlighter] 取得名額失敗:', task.cacheKey, err);
          const failResult = {
            status: this.config.STATUS.UNAVAILABLE,
            remaining: null,
            error: err.message
          };
          task.onResult(failResult);
        })
        .finally(() => {
          this.activeRequests--;
          // 延遲後繼續處理下一個，防止突發大量請求
          setTimeout(() => {
            this.isProcessing = false;
            this.processQueue();
          }, delayMs);
        });
    }

    this.isProcessing = false;
  }

  /**
   * 核心請求方法：向學校伺服器索取名額 HTML 片段並解析
   */
  async fetchQuota(courseData) {
    const { encodeCrsno, courseId, crsno, courseName } = courseData;
    const isLocalFile = window.location.protocol === 'file:';

    // 若為本地測試檔案 (file://)，提供 Mock 測試資料以供視覺檢視
    if (isLocalFile) {
      return this.generateMockOrLocalData(crsno, courseId, courseName);
    }

    const { year, semester } = this.getAcademicYearAndSemester();
    
    // 首選：SimplifiedCourseSelectionInfo (選課人數資訊端點)
    let url = this.config.ENDPOINTS.simplifiedInfo;
    let bodyData = new URLSearchParams();
    bodyData.append('selCrsno', encodeCrsno);
    bodyData.append('selSchoolYear', year);
    bodyData.append('selSemester', semester);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: bodyData,
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      return this.parseQuotaHtml(html);
    } catch (err) {
      // 備援方案：若 SimplifiedInfo 失敗，嘗試讀取 CourseDetailByAddSelCrs
      if (courseId) {
        return this.fetchCourseDetailFallback(courseId);
      }
      throw err;
    }
  }

  /**
   * 備援方案：嘗試以 CourseDetailByAddSelCrs 取得課程限修條件
   */
  async fetchCourseDetailFallback(courseId) {
    const url = this.config.ENDPOINTS.courseDetail;
    const bodyData = new URLSearchParams();
    bodyData.append('id', courseId);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: bodyData,
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    return this.parseQuotaHtml(html);
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

    // 4. 計算剩餘名額
    if (remaining === null && capacity !== null && enrolled !== null) {
      remaining = capacity - reserved - enrolled;
    }

    // 5. 判斷狀態
    let status = this.config.STATUS.UNAVAILABLE;
    const threshold = this.config.DEFAULTS.lowQuotaThreshold;

    if (remaining !== null) {
      if (remaining <= 0) {
        status = this.config.STATUS.FULL;
      } else if (remaining <= threshold) {
        status = this.config.STATUS.LOW;
      } else {
        status = this.config.STATUS.AVAILABLE;
      }
    } else if (html.includes('額滿')) {
      status = this.config.STATUS.FULL;
      remaining = 0;
    }

    return {
      capacity,
      reserved,
      enrolled,
      remaining,
      status,
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

    const remaining = Math.max(0, capacity - reserved - enrolled);
    let status = this.config.STATUS.AVAILABLE;
    if (remaining <= 0) {
      status = this.config.STATUS.FULL;
    } else if (remaining <= this.config.DEFAULTS.lowQuotaThreshold) {
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
