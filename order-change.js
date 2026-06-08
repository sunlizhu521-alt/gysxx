const DB_NAME = "supply-chain-library";
const DB_VERSION = 3;
const UPLOAD_STORE_NAME = "uploaded-files";
const DIMENSION_STORE_NAME = "dimension-files";
const FACT_STORE_NAME = "fact-files";
const PURCHASE_ORDER_SLOT = "fact-1";
const ORDER_CHANGE_SLOT = "fact-3";
const MAX_ORDER_CHANGE_SHEET_ROWS = 120000;
const MAX_ORDER_CHANGE_SHEET_COLUMNS = 80;
const BAR_COLORS = ["#2f6fed", "#159a9c", "#6957d6", "#2f9e44", "#d98b11", "#d64545", "#0f766e", "#7c3aed", "#2563eb", "#ea580c"];

const orderChangeEls = {
  filterBar: document.querySelector("#orderChangeFilterBar"),
  nFilter: document.querySelector("#orderChangeNFilter"),
  oFilter: document.querySelector("#orderChangeOFilter"),
  resetButton: document.querySelector("#orderChangeResetButton"),
  nBars: document.querySelector("#orderChangeNBars"),
  oBars: document.querySelector("#orderChangeOBars"),
  rows: document.querySelector("#orderChangeRows"),
  state: document.querySelector("#orderChangeState"),
  sourceNote: document.querySelector("#orderChangeSourceNote"),
};

const orderChangeFilterConfigs = [
  { key: "nValue", element: orderChangeEls.nFilter, label: "全部事业部", field: "nValue" },
  { key: "oValue", element: orderChangeEls.oFilter, label: "全部", field: "oValue" },
];

const orderChangeAliases = {
  itemName: ["物品名称", "物料名称", "商品名称", "存货名称", "产品名称", "品名", "金蝶名称"],
  operationRemark: ["运营备注", "备注", "跟进备注", "订单备注"],
};

const deliveryPriceAliases = {
  sequence: ["序号", "行号", "订单序号"],
  materialCode: ["品号", "物料编码", "商品编码", "存货编码", "产品编码", "货品编号"],
  unitPrice: ["单价", "采购单价", "含税单价", "不含税单价", "价格"],
};

const orderChangeState = {
  records: [],
  filtered: [],
  selectedFilters: Object.fromEntries(orderChangeFilterConfigs.map((config) => [config.key, new Set()])),
};

async function initOrderChangePage() {
  orderChangeFilterConfigs.forEach(renderFilterShell);
  bindOrderChangeEvents();
  await loadOrderChangeData();
}

function bindOrderChangeEvents() {
  orderChangeEls.filterBar.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-filter-toggle]");
    if (toggle) {
      closeOrderChangeFilters(toggle.dataset.filterToggle);
      orderChangeFilterConfigs.find((config) => config.key === toggle.dataset.filterToggle)?.element.classList.toggle("open");
      return;
    }

    const option = event.target.closest("[data-filter-option]");
    if (!option) return;
    event.preventDefault();
    event.stopPropagation();
    toggleFilterOption(option.dataset.filterKey, option.dataset.filterOption);
    applyOrderChangeFilters();
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#orderChangeFilterBar")) closeOrderChangeFilters();
  });

  orderChangeEls.resetButton.addEventListener("click", () => {
    Object.values(orderChangeState.selectedFilters).forEach((set) => set.clear());
    applyOrderChangeFilters();
  });
}

