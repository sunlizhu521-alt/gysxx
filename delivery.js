const DB_NAME = "supply-chain-library";
const DB_VERSION = 3;
const UPLOAD_STORE_NAME = "uploaded-files";
const DIMENSION_STORE_NAME = "dimension-files";
const FACT_STORE_NAME = "fact-files";
const CATEGORY_DIMENSION_SLOT = "dimension-1";
const PURCHASE_ASSIGNMENT_SLOT = "dimension-6";
const PURCHASE_ORDER_SLOT = "fact-1";
const DELIVERY_SOURCE_LABEL = "\u6570\u636e\u6765\u6e90\uff1a\u5907\u8d27\u4e8b\u5b9e\u8868\u5e93 / \u91c7\u8d2d\u8ba2\u5355\u8ddf\u8fdb\u8868";
const PURCHASE_GROUP_ORDER = ["采购一组", "采购二组", "采购三组", "采购四组", "其他/配件", "未匹配"];

const deliveryState = {
  records: [],
  filtered: [],
  categoryMap: new Map(),
  categoryPurchaseGroups: [],
  purchaseDetailMap: new Map(),
  selectedFilters: {},
};

const deliveryEls = {
  filterBar: document.querySelector("#deliveryFilterBar"),
  businessUnitFilter: document.querySelector("#businessUnitFilter"),
  purchaseGroupFilter: document.querySelector("#purchaseGroupFilter"),
  salesLineFilter: document.querySelector("#salesLineFilter"),
  salesSeriesFilter: document.querySelector("#salesSeriesFilter"),
  supplierShortFilter: document.querySelector("#supplierShortFilter"),
  orderUserFilter: document.querySelector("#orderUserFilter"),
  dateFilter: document.querySelector("#dateFilter"),
  stockAgeFilter: document.querySelector("#stockAgeFilter"),
  resetButton: document.querySelector("#deliveryResetButton"),
  downloadButton: document.querySelector("#deliveryDownloadButton"),
  orderedQty: document.querySelector("#orderedQty"),
  shippedQty: document.querySelector("#shippedQty"),
  remainingQty: document.querySelector("#remainingQty"),
  over60Qty: document.querySelector("#over60Qty"),
  rows: document.querySelector("#deliveryRows"),
  state: document.querySelector("#deliveryState"),
  sourceNote: document.querySelector("#deliverySourceNote"),
};

const deliveryFilterConfigs = [
  { key: "businessUnit", element: deliveryEls.businessUnitFilter, label: "\u5168\u90e8\u4e8b\u4e1a\u90e8", field: "businessUnit" },
  { key: "purchaseGroup", element: deliveryEls.purchaseGroupFilter, label: "\u5168\u90e8\u91c7\u8d2d\u5206\u7ec4", field: "purchaseGroup", sort: sortPurchaseGroups },
  { key: "salesLine", element: deliveryEls.salesLineFilter, label: "\u5168\u90e8\u9500\u552e\u4ea7\u54c1\u7ebf", field: "salesLine" },
  { key: "salesSeries", element: deliveryEls.salesSeriesFilter, label: "\u5168\u90e8\u9500\u552e\u7cfb\u5217", field: "salesSeries" },
  { key: "supplierShort", element: deliveryEls.supplierShortFilter, label: "\u5168\u90e8\u4f9b\u5e94\u5546\u7b80\u79f0", field: "supplierShort" },
  { key: "orderUser", element: deliveryEls.orderUserFilter, label: "\u5168\u90e8\u91c7\u8d2d\u4e0b\u5355\u4eba", field: "orderUser" },
  { key: "dateRange", element: deliveryEls.dateFilter, label: "\u5168\u90e8\u65f6\u95f4", field: null, staticOptions: [] },
  {
    key: "stockAge",
    element: deliveryEls.stockAgeFilter,
    label: "\u5168\u90e8\u5e93\u9f84",
    field: null,
    staticOptions: [
      { value: "over60", label: "\u8d8560\u5929" },
      { value: "notOver60", label: "\u672a\u8d8560\u5929" },
    ],
  },
];

