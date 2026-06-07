const DB_NAME = "supply-chain-library";
const DB_VERSION = 3;
const DIMENSION_STORE_NAME = "dimension-files";
const FACT_STORE_NAME = "fact-files";
const CATEGORY_DIMENSION_SLOT = "dimension-1";
const PURCHASE_ASSIGNMENT_SLOT = "dimension-6";
const PURCHASE_ORDER_SLOT = "fact-1";
const CATEGORY_TABLE = "Dim-YL医疗器械商品分类";
const PURCHASE_TABLE = "Dim-采购分工明细";
const SOURCE_LABEL = "数据来源：供应商交付信息 / 信息缺失";

const missingEls = {
  sourceNote: document.querySelector("#missingSourceNote"),
  filterBar: document.querySelector("#missingFilterBar"),
  maintainTableFilter: document.querySelector("#maintainTableFilter"),
  state: document.querySelector("#missingState"),
  rows: document.querySelector("#missingRows"),
  downloadButton: document.querySelector("#missingDownloadButton"),
  materialCount: document.querySelector("#missingMaterialCount"),
  categoryCount: document.querySelector("#missingCategoryCount"),
  purchaseCount: document.querySelector("#missingPurchaseCount"),
  orderRowCount: document.querySelector("#missingOrderRowCount"),
};

const missingState = {
  rows: [],
  filteredRows: [],
  selectedMaintainTables: new Set(),
  message: "",
};

const orderColumnAliases = {
  materialCode: ["品号"],
  sku: ["SKU", "货品编号", "商品编码"],
  itemName: ["物品名称", "物料名称", "商品名称", "存货名称", "产品名称", "金蝶名称", "品名"],
  supplier: ["供应商", "供应商名称", "厂家", "厂商", "供方"],
  remainingQty: ["未发货数量", "剩余数量"],
};

const purchaseAssignmentAliases = {
  materialCode: ["物料编码", "品号", "商品编码", "存货编码", "产品编码"],
  supplier: ["供应商", "供应商名称", "厂家", "厂商", "供方"],
  supplierShort: ["供应商简称", "简称", "供应商简名"],
  orderUser: ["采购下单人"],
};

async function initMissingDashboard() {
  renderFilterShell();
  missingEls.filterBar.addEventListener("click", handleFilterBarClick);
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#missingFilterBar")) missingEls.maintainTableFilter.classList.remove("open");
  });
  missingEls.downloadButton.addEventListener("click", downloadMissingRows);
  await loadMissingData();
}

async function loadMissingData() {
  try {
    const db = await openAppDb();
    const [factRecord, categoryRecord, purchaseRecord] = await Promise.all([
      getRecord(db, FACT_STORE_NAME, PURCHASE_ORDER_SLOT),
      getRecord(db, DIMENSION_STORE_NAME, CATEGORY_DIMENSION_SLOT),
      getRecord(db, DIMENSION_STORE_NAME, PURCHASE_ASSIGNMENT_SLOT),
    ]);
    db.close();

    const appliedFact = getAppliedLibraryRecord(factRecord);
    const appliedCategory = getAppliedLibraryRecord(categoryRecord);
    const appliedPurchase = getAppliedLibraryRecord(purchaseRecord);

    if (!appliedFact?.file) {
      renderMissing([], "请先在文件库更新上传并确认应用 Fac-采购订单跟进表");
      return;
    }

    const orderRows = await readPurchaseOrderWorkbook(appliedFact.file);
    const categoryMap = appliedCategory?.file ? await readCategoryDimension(appliedCategory.file) : new Map();
    const purchaseMap = appliedPurchase?.file ? await readPurchaseAssignment(appliedPurchase.file) : new Map();
    updateSourceNote(appliedFact, appliedCategory, appliedPurchase);
    renderMissing(buildMissingRows(orderRows, categoryMap, purchaseMap));
  } catch (error) {
    console.error(error);
    renderMissing([], "信息缺失读取失败");
  }
}