async function loadOrderChangeData() {
  try {
    setOrderChangeMessage("正在读取本地文件库");
    const db = await openAppDb();
    const [orderChangeRecord, purchaseOrderRecord] = await Promise.all([
      getRecord(db, FACT_STORE_NAME, ORDER_CHANGE_SLOT),
      getRecord(db, FACT_STORE_NAME, PURCHASE_ORDER_SLOT),
    ]);
    db.close();

    const appliedOrderChangeRecord = getAppliedLibraryRecord(orderChangeRecord);
    const appliedPurchaseOrderRecord = getAppliedLibraryRecord(purchaseOrderRecord);

    updateSourceNote(orderChangeEls.sourceNote, "数据来源：本地文件库", [
      { name: "订单变更", record: appliedOrderChangeRecord },
      { name: "Fac-采购订单跟进表", record: appliedPurchaseOrderRecord },
    ]);

    if (!appliedOrderChangeRecord?.file || !appliedPurchaseOrderRecord?.file) {
      resetOrderChange("请先在文件库更新上传并确认应用 订单变更 和 Fac-采购订单跟进表");
      return;
    }

    const [orderRows, priceMap] = await Promise.all([
      readOrderChangeWorkbook(appliedOrderChangeRecord.file),
      readDeliveryPriceMap(appliedPurchaseOrderRecord.file),
    ]);

    orderChangeState.records = enrichOrderChangeRows(orderRows, priceMap);
    if (!orderChangeState.records.length) {
      resetOrderChange("已应用的订单变更表暂无可用数据");
      return;
    }
    applyOrderChangeFilters();
  } catch (error) {
    console.error(error);
    resetOrderChange(`订单变更读取失败：${error.message || "请检查已应用文件"}`);
  }
}

function resetOrderChange(message) {
  orderChangeState.records = [];
  orderChangeState.filtered = [];
  updateFilterOptions();
  renderOrderChange(message);
}

async function readOrderChangeWorkbook(file) {
  const sheets = await readAllWorkbookSheets(file);
  return sheets.flatMap(({ sheetName, rows }) => parseOrderChangeSheet(rows, sheetName));
}

function parseOrderChangeSheet(rows, sheetName) {
  const headerIndex = findOrderChangeHeaderIndex(rows);
  const headers = headerIndex >= 0 ? rows[headerIndex].map((cell) => String(cell || "").trim()) : [];
  const headerMap = createAliasHeaderMap(headers, orderChangeAliases);
  return rows
    .slice(headerIndex >= 0 ? headerIndex + 1 : 0)
    .map((row, index) => {
      const sequence = getRowValue(row, 0);
      const materialCode = getRowValue(row, 4);
      const nValue = getRowValue(row, 13) || "未填写";
      const oValue = getRowValue(row, 14) || "未填写";
      const remainingQty = parseNumber(getRowValue(row, 11));
      return {
        id: `${sheetName}-${index}-${sequence}-${materialCode}`,
        sheetName,
        sequence,
        materialCode,
        itemName: getRowValue(row, headerMap.itemName) || getRowValue(row, 5),
        remainingQty,
        nValue,
        oValue,
        operationRemark: getRowValue(row, headerMap.operationRemark),
      };
    })
    .filter((record) => isUsableOrderChangeRecord(record));
}

function findOrderChangeHeaderIndex(rows) {
  return rows.findIndex((row) => {
    const first = normalizeHeader(row[0]);
    const fifth = normalizeHeader(row[4]);
    const twelfth = normalizeHeader(row[11]);
    return first === "序号" || fifth === "品号" || twelfth.includes("未发货数量");
  });
}

function isUsableOrderChangeRecord(record) {
  if (!record.sequence && !record.materialCode && !record.itemName) return false;
  if (normalizeHeader(record.sequence) === "序号" || normalizeHeader(record.materialCode) === "品号") return false;
  return true;
}

async function readDeliveryPriceMap(file) {
  const sheets = await readAllWorkbookSheets(file);
  return sheets.reduce((priceMap, { rows }) => {
    parseDeliveryPriceSheet(rows).forEach((item) => {
      const key = makeCompositeKey(item.sequence, item.materialCode);
      if (!key) return;
      const existing = priceMap.get(key);
      if (!existing || (!existing.unitPrice && item.unitPrice)) priceMap.set(key, item);
    });
    return priceMap;
  }, new Map());
}