const columnAliases = {
  materialCode: ["品号"],
  sku: ["SKU", "sku", "领星SKU"],
  itemName: ["物品名称", "物料名称", "商品名称", "存货名称", "产品名称", "金蝶名称", "品名"],
  orderedQty: ["下单数量-备货需求-OA申请为准"],
  shippedQty: ["发货数量"],
  remainingQty: ["未发货数量"],
  completedQty: ["生产完成数量"],
  stockAge: ["库龄＞60", "库龄>60", "库龄"],
};

const purchaseDetailAliases = {
  materialCode: ["物料编码", "品号", "商品编码", "存货编码", "产品编码"],
  supplier: ["供应商", "供应商名称", "厂家", "厂商", "供方"],
  supplierShort: ["供应商简称", "简称", "供应商简名"],
  orderUser: ["采购下单人"],
};

const purchaseOrderRequiredColumns = ["materialCode", "orderedQty", "completedQty", "shippedQty", "remainingQty"];

async function initDeliveryDashboard() {
  bindDeliveryEvents();
  if (await loadDeliverySource({ silent: true })) {
    return;
  }
  await loadDeliverySource();
}

function bindDeliveryEvents() {
  deliveryFilterConfigs.forEach((config) => {
    deliveryState.selectedFilters[config.key] = new Set();
    renderFilterShell(config);
  });

  deliveryEls.filterBar.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-filter-toggle]");
    if (toggle) {
      const key = toggle.dataset.filterToggle;
      closeOtherFilterMenus(key);
      deliveryFilterConfigs.find((config) => config.key === key)?.element.classList.toggle("open");
      return;
    }

    const option = event.target.closest("[data-filter-option]");
    if (option) {
      event.preventDefault();
      event.stopPropagation();
      toggleFilterOption(option.dataset.filterKey, option.dataset.filterOption);
      applyDeliveryFilters();
    }
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#deliveryFilterBar")) {
      closeOtherFilterMenus();
    }
  });

  deliveryEls.resetButton.addEventListener("click", () => {
    deliveryFilterConfigs.forEach((config) => deliveryState.selectedFilters[config.key].clear());
    applyDeliveryFilters();
  });

  deliveryEls.downloadButton.addEventListener("click", downloadDeliveryDetails);
}

async function loadDeliverySource(options = {}) {
  try {
    const db = await openAppDb();
    const [factRecord, categoryRecord, purchaseAssignmentRecord] = await Promise.all([
      getRecord(db, FACT_STORE_NAME, PURCHASE_ORDER_SLOT),
      getRecord(db, DIMENSION_STORE_NAME, CATEGORY_DIMENSION_SLOT),
      getRecord(db, DIMENSION_STORE_NAME, PURCHASE_ASSIGNMENT_SLOT),
    ]);
    db.close();
    const appliedFactRecord = getAppliedLibraryRecord(factRecord);
    const appliedCategoryRecord = getAppliedLibraryRecord(categoryRecord);
    const appliedPurchaseAssignmentRecord = getAppliedLibraryRecord(purchaseAssignmentRecord);

    if (!appliedFactRecord?.file) {
      if (options.silent) return false;
      resetDelivery("\u8bf7\u5148\u5728\u5907\u8d27\u4e8b\u5b9e\u8868\u5e93\u4e0a\u4f20\u5e76\u786e\u8ba4\u5e94\u7528\u91c7\u8d2d\u8ba2\u5355\u8ddf\u8fdb\u8868");
      return false;
    }

    const categoryResult = appliedCategoryRecord?.file ? await readCategoryDimension(appliedCategoryRecord.file) : createEmptyCategoryResult();
    deliveryState.categoryMap = categoryResult.map;
    deliveryState.categoryPurchaseGroups = categoryResult.purchaseGroups;
    deliveryState.purchaseDetailMap = appliedPurchaseAssignmentRecord?.file ? await readPurchaseDetailMap(appliedPurchaseAssignmentRecord.file) : new Map();
    const records = enrichDeliveryRecords(await readDeliveryWorkbook(appliedFactRecord.file), deliveryState.categoryMap, deliveryState.purchaseDetailMap);
    if (!records.length) {
      if (options.silent) return false;
      resetDelivery("\u5df2\u5e94\u7528\u7684\u91c7\u8d2d\u8ba2\u5355\u8ddf\u8fdb\u8868\u65e0\u53ef\u7528\u6570\u636e");
      return false;
    }
    deliveryState.records = records;
    updateSourceNote(deliveryEls.sourceNote, "数据来源：本地文件库", [
      { name: "Fac-采购订单跟进表", record: appliedFactRecord },
      { name: "Dim-YL医疗器械商品分类", record: appliedCategoryRecord },
      { name: "Dim-采购分工明细", record: appliedPurchaseAssignmentRecord },
    ]);
    applyDeliveryFilters();
    return true;
  } catch (error) {
    console.error(error);
    if (options.silent) return false;
    resetDelivery("\u4f9b\u5e94\u5546\u4ea4\u4ed8\u4fe1\u606f\u8bfb\u53d6\u5931\u8d25");
    return false;
  }
}