function buildMissingRows(orderRows, categoryMap, purchaseMap) {
  const grouped = new Map();
  orderRows.forEach((row) => {
    const materialKey = normalizeMaterialCode(row.materialCode);
    if (!materialKey) return;
    const rowKey = [materialKey, row.supplier, row.sku].map((value) => String(value || "").trim()).join("||");
    if (!grouped.has(rowKey)) {
      grouped.set(rowKey, {
        materialCode: row.materialCode,
        sku: row.sku,
        itemName: row.itemName,
        rowCount: 0,
        supplier: row.supplier,
        remainingQty: 0,
        hasRemainingQty: false,
        maintainTables: new Set(),
      });
    }
    const item = grouped.get(rowKey);
    item.sku ||= row.sku;
    item.itemName ||= row.itemName;
    item.supplier ||= row.supplier;
    item.rowCount += 1;
    item.remainingQty += Number(row.remainingQty) || 0;
    item.hasRemainingQty = item.hasRemainingQty || Number(row.remainingQty) > 0;
  });

  grouped.forEach((item) => {
    const key = normalizeMaterialCode(item.materialCode);
    const category = categoryMap.get(key);
    const purchase = purchaseMap.get(key);
    const deliveryFilterBlockedByCategory = !category?.salesLine || !category?.salesSeries || !category?.purchaseGroup;
    const purchaseAssignmentMissing = !purchase && item.hasRemainingQty;

    if (deliveryFilterBlockedByCategory) item.maintainTables.add(CATEGORY_TABLE);
    if (purchaseAssignmentMissing) item.maintainTables.add(PURCHASE_TABLE);

    item.itemName = category?.itemName || item.itemName;
    item.maintainTables = [...item.maintainTables];
  });

  return [...grouped.values()]
    .filter((item) => item.maintainTables.length)
    .sort((a, b) => b.rowCount - a.rowCount || String(a.materialCode).localeCompare(String(b.materialCode), "zh-CN"));
}

async function readCategoryDimension(file) {
  const rows = await readWorkbookRows(file, "Dim-YL医疗器械商品分类");
  const map = new Map();
  rows.slice(1).forEach((row) => {
    const materialCode = normalizeMaterialCode(row[0]);
    if (!materialCode) return;
    map.set(materialCode, {
      itemName: String(row[3] ?? "").trim(),
      salesLine: String(row[6] ?? "").trim(),
      salesSeries: String(row[7] ?? "").trim(),
      purchaseGroup: String(row[20] ?? "").trim(),
    });
  });
  return map;
}

async function readPurchaseAssignment(file) {
  const rows = await readWorkbookRows(file, "产品线明细");
  const headerIndex = rows.findIndex((row) => row.some((cell) => hasKnownPurchaseAssignmentHeader(cell)));
  if (headerIndex < 0) return new Map();
  const headerMap = createAliasHeaderMap(rows[headerIndex].map((cell) => String(cell || "").trim()), purchaseAssignmentAliases);
  const map = new Map();
  rows.slice(headerIndex + 1).forEach((row) => {
    const materialCode = normalizeMaterialCode(getRowValue(row, headerMap.materialCode));
    if (!materialCode) return;
    map.set(materialCode, {
      supplier: getRowValue(row, headerMap.supplier),
      supplierShort: getRowValue(row, headerMap.supplierShort),
      orderUser: getRowValue(row, headerMap.orderUser),
    });
  });
  return map;
}

async function readPurchaseOrderWorkbook(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") return parsePurchaseOrderSheet(csvToRows(await file.text()));
  if (!window.XLSX) throw new Error("XLSX parser is not available.");
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
  return workbook.SheetNames.flatMap((sheetName) => {
    const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
    return parsePurchaseOrderSheet(rows);
  });
}

function parsePurchaseOrderSheet(rows) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => hasKnownHeader(cell)));
  if (headerIndex < 0) return [];
  const dataRows = rows.slice(headerIndex + 1);
  const headerMap = createHeaderMap(rows[headerIndex].map((cell) => String(cell || "").trim()), dataRows);
  if (headerMap.materialCode === undefined) return [];
  return dataRows
    .map((row) => ({
      materialCode: getRowValue(row, headerMap.materialCode),
      sku: getRowValue(row, headerMap.sku),
      itemName: getRowValue(row, headerMap.itemName),
      supplier: getRowValue(row, headerMap.supplier),
      remainingQty: parseNumber(getRowValue(row, headerMap.remainingQty)),
    }))
    .filter((row) => row.materialCode || row.itemName);
}

async function readWorkbookRows(file, preferredSheetName = "") {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") return csvToRows(await file.text());
  if (!window.XLSX) throw new Error("XLSX parser is not available.");
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheetName = workbook.SheetNames.find((name) => preferredSheetName && name.includes(preferredSheetName)) || workbook.SheetNames[0];
  return window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
}