function parseDeliveryPriceSheet(rows) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => hasKnownHeader(cell, deliveryPriceAliases)));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((cell) => String(cell || "").trim());
  const dataRows = rows.slice(headerIndex + 1);
  const headerMap = createAliasHeaderMap(headers, deliveryPriceAliases);
  if (headerMap.sequence === undefined || headerMap.materialCode === undefined || headerMap.unitPrice === undefined) return [];

  return dataRows
    .map((row) => ({
      sequence: getRowValue(row, headerMap.sequence),
      materialCode: getRowValue(row, headerMap.materialCode),
      unitPrice: parseNumber(getRowValue(row, headerMap.unitPrice)),
    }))
    .filter((record) => record.sequence && record.materialCode);
}

function enrichOrderChangeRows(rows, priceMap) {
  return rows.map((row) => {
    const matched = priceMap.get(makeCompositeKey(row.sequence, row.materialCode));
    const unitPrice = Number(matched?.unitPrice) || 0;
    return {
      ...row,
      unitPrice,
      stockValue: unitPrice * (Number(row.remainingQty) || 0),
    };
  });
}

function applyOrderChangeFilters(message = "") {
  updateFilterOptions();
  orderChangeState.filtered = message ? [] : filterOrderChangeRows(getFilterValues());
  renderOrderChange(message);
}

function updateFilterOptions() {
  const filters = getFilterValues();
  orderChangeFilterConfigs.forEach((config) => {
    const options = getFilterOptionItems(config, filters);
    syncMultiFilter(config, options);
  });
}

function getFilterOptionItems(config, filters) {
  const rows = filterOrderChangeRows({ ...filters, [config.key]: [] });
  return uniqueValues(rows, config.field).map((value) => ({ value, label: value }));
}

function renderFilterShell(config) {
  config.element.innerHTML = `
    <button class="multi-filter-button" type="button" data-filter-toggle="${config.key}">
      <span>${config.label}</span>
      <i aria-hidden="true">▾</i>
    </button>
    <div class="multi-filter-menu" role="menu"></div>
  `;
}

function syncMultiFilter(config, options) {
  const selectedSet = orderChangeState.selectedFilters[config.key] || new Set();
  const availableValues = new Set(options.map((option) => option.value));
  [...selectedSet].forEach((value) => {
    if (!availableValues.has(value)) selectedSet.delete(value);
  });
  orderChangeState.selectedFilters[config.key] = selectedSet;

  const button = config.element.querySelector(".multi-filter-button span");
  const menu = config.element.querySelector(".multi-filter-menu");
  button.textContent = getFilterButtonLabel(config, selectedSet);
  const optionList = options.length ? options : [{ value: "等待数据", label: "等待数据", disabled: true }];
  menu.innerHTML = `
    <label class="multi-filter-option ${selectedSet.size ? "" : "selected"}" data-filter-key="${config.key}" data-filter-option="all">
      <input type="checkbox" ${selectedSet.size ? "" : "checked"} />
      <span>${escapeHtml(config.label)}</span>
    </label>
    ${optionList
      .map((option) => {
        const disabled = option.disabled || option.value === "等待数据";
        const checked = selectedSet.has(option.value);
        return `
          <label class="multi-filter-option ${checked ? "selected" : ""}" data-filter-key="${config.key}" data-filter-option="${escapeAttribute(option.value)}">
            <input type="checkbox" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />
            <span>${escapeHtml(option.label)}</span>
          </label>`;
      })
      .join("")}
  `;
}

function getFilterButtonLabel(config, selectedSet) {
  const selectedValues = [...(selectedSet || new Set())];
  if (!selectedValues.length) return config.label;
  if (selectedValues.length === 1) return selectedValues[0];
  if (selectedValues.length === 2) return selectedValues.join("、");
  return `已选${selectedValues.length}项`;
}

function toggleFilterOption(key, value) {
  const selectedSet = orderChangeState.selectedFilters[key] || new Set();
  if (value === "等待数据") return;
  if (value === "all") selectedSet.clear();
  else if (selectedSet.has(value)) selectedSet.delete(value);
  else selectedSet.add(value);
  orderChangeState.selectedFilters[key] = selectedSet;
}

function closeOrderChangeFilters(activeKey = "") {
  orderChangeFilterConfigs.forEach((config) => {
    if (config.key !== activeKey) config.element.classList.remove("open");
  });
}