function getAppliedLibraryRecord(record) {
  return record?.applied && record?.file ? record : null;
}

function resetDelivery(message) {
  deliveryState.records = [];
  deliveryState.filtered = [];
  deliveryState.purchaseDetailMap = new Map();
  deliveryState.categoryMap = new Map();
  deliveryState.categoryPurchaseGroups = [];
  updateSourceNote(deliveryEls.sourceNote, DELIVERY_SOURCE_LABEL, null);
  updateFilterOptions();
  renderDelivery(message);
}

async function readCategoryDimension(file) {
  const rows = await readWorkbookRows(file, "Dim-YL医疗器械商品分类");
  const map = new Map();
  const purchaseGroups = new Set();
  rows.forEach((row) => {
    const materialCode = normalizeMaterialCode(row[0]);
    const purchaseGroup = String(row[21] ?? "").trim();
    if (purchaseGroup && purchaseGroup !== "采购分组") purchaseGroups.add(purchaseGroup);
    if (!materialCode || materialCode === "物料编码" || materialCode === "商品编码") return;
    map.set(materialCode, {
      salesLine: String(row[6] ?? "").trim(),
      salesSeries: String(row[7] ?? "").trim(),
      purchaseGroup,
    });
  });
  return {
    map,
    purchaseGroups: sortPurchaseGroups([...purchaseGroups]),
  };
}

function createEmptyCategoryResult() {
  return {
    map: new Map(),
    purchaseGroups: [],
  };
}

async function readPurchaseDetailMap(file) {
  const rows = await readWorkbookRows(file, "\u4ea7\u54c1\u7ebf\u660e\u7ec6");
  const headerIndex = rows.findIndex((row) => row.some((cell) => hasKnownPurchaseDetailHeader(cell)));
  if (headerIndex < 0) return new Map();
  const headerMap = createAliasHeaderMap(rows[headerIndex].map((cell) => String(cell || "").trim()), purchaseDetailAliases);
  const map = new Map();
  rows.slice(headerIndex + 1).forEach((row) => {
    const materialCode = normalizeMaterialCode(getRowValue(row, headerMap.materialCode));
    if (!materialCode) return;
    const supplier = getRowValue(row, headerMap.supplier);
    map.set(materialCode, {
      supplier,
      supplierShort: getRowValue(row, headerMap.supplierShort) || supplier,
      orderUser: getRowValue(row, headerMap.orderUser) || "\u672a\u7ef4\u62a4",
    });
  });
  return map;
}

async function readDeliveryWorkbook(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") {
    return parsePurchaseOrderSheet(csvToRows(await file.text()), "未匹配");
  }
  if (!window.XLSX) {
    throw new Error("XLSX parser is not available.");
  }
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
  return workbook.SheetNames.flatMap((sheetName) => {
    const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
    return parsePurchaseOrderSheet(rows, getBusinessUnitFromSheetName(sheetName));
  });
}

async function readWorkbookRows(file, preferredSheetName = "") {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") {
    return csvToRows(await file.text());
  }
  if (!window.XLSX) {
    throw new Error("XLSX parser is not available.");
  }
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheetName = workbook.SheetNames.find((name) => preferredSheetName && name.includes(preferredSheetName)) || workbook.SheetNames[0];
  return window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
}

function getBusinessUnitFromSheetName(sheetName) {
  const name = String(sheetName || "").trim();
  return name.replace(/[（(].*?[）)]/g, "").trim() || name || "未匹配";
}