function renderFilterShell() {
  missingEls.maintainTableFilter.innerHTML = `
    <button class="multi-filter-button" type="button" data-filter-toggle="maintainTable">
      <span>全部建议维护表</span>
      <i aria-hidden="true">\u25be</i>
    </button>
    <div class="multi-filter-menu" role="menu"></div>
  `;
}

function handleFilterBarClick(event) {
  const toggle = event.target.closest("[data-filter-toggle]");
  if (toggle) {
    missingEls.maintainTableFilter.classList.toggle("open");
    return;
  }
  const option = event.target.closest("[data-filter-option]");
  if (!option) return;
  const value = option.dataset.filterOption;
  if (value === "all") {
    missingState.selectedMaintainTables.clear();
  } else if (missingState.selectedMaintainTables.has(value)) {
    missingState.selectedMaintainTables.delete(value);
  } else {
    missingState.selectedMaintainTables.add(value);
  }
  applyMissingFilters();
}

function updateMaintainTableFilter() {
  const allowedOptions = [CATEGORY_TABLE, PURCHASE_TABLE].filter((table) => missingState.rows.some((row) => row.maintainTables.includes(table)));
  [...missingState.selectedMaintainTables].forEach((value) => {
    if (!allowedOptions.includes(value)) missingState.selectedMaintainTables.delete(value);
  });
  const selectedValues = [...missingState.selectedMaintainTables];
  const button = missingEls.maintainTableFilter.querySelector(".multi-filter-button span");
  const menu = missingEls.maintainTableFilter.querySelector(".multi-filter-menu");
  button.textContent = getFilterButtonLabel(selectedValues);
  menu.innerHTML = `
    <label class="multi-filter-option ${selectedValues.length ? "" : "selected"}" data-filter-option="all">
      <input type="checkbox" ${selectedValues.length ? "" : "checked"} />
      <span>全部建议维护表</span>
    </label>
    ${allowedOptions
      .map(
        (value) => `
          <label class="multi-filter-option ${missingState.selectedMaintainTables.has(value) ? "selected" : ""}" data-filter-option="${escapeAttribute(value)}">
            <input type="checkbox" ${missingState.selectedMaintainTables.has(value) ? "checked" : ""} />
            <span>${escapeHtml(value)}</span>
          </label>`
      )
      .join("")}
  `;
}

function getFilterButtonLabel(selectedValues) {
  if (!selectedValues.length) return "全部建议维护表";
  if (selectedValues.length === 1) return selectedValues[0];
  if (selectedValues.length === 2) return selectedValues.join("、");
  return `已选${selectedValues.length}项`;
}

function renderMissing(rows, message = "") {
  missingState.rows = rows;
  missingState.message = message;
  applyMissingFilters();
}

function applyMissingFilters() {
  updateMaintainTableFilter();
  const selectedTables = [...missingState.selectedMaintainTables];
  missingState.filteredRows = selectedTables.length
    ? missingState.rows.filter((row) => selectedTables.some((table) => row.maintainTables.includes(table)))
    : [...missingState.rows];
  renderMissingView();
}

function renderMissingView() {
  const rows = missingState.filteredRows;
  const message = missingState.message;
  missingEls.materialCount.textContent = formatNumber(rows.length);
  missingEls.categoryCount.textContent = formatNumber(rows.filter((row) => row.maintainTables.includes(CATEGORY_TABLE)).length);
  missingEls.purchaseCount.textContent = formatNumber(rows.filter((row) => row.maintainTables.includes(PURCHASE_TABLE)).length);
  missingEls.orderRowCount.textContent = formatNumber(sumBy(rows, "rowCount"));
  missingEls.state.textContent = message || (rows.length ? `待维护 ${rows.length} 个物料` : "暂无缺失");
  missingEls.downloadButton.disabled = Boolean(message) || !rows.length;
  missingEls.rows.innerHTML = rows.length
    ? rows.map(renderMissingRow).join("")
    : `<tr><td colspan="4" class="empty-table-cell">${escapeHtml(message || "暂无缺失")}</td></tr>`;
}

function renderMissingRow(row) {
  return `
    <tr>
      <td>${escapeHtml(row.supplier || "--")}</td>
      <td>${escapeHtml(row.materialCode || "--")}</td>
      <td>${escapeHtml(row.sku || "--")}</td>
      <td>${escapeHtml(row.itemName || "--")}</td>
    </tr>
  `;
}

