/**
 * NKUST Course Quota Highlighter - Configuration Module
 * 集中管理所有 DOM Selectors、API 端點、名額顏色門檻與節流參數。
 * 未來學校若有改版，僅需修改此處的 Selector 或 API 即可。
 */

const NKUST_CONFIG = {
  // DOM 選擇器設定
  SELECTORS: {
    // 課程表格主容器 (Kendo Grid) - 增加對多種可能的 ID 或 Class 的兼容性
    gridContainer: '#courseGrid, .k-grid',
    // 內容滾動區
    gridContent: '#courseGrid .k-grid-content, .k-grid-content',
    // 課程表格主體
    gridTable: '#courseGrid .k-grid-content table.k-grid-table, .k-grid-content table.k-grid-table',
    // 課程資料列 (排除空白行或子項目)
    courseRows: '#courseGrid .k-grid-content table.k-grid-table tbody tr.k-master-row, .k-grid-content table.k-grid-table tbody tr.k-master-row',
    
    // 每一列內部的欄位對應
    cellSelectType: 'td:nth-child(1)', // 隱藏修別
    cellAddButton: 'td:nth-child(2)',  // 加選按鈕
    cellCourseNo: 'td:nth-child(3)',   // 課號 (例如 4361)
    cellCourseName: 'td:nth-child(4)', // 課名 + 人數圖示
    cellCredit: 'td:nth-child(5)',     // 學分
    cellType: 'td:nth-child(6)',       // 開課修別
    cellClass: 'td:nth-child(7)',      // 班級
    cellTime: 'td:nth-child(8)',       // 時間
    cellTeacher: 'td:nth-child(9)',    // 教師
    cellLanguage: 'td:nth-child(10)',  // 語言
    
    // 元素特徵
    courseInfoLink: 'a.courseinfo',
    usersIcon: 'i.selcrsnum',
    addButton: 'button.addbutton',
    pager: '#courseGrid .k-pager, .k-pager',
    
    // 學年期隱藏欄位
    schoolYearInput: '#SchoolYear',
    semesterInput: '#Semester',
    
    // 彈跳視窗對話框
    selcrsNumDialog: '#selcrsNumDialog',
    courseDialog: '#courseDialog'
  },

  // 後端 API 端點
  ENDPOINTS: {
    // 選課人數資訊 API (回傳人數 HTML 片段)
    simplifiedInfo: '/StdSelcrs/CourseInfo/CourseSelectedNum/SimplifiedCourseSelectionInfo',
    // 課程詳細資訊 API (回傳包含限修人數表格的 HTML 片段)
    courseDetail: '/StdSelcrs/CourseInfo/CourseDetail/CourseDetailByAddSelCrs'
  },

  // 狀態與顏色分類門檻
  STATUS: {
    AVAILABLE: 'available',      // 有名額 (綠)
    LOW: 'low',                  // 剩餘名額緊張 (橘黃)
    FULL: 'full',                // 額滿 (紅)
    UNAVAILABLE: 'unavailable',  // 停開/不可選/異常 (灰)
    LOADING: 'loading'           // 查詢中
  },

  // 預設使用者設定
  DEFAULTS: {
    // 剩餘名額少於或等於此數值時顯示橘黃色警告
    lowQuotaThreshold: 5,
    // 查詢模式: 'auto' (自動為整頁排程載入) 或 'hover' (滑鼠移到人數圖示才載入)
    fetchMode: 'auto',
    // 請求間隔 (毫秒)，防止對學校伺服器造成高頻負擔
    requestDelayMs: 120,
    // 最大並發請求數
    maxConcurrency: 2,
    // 頁面重繪的防抖延遲 (毫秒)
    debounceMs: 250
  }
};

// 避免重複定義
if (typeof window !== 'undefined') {
  window.NKUST_CONFIG = NKUST_CONFIG;
}