function parsePurchaseOrderSheet(rows, businessUnit) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => hasKnownHeader(cell)));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((cell) => String(cell || "").trim());
  const dataRows = rows.slice(headerIndex + 1);
  const headerMap = createHeaderMap(headers, dataRows);
  if (!isPurchaseOrderSheet(headerMap)) return [];

  return dataRows
    .map((row, index) => normalizeRow(row, headerMap, index, businessUnit))
    .filter((record) => record.materialCode || record.sku || record.itemName);
}

function isPurchaseOrderSheet(headerMap) {
  return purchaseOrderRequiredColumns.every((key) => headerMap[key] !== undefined);
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

function normalizeRow(row, headerMap, index, businessUnit) {
  const getValue = (key, fallbackIndex) => {
    const columnIndex = headerMap[key] ?? fallbackIndex;
    return columnIndex === undefined ? "" : String(row[columnIndex] ?? "").trim();
  };
  const orderedQty = parseNumber(getValue("orderedQty"));
  const shippedQty = parseNumber(getValue("shippedQty"));
  const remainingQty = parseNumber(getValue("remainingQty"));
  const completedQty = parseNumber(getValue("completedQty"));
  const stockAgeValue = getValue("stockAge");

  return {
    id: `${businessUnit}-${index}-${getValue("materialCode")}-${getValue("sku")}`,
    businessUnit,
    materialCode: getValue("materialCode"),
    sku: getValue("sku"),
    itemName: getValue("itemName"),
    orderedQty,
    shippedQty,
    completedQty,
    undeliveredQty: remainingQty,
    remainingQty,
    isOver60: isStockAgeOver60(stockAgeValue),
  };
}

function enrichDeliveryRecords(records, categoryMap, purchaseDetailMap = new Map()) {
  return records.map((record) => {
    const materialCode = normalizeMaterialCode(record.materialCode);
    const matched = categoryMap.get(materialCode);
    const detail = purchaseDetailMap.get(materialCode);
    return {
      ...record,
      salesLine: matched?.salesLine || record.salesLine || "\u672a\u5339\u914d",
      salesSeries: matched?.salesSeries || record.salesSeries || "\u672a\u5339\u914d",
      purchaseGroup: matched?.purchaseGroup || record.purchaseGroup || "\u672a\u5339\u914d",
      supplier: detail?.supplier || record.supplier || "\u672a\u5339\u914d",
      supplierShort: detail?.supplierShort || record.supplierShort || detail?.supplier || "\u672a\u5339\u914d",
      orderUser: detail?.orderUser || record.orderUser || "\u672a\u7ef4\u62a4",
    };
  });
}

function getDeliveryFilterValues() {
  return Object.fromEntries(
    deliveryFilterConfigs.map((config) => [config.key, [...(deliveryState.selectedFilters[config.key] || new Set())]])
  );
}

function updateFilterOptions() {
  const filters = getDeliveryFilterValues();
  deliveryFilterConfigs.forEach((config) => {
    const optionItems = getFilterOptionItems(config, filters);
    syncMultiFilter(config, optionItems, filters[config.key] || []);
  });
}

function getFilterOptionItems(config, filters) {
  if (config.staticOptions) {
    return config.staticOptions.filter((option) => filterRecords({ ...filters, [config.key]: [option.value] }).length);
  }
  let values = uniqueValues(filterRecords({ ...filters, [config.key]: [] }), config.field);
  if (config.key === "purchaseGroup") {
    const sourceGroups = new Set(deliveryState.categoryPurchaseGroups);
    values = values.filter((value) => sourceGroups.has(value));
  }
  const sortedValues = config.sort ? config.sort(values) : values;
  return sortedValues.map((value) => ({ value, label: value }));
}

function renderFilterShell(config) {
  config.element.innerHTML = `
    <button class="multi-filter-button" type="button" data-filter-toggle="${config.key}">
      <span>${config.label}</span>
      <i aria-hidden="true">\u25be</i>
    </button>
    <div class="multi-filter-menu" role="menu"></div>
  `;
}

function syncMultiFilter(config, options, selectedValues) {
  const availableValues = new Set(options.map((option) => option.value));
  const selectedSet = deliveryState.selectedFilters[config.key] || new Set();
  [...selectedSet].forEach((value) => {
    if (!availableValues.has(value)) selectedSet.delete(value);
  });
  deliveryState.selectedFilters[config.key] = selectedSet;

  const button = config.element.querySelector(".multi-filter-button span");
  const menu = config.element.querySelector(".multi-filter-menu");
  button.textContent = getFilterButtonLabel(config, [...selectedSet]);
  menu.innerHTML = `
    <label class="multi-filter-option ${selectedSet.size ? "" : "selected"}" data-filter-key="${config.key}" data-filter-option="all">
      <input type="checkbox" ${selectedSet.size ? "" : "checked"} />
      <span>${config.label}</span>
    </label>
    ${options
      .map(
        (option) => `
          <label class="multi-filter-option ${selectedSet.has(option.value) ? "selected" : ""}" data-filter-key="${config.key}" data-filter-option="${escapeAttribute(option.value)}">
            <input type="checkbox" ${selectedSet.has(option.value) ? "checked" : ""} />
            <span>${escapeHtml(option.label)}</span>
          </label>`
      )
      .join("")}
  `;
}

function getFilterButtonLabel(config, selectedValues) {
  if (!selectedValues.length) return config.label;
  if (selectedValues.length === 1) return selectedValues[0];
  if (selectedValues.length === 2) return selectedValues.join("\u3001");
  return `\u5df2\u9009${selectedValues.length}\u9879`;
}

function toggleFilterOption(key, value) {
  const selectedSet = deliveryState.selectedFilters[key] || new Set();
  if (value === "all") {
    selectedSet.clear();
  } else if (selectedSet.has(value)) {
    selectedSet.delete(value);
  } else {
    selectedSet.add(value);
  }
  deliveryState.selectedFilters[key] = selectedSet;
}

function closeOtherFilterMenus(activeKey = "") {
  deliveryFilterConfigs.forEach((config) => {
    if (config.key !== activeKey) config.element.classList.remove("open");
  });
}

function applyDeliveryFilters() {
  updateFilterOptions();
  deliveryState.filtered = filterRecords(getDeliveryFilterValues());
  renderDelivery();
}

function filterRecords(filters) {
  return deliveryState.records.filter(
    (record) =>
      matchesFilter(record.businessUnit, filters.businessUnit) &&
      matchesFilter(record.purchaseGroup, filters.purchaseGroup) &&
      matchesFilter(record.salesLine, filters.salesLine) &&
      matchesFilter(record.salesSeries, filters.salesSeries) &&
      matchesFilter(record.supplierShort, filters.supplierShort) &&
      matchesFilter(record.orderUser, filters.orderUser) &&
      matchesStockAgeFilter(record, filters.stockAge)
  );
}

function matchesFilter(value, selectedValues = []) {
  return !selectedValues?.length || selectedValues.includes(value);
}

function matchesStockAgeFilter(record, selectedValues = []) {
  if (!selectedValues?.length) return true;
  return selectedValues.some(
    (value) => (value === "over60" && record.isOver60) || (value === "notOver60" && !record.isOver60)
  );
}

function renderDelivery(message) {
  const records = deliveryState.filtered;
  const detailRecords = getDeliveryDetailRecords();
  deliveryEls.orderedQty.textContent = formatNumber(sumBy(records, "orderedQty"));
  deliveryEls.shippedQty.textContent = formatNumber(sumBy(records, "shippedQty"));
  deliveryEls.remainingQty.textContent = formatNumber(sumBy(records, "remainingQty"));
  deliveryEls.over60Qty.textContent = formatNumber(sumOver60Remaining(records));
  deliveryEls.state.textContent = message || (records.length ? `已匹配 ${records.length} 行` : "暂无匹配数据");
  deliveryEls.downloadButton.disabled = Boolean(message) || !detailRecords.length;

  deliveryEls.rows.innerHTML = detailRecords.length
    ? detailRecords.map(renderDeliveryRow).join("")
    : `<tr><td colspan="8">${escapeHtml(message || "暂无匹配数据")}</td></tr>`;
}

function renderDeliveryRow(record) {
  return `
    <tr>
      <td>${escapeHtml(record.supplierShort || record.supplier || "--")}</td>
      <td>${escapeHtml(record.materialCode || "--")}</td>
      <td>${escapeHtml(record.sku || "--")}</td>
      <td>${escapeHtml(record.itemName || "--")}</td>
      <td>${formatNumber(record.orderedQty)}</td>
      <td>${formatNumber(record.completedQty)}</td>
      <td>${formatNumber(record.shippedQty)}</td>
      <td>${formatNumber(record.remainingQty)}</td>
    </tr>
  `;
}

function getDeliveryDetailRecords() {
  return deliveryState.filtered.filter((record) => Number(record.remainingQty) > 0);
}

function downloadDeliveryDetails() {
  const rows = getDeliveryDetailRecords();
  if (!rows.length || !window.XLSX) return;

  const exportRows = rows.map((record) => ({
    物料编码: record.materialCode || "",
    SKU: record.sku || "",
    物品名称: record.itemName || "",
    下单数量: Number(record.orderedQty) || 0,
    已完工数据: Number(record.completedQty) || 0,
    已发货数量: Number(record.shippedQty) || 0,
    剩余数量: Number(record.remainingQty) || 0,
  }));
  const worksheet = window.XLSX.utils.json_to_sheet(exportRows, {
    header: ["物料编码", "SKU", "物品名称", "下单数量", "已完工数据", "已发货数量", "剩余数量"],
  });
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, "供应商未交付明细");
  window.XLSX.writeFile(workbook, `${buildDeliveryDownloadName()}.xlsx`);
}