function getFilterValues() {
  return Object.fromEntries(
    orderChangeFilterConfigs.map((config) => [config.key, [...(orderChangeState.selectedFilters[config.key] || new Set())]])
  );
}

function filterOrderChangeRows(filters) {
  return orderChangeState.records.filter(
    (record) => matchesFilter(record.nValue, filters.nValue) && matchesFilter(record.oValue, filters.oValue)
  );
}

function matchesFilter(value, selectedValues = []) {
  return !selectedValues?.length || selectedValues.includes(value);
}

function renderOrderChange(message = "") {
  const rows = orderChangeState.filtered;
  orderChangeEls.state.textContent = message || (rows.length ? `已匹配 ${rows.length} 行` : "暂无匹配数据");
  renderValueBars(orderChangeEls.nBars, rows, "nValue", "暂无事业部库存货值");
  renderValueBars(orderChangeEls.oBars, rows, "oValue", "暂无运营反馈库存货值");

  if (message || !rows.length) {
    orderChangeEls.rows.innerHTML = `<tr><td colspan="6" class="empty-table-cell">${escapeHtml(message || "暂无匹配数据")}</td></tr>`;
    return;
  }

  orderChangeEls.rows.innerHTML = rows.map(renderOrderChangeRow).join("");
}

function renderOrderChangeRow(record) {
  return `
    <tr>
      <td>${escapeHtml(record.nValue || "--")}</td>
      <td>${escapeHtml(record.oValue || "--")}</td>
      <td>${escapeHtml(record.materialCode || "--")}</td>
      <td>${escapeHtml(record.itemName || "--")}</td>
      <td>${formatNumber(record.remainingQty)}</td>
      <td title="${escapeAttribute(record.operationRemark || "")}">${escapeHtml(record.operationRemark || "--")}</td>
    </tr>
  `;
}

function renderValueBars(container, rows, field, emptyText) {
  const groups = rows.reduce((map, record) => {
    const label = record[field] || "未填写";
    map.set(label, (map.get(label) || 0) + (Number(record.stockValue) || 0));
    return map;
  }, new Map());
  const entries = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (!entries.length) {
    container.innerHTML = `<div class="empty-state compact-empty">${escapeHtml(emptyText)}</div>`;
    return;
  }
  const max = Math.max(...entries.map(([, value]) => Math.abs(value)), 1);
  container.innerHTML = entries
    .map(
      ([label, value], index) => `
        <div class="order-change-column" style="--bar-color: ${BAR_COLORS[index % BAR_COLORS.length]}; --bar-height: ${(Math.abs(value) / max) * 100}%">
          <strong title="${formatCurrency(value)}">${formatCurrencyShort(value)}</strong>
          <span class="order-change-column-track"><span class="order-change-column-fill"></span></span>
          <span class="order-change-column-label" title="${escapeAttribute(label)}">${escapeHtml(label)}</span>
        </div>
      `
    )
    .join("");
}

async function readAllWorkbookSheets(file) {
  const fileName = String(file?.name || "");
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "csv") return [{ sheetName: fileName || "CSV", rows: csvToRows(await readFileText(file)) }];
  if (!window.XLSX) throw new Error("XLSX parser is not available.");
  const workbook = await readWorkbook(file, {});
  return workbook.SheetNames.map((sheetName) => ({
    sheetName,
    rows: sheetToRows(workbook.Sheets[sheetName]),
  }));
}

async function readWorkbook(file, options = {}) {
  const commonOptions = {
    type: "array",
    cellNF: false,
    cellHTML: false,
    cellStyles: false,
    cellFormula: false,
    WTF: false,
    ...options,
  };
  try {
    return window.XLSX.read(await readFileArrayBuffer(file), commonOptions);
  } catch (error) {
    if (!isAllocationError(error)) throw error;
    const binary = await readFileBinaryString(file);
    return window.XLSX.read(binary, { ...commonOptions, type: "binary" });
  }
}

function sheetToRows(sheet) {
  if (!sheet) return [];
  return window.XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
    range: getSafeSheetRange(sheet),
  });
}

