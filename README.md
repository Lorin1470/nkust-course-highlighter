# 高科大選課系統「名額顏色提示」瀏覽器插件
![開發中](https://img.shields.io/badge/status-開發中-yellow)
> **NKUST Course Quota Highlighter** (Chrome / Edge Extension - Manifest V3)

本擴充功能專為國立高雄科技大學（NKUST）新版選課系統設計。針對新系統不再直接標記名額狀態、必須逐一點進課程才能確認餘額的痛點，透過安全、非破壞性的方式在課程列表自動還原舊系統的直覺顏色指標與名額標籤，大幅提升選課瀏覽效率。

---

## 視覺提示說明

| 顏色標籤 | 代表狀態 | 判定邏輯 (預設) | 視覺效果 |
| :---: | :---: | :---: | :--- |
| 🟢 **綠色 (Available)** | 剩餘名額充裕 | 剩餘名額 $> 5$ 人 | 左側綠色邊框 (5px)、淡綠背景底色、`[餘 XX]` 徽章 |
| 🟠 **橘黃色 (Low Quota)** | 剩餘名額緊張 | $1 \le \text{剩餘名額} \le 5$ 人 | 左側橘色邊框 (5px)、淡橘背景底色、`[餘 XX]` 徽章 |
| 🔴 **紅色 (Full)** | 名額已額滿 | 剩餘名額 $\le 0$ 人 | 左側紅色邊框 (5px)、淡紅背景底色、`[已額滿]` 徽章 |
| ⚪ **灰色 (Unavailable)** | 停開 / 不可選 | 停開、限修或無名額資訊 | 左側灰色邊框 (5px)、半透明文字、`[不可選]` 徽章 |

> 門檻數值可在擴充功能圖示彈出視窗（Popup）或 `config.js` 中依個人喜好隨時調整。

---

## HTML 與系統架構深度分析報告

針對高科大選課系統 HTML（`加選課程.html`）及其官方 JavaScript（`index.js`、`utilities.js`、`sharedsite.js`）完成之技術架構分析：

### 1. 課程列表與欄位 DOM 結構
* **表格容器**：`#courseGrid`（Kendo UI Grid 元件，`data-role="grid"`）
* **表格主體**：`#courseGrid .k-grid-content table.k-grid-table tbody`
* **課程列**：`tr.k-table-row.k-master-row`（每列具有唯一的 `data-uid` 識別碼）
* **欄位順序與 Selector**：
  * `td:nth-child(1)`：`SelectType`（選課修別，預設被隱藏 `display: none`）
  * `td:nth-child(2)`：`Add`（加選按鈕 `<button class="btn btn-warning addbutton" data-no="4361" data-id="...">Add</button>`）
  * `td:nth-child(3)`：`Crsno`（課號純文字，例如 `4361`）
  * `td:nth-child(4)`：`SubjectName`（課名 `<a class="courseinfo">` + 人數圖示 `<i class="fa fa-users selcrsnum" data-id="...">`）
  * `td:nth-child(5)`：`Credit`（學分）
  * `td:nth-child(6)`：`SelectTypeName`（開課修別：必修/選修）
  * `td:nth-child(7)`：`CourseClassName`（校區標籤與班級名稱）
  * `td:nth-child(8)`：`TimeText`（上課時間節次）
  * `td:nth-child(9)`：`TeacherText`（任課教師）
  * `td:nth-child(10)`：`TeachLanguage`（授課語言）

### 2. 名額資料的真實來源與計算公式
* **目前 HTML 列表中「沒有直接渲染剩餘名額數字」**：
  雖然表頭文字顯示 `課程名稱 選課人數`，但資料列內只有一個小人頭圖示 `<i class="selcrsnum">`，無數字欄位。
* **觸發 API 來源**：
  1. 點擊 `i.selcrsnum` 會呼叫後端 API：
     * **URL**：`/StdSelcrs/CourseInfo/CourseSelectedNum/SimplifiedCourseSelectionInfo`
     * **Method**：`POST`
     * **Payload**：
       ```javascript
       {
           selCrsno: $(this).data('id'), // 即 EncodeCrsno (Base64 加密課號字串)
           selSchoolYear: $('#SchoolYear').val(), // 來自隱藏欄位 (如 "115")
           selSemester: $('#Semester').val()       // 來自隱藏欄位 (如 "1")
       }
       ```
     * **回傳真實結構**（在 `加選課程1.html` 中完整捕獲）：
       ```html
       <div data-url="/StdSelcrs/CourseInfo/CourseSelectedNum/SimplifiedCourseSelectionInfo" id="selcrsNumDialog">
           <div class="row"><span>FPGA專題實習 <span class="text-primary">FPGA Topics Laboratory</span></span></div>
           <hr>
           <div class="row">
               <div class="col-4"><label>限修人數：</label>35</div>
               <div class="col-4"><label>保留人數：</label>0</div>
           </div>
           <div class="row">
               <div class="col-6 d-flex">
                   <label class="">已選上人數：</label><span class="badge bg-danger">19</span>
               </div>
           </div>
       </div>
       ```
       * `限修人數`：以 `<div class="col-4"><label>限修人數：</label>35</div>` 形式呈現。
       * `保留人數`：以 `<div class="col-4"><label>保留人數：</label>0</div>` 形式呈現。
       * `已選上人數`：以 `<span class="badge bg-danger">19</span>` 形式呈現。
  2. 點擊 `a.courseinfo` 會呼叫（備援方案）：
     * **URL**：`/StdSelcrs/CourseInfo/CourseDetail/CourseDetailByAddSelCrs`
     * **Payload**：`{ id: $(this).data('id') }`
     * **回傳**：完整限修條件表格（`加選課程.html` 中的 `#dataTable1`）：
       * `限修人數`（例：38）
       * `保留人數(給新生)`（例：0）
       * `已選上人數`（例：10）
  3. **精確計算公式**：
     $$\text{剩餘名額} = \text{限修人數} - \text{保留人數} - \text{已選上人數}$$
     以 `加選課程1.html` 之 FPGA專題實習為例：$35 - 0 - 19 = 16$（綠色，餘 16）。

### 3. 動態載入監聽機制
* 前端使用 ASP.NET MVC + Kendo UI Grid。
* 搜尋（`#bntSearchCourse` 等）或切換分頁（`#courseGrid .k-pager`）時，Kendo UI 會以 AJAX 重新載入資料並重繪 `tbody`。
* 本插件使用 `MutationObserver` 監聽 `#courseGrid` 的子節點變化，並搭配 **250ms Debounce 防抖**，確保分頁切換時自動重新分析並著色，不遺漏任何動態內容。

---

## 插件安全防護設計

1. **零自動選課 / 搶課操作**：插件僅負責「讀取與顯示」名額，完全不攔截、不修改、不自動送出任何加選按鈕（`.addbutton`）的操作，符合校園規範。
2. **防狂刷與伺服器保護 (Throttling & Queue)**：
   * **最大並發限制**：同時最多僅允許 2 個 API 請求。
   * **間隔延遲**：每次請求之間設有 120ms 的間隔。
   * **可視範圍限制**：僅排程當前頁面（10~20 筆）可見的課程。
   * **記憶快取 (Map)**：同一個學期、同一課號在瀏覽期間絕不重複發送請求。
3. **支援 Hover 即時查詢模式**：
   使用者可在彈出視窗切換為「滑鼠移至圖示才查詢」，將 API 請求量直接降到最低。
4. **非破壞性 UI 注入**：
   僅透過 CSS Class 添加邊框色彩與注入行內小徽章（Badge），不破壞校方原有的響應式與排版結構。

---

## 專案模組架構

```
nkust-course-highlighter/
├── manifest.json       # Manifest V3 設定檔
├── config.js           # 集中管理所有 DOM Selectors、API 端點、閾值
├── api-service.js      # 請求隊列、限速防抖、快取管理與 HTML 解析器
├── ui-highlighter.js   # 顏色樣式標籤注入與 DOM 渲染模組
├── content.js          # 核心協調器與 MutationObserver 動態監聽
├── styles.css          # 高對比度邊框、柔和底色與名額 Badge 樣式
├── popup/              # 擴充功能設定彈跳視窗
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
└── icons/              # 擴充功能圖示 (16x16, 48x48, 128x128 PNG)
```

---

## 安裝步驟 (Chrome / Edge)

### 步驟 1：開啟瀏覽器擴充功能管理頁面
* **Google Chrome**：在網址列輸入 `chrome://extensions` 並按下 Enter。
* **Microsoft Edge**：在網址列輸入 `edge://extensions` 並按下 Enter。

### 步驟 2：開啟「開發者模式」
* 在管理頁面右上角（Edge 在左側），將 **「開發者模式」 (Developer mode)** 開關切換為 **開啟**。

### 步驟 3：載入已解包的擴充功能
1. 點擊左上角的 **「載入未封裝項目」 (Load unpacked)** 按鈕。
2. 在檔案選擇器中，選取本專案的 `nkust-course-highlighter` 資料夾：
   ```
   /Users/kuanggou/Documents/code/NKUST SK/nkust-course-highlighter
   ```
3. 點擊「選取」，即可看到「高科大選課系統名額顏色提示」成功安裝！

> **重要提示 (本地測試必備)**：
> 若要測試本地的 `加選課程.html` 或 `加選課程1.html` 檔案：
> 1. 在擴充功能卡片上點擊 **「詳細資訊」 (Details)**。
> 2. 向下捲動並開啟 **「允許存取檔案網址」 (Allow access to file URLs)** 開關。

---

## 測試與驗證方式

### 方法 A：使用隨附的「加選課程1.html」進行真實 API 結構驗證
1. 在 Chrome 或 Edge 中，開啟已啟用「允許存取檔案網址」的擴充功能。
2. 在網址列輸入或拖入：
   ```
   file:///Users/kuanggou/Documents/code/NKUST SK/加選課程1.html
   ```
3. 觀察頁面效果：
   * 課號 `0314`（FPGA專題實習）會直接由內嵌的 `#selcrsNumDialog` 解析出：
     * 限修 35 人、保留 0 人、已選 19 人 $\rightarrow$ **剩餘 16 人**。
     * 自動呈現 **綠色邊框** 與 **`[餘 16]` 徽章**。
   * 其他課號依末碼呈現不同測試狀態（紅/黃/綠/灰）。

### 方法 B：使用隨附的「加選課程.html」進行備援表格驗證
1. 瀏覽器開啟：
   ```
   file:///Users/kuanggou/Documents/code/NKUST SK/加選課程.html
   ```
2. 課號 `1843`（程式設計(一)）會由內嵌的 `#dataTable1` 限修條件表格解析：
   * 限修 38 人、保留 0 人、已選 10 人 $\rightarrow$ **剩餘 28 人**。
   * 自動呈現 **綠色邊框** 與 **`[餘 28]` 徽章**。

### 方法 C：在高科大實際選課系統上進行線上測試
1. 登入高科大選課系統加選頁面：`https://aais8.nkust.edu.tw/StdSelcrs/AddSelcrs/AddSelcrs/`
2. 進行任何課程查詢（如點擊「課程查詢」或「數位通識」）。
3. 課程表格渲染完成後，插件會自動在背景限速查詢名額，並即時在畫面上呈現綠/黃/紅/灰提示與 `[餘 X]` 徽章。
4. 切換分頁（例如點擊第 2 頁）或重新查詢，確認 MutationObserver 自動偵測並為新頁面加上名額提示。