function buildDeliveryDownloadName() {
  const parts = [
    "????????????",
    ...deliveryFilterConfigs.map((config) => selectedText(config)),
  ];
  return parts.map(sanitizeFileNamePart).filter(Boolean).join("_");
}

function selectedText(config) {
  return getFilterButtonLabel(config, [...(deliveryState.selectedFilters[config.key] || new Set())]);
}

function sanitizeFileNamePart(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function createHeaderMap(headers, dataRows = []) {
  const headerMap = createAliasHeaderMap(headers, columnAliases);
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
  return Object.values(columnAliases).some((aliases) => aliases.some((alias) => normalizeHeader(alias) === header));
}

function hasKnownPurchaseDetailHeader(value) {
  const header = normalizeHeader(value);
  return Object.values(purchaseDetailAliases).some((aliases) => aliases.some((alias) => normalizeHeader(alias) === header));
}

function uniqueValues(items, key) {
  return [...new Set(items.map((item) => item[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "zh-CN"));
}

function sortPurchaseGroups(values) {
  return [...values].sort((a, b) => {
    const aIndex = PURCHASE_GROUP_ORDER.indexOf(a);
    const bIndex = PURCHASE_GROUP_ORDER.indexOf(b);
    if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
    if (aIndex >= 0) return -1;
    if (bIndex >= 0) return 1;
    return String(a).localeCompare(String(b), "zh-CN");
  });
}

function sumBy(items, key) {
  return items.reduce((sum, item) => sum + (Number(item[key]) || 0), 0);
}

function sumOver60Remaining(items) {
  return items.reduce((sum, item) => sum + (item.isOver60 ? Number(item.remainingQty) || 0 : 0), 0);
}

function isStockAgeOver60(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/库龄\s*[>＞]\s*60/.test(text)) return true;
  if (/^(是|true|yes|y|1|超60|超过60天)$/i.test(text)) return true;
  return parseNumber(text) > 60;
}

function getRowValue(row, index) {
  return index === undefined ? "" : String(row[index] ?? "").trim();
}

function parseNumber(value) {
  const number = Number(String(value || "").replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value) || 0);
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
  element.textContent = `${label}\uff5c\u5f15\u7528\u65f6\u95f4\uff1a${time ? formatReferenceTime(time) : "--"}`;
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

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[()（）]/g, "")
    .toLowerCase();
}

function normalizeMaterialCode(value) {
  return String(value || "")
    .trim()
    .replace(/\.0$/, "")
    .toLowerCase();
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
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

initDeliveryDashboard().catch((error) => {
  console.error(error);
  deliveryEls.state.textContent = "供应商交付信息异常";
});