function downloadMissingRows() {
  if (!missingState.filteredRows.length || !window.XLSX) return;
  const exportRows = missingState.filteredRows.map((row) => ({
    供应商: row.supplier || "",
    物料编码: row.materialCode || "",
    SKU: row.sku || "",
    物品名称: row.itemName || "",
  }));
  const worksheet = window.XLSX.utils.json_to_sheet(exportRows);
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, "信息缺失");
  window.XLSX.writeFile(workbook, `信息缺失_${formatDateForFileName(new Date())}.xlsx`);
}

function updateSourceNote(factRecord, categoryRecord, purchaseRecord) {
  const parts = [
    `Fac-采购订单跟进表：${formatAppliedTime(factRecord)}`,
    `${CATEGORY_TABLE}：${formatAppliedTime(categoryRecord)}`,
    `${PURCHASE_TABLE}：${formatAppliedTime(purchaseRecord)}`,
  ];
  missingEls.sourceNote.textContent = `${SOURCE_LABEL}｜${parts.join("；")}`;
}

function formatAppliedTime(record) {
  const time = record?.appliedAt || record?.savedAt || "";
  return time ? formatDateTime(time) : "--";
}

function createHeaderMap(headers, dataRows = []) {
  const headerMap = createAliasHeaderMap(headers, orderColumnAliases);
  if (headerMap.materialCode === undefined) {
    const inferredColumn = inferMaterialCodeColumn(headers, dataRows, new Set(Object.values(headerMap)));
    if (inferredColumn !== undefined) headerMap.materialCode = inferredColumn;
  }
  return headerMap;
}

function createAliasHeaderMap(headers, aliasesByKey) {
  return Object.fromEntries(
    Object.entries(aliasesByKey)
      .map(([key, aliases]) => {
        const index = headers.findIndex((header) => aliases.some((alias) => normalizeHeader(header) === normalizeHeader(alias)));
        return [key, index >= 0 ? index : undefined];
      })
      .filter(([, index]) => index !== undefined)
  );
}

function hasKnownHeader(value) {
  const header = normalizeHeader(value);
  return Object.values(orderColumnAliases).some((aliases) => aliases.some((alias) => normalizeHeader(alias) === header));
}

function hasKnownPurchaseAssignmentHeader(value) {
  const header = normalizeHeader(value);
  return Object.values(purchaseAssignmentAliases).some((aliases) => aliases.some((alias) => normalizeHeader(alias) === header));
}

function inferMaterialCodeColumn(headers, dataRows, usedColumns) {
  const blankColumns = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header, index }) => !usedColumns.has(index) && !String(header || "").trim())
    .map(({ index }) => index);
  const candidates = blankColumns.length ? blankColumns : headers.map((_, index) => index).filter((index) => !usedColumns.has(index));
  let bestColumn;
  let bestScore = 0;
  candidates.forEach((column) => {
    const score = dataRows.slice(0, 50).reduce((sum, row) => sum + scoreMaterialCodeCell(row[column]), 0);
    if (score > bestScore) {
      bestColumn = column;
      bestScore = score;
    }
  });
  return bestScore >= 3 ? bestColumn : undefined;
}

function scoreMaterialCodeCell(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const normalized = normalizeMaterialCode(raw);
  if (normalized.length < 4 || /[\u4e00-\u9fff]/.test(normalized)) return 0;
  let score = 1;
  if (/\d/.test(normalized)) score += 2;
  if (/^[a-z0-9._-]+$/i.test(normalized)) score += 1;
  return score;
}

function openAppDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      [DIMENSION_STORE_NAME, FACT_STORE_NAME].forEach((storeName) => {
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: "id" });
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getRecord(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

function getAppliedLibraryRecord(record) {
  return record?.applied && record?.file ? record : null;
}

function getRowValue(row, index) {
  return index === undefined ? "" : String(row[index] ?? "").trim();
}

function csvToRows(text) {
  return text.split(/\r?\n/).filter(Boolean).map((line) => line.split(",").map((cell) => cell.trim()));
}

function normalizeHeader(value) {
  return String(value || "").trim().replace(/\s+/g, "").replace(/[()（）]/g, "").toLowerCase();
}

function normalizeMaterialCode(value) {
  return String(value || "").trim().replace(/\.0$/, "").toLowerCase();
}

function parseNumber(value) {
  const number = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function sumBy(items, key) {
  return items.reduce((sum, item) => sum + (Number(item[key]) || 0), 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDateForFileName(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

initMissingDashboard();