function getSafeSheetRange(sheet) {
  const rawRange = window.XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
  const maxRow = rawRange.s.r + MAX_ORDER_CHANGE_SHEET_ROWS - 1;
  const maxColumn = rawRange.s.c + MAX_ORDER_CHANGE_SHEET_COLUMNS - 1;
  return {
    s: rawRange.s,
    e: {
      r: Math.min(rawRange.e.r, maxRow),
      c: Math.min(rawRange.e.c, maxColumn),
    },
  };
}

async function readFileArrayBuffer(file) {
  if (file?.arrayBuffer) return file.arrayBuffer();
  if (file instanceof Blob) return file.arrayBuffer();
  throw new Error("文件对象不可读取，请在文件库更新重新上传并确认应用");
}

function readFileBinaryString(file) {
  if (!file) return Promise.reject(new Error("文件对象不可读取，请在文件库更新重新上传并确认应用"));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || "");
    reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
    reader.readAsBinaryString(file);
  });
}

async function readFileText(file) {
  if (file?.text) return file.text();
  if (file instanceof Blob) return file.text();
  throw new Error("文件对象不可读取，请在文件库更新重新上传并确认应用");
}

function isAllocationError(error) {
  return /allocation|array buffer|out of memory|memory/i.test(String(error?.message || error || ""));
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

function hasKnownHeader(value, aliasesByKey) {
  const header = normalizeHeader(value);
  return Object.values(aliasesByKey).some((aliases) => aliases.some((alias) => normalizeHeader(alias) === header));
}

function makeCompositeKey(sequence, materialCode) {
  const seq = normalizeSequence(sequence);
  const code = normalizeMaterialCode(materialCode);
  return seq && code ? `${seq}|${code}` : "";
}

function normalizeSequence(value) {
  return String(value || "")
    .trim()
    .replace(/\.0$/, "");
}

function normalizeMaterialCode(value) {
  return String(value || "")
    .trim()
    .replace(/\.0$/, "")
    .toLowerCase();
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[()（）]/g, "")
    .toLowerCase();
}

function getRowValue(row, index) {
  return index === undefined ? "" : String(row[index] ?? "").trim();
}

function parseNumber(value) {
  const number = Number(String(value || "").replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function uniqueValues(items, key) {
  return [...new Set(items.map((item) => item[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "zh-CN"));
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function formatCurrencyShort(value) {
  const number = Number(value) || 0;
  if (Math.abs(number) >= 100000000) return `${formatNumber(number / 100000000)}亿`;
  if (Math.abs(number) >= 10000) return `${formatNumber(number / 10000)}万`;
  return formatNumber(number);
}

function updateSourceNote(element, label, sourceRecord) {
  if (!element) return;
  if (Array.isArray(sourceRecord)) {
    const parts = sourceRecord.map((item) => {
      const time = getReferenceTime(item.record);
      return `${item.name}：${time ? formatReferenceTime(time) : "--"}`;
    });
    element.textContent = `${label}｜${parts.join("；")}`;
    return;
  }
  const time = getReferenceTime(sourceRecord);
  element.textContent = `${label}｜引用时间：${time ? formatReferenceTime(time) : "--"}`;
}

function getReferenceTime(sourceRecord) {
  return sourceRecord?.appliedAt || sourceRecord?.savedAt || sourceRecord?.generatedAt || "";
}

function formatReferenceTime(value) {
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

function getAppliedLibraryRecord(record) {
  return record?.applied && record?.file ? record : null;
}

function setOrderChangeMessage(message) {
  orderChangeEls.state.textContent = message;
  orderChangeEls.rows.innerHTML = `<tr><td colspan="6" class="empty-table-cell">${escapeHtml(message)}</td></tr>`;
}

function openAppDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      [UPLOAD_STORE_NAME, DIMENSION_STORE_NAME, FACT_STORE_NAME].forEach((storeName) => {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: "id" });
        }
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

function csvToRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
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
  return escapeHtml(value).replace(/"/g, "&quot;");
}

initOrderChangePage().catch((error) => {
  console.error(error);
  setOrderChangeMessage("订单变更异常");
});
