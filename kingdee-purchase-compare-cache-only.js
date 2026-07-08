const DB_NAME = "supply-chain-library";
const DB_VERSION = 4;
const KINGDEE_COMPARE_BUILD = "cache-only-20260708-2";
const COMPARE_PAGE_SIZE = 100;
const KINGDEE_CACHE_STORE = "kingdee-compare-cache";
let kingdeeCompareWorker = null;
function getKingdeeCompareWorker() {
  if (!kingdeeCompareWorker) {
    kingdeeCompareWorker = new Worker("./kingdee-compare-worker.js?v=20260708-1");
  }
  return kingdeeCompareWorker;
}

function runWorkerTask(type, file) {
  return new Promise((resolve, reject) => {
    const worker = getKingdeeCompareWorker();
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const handler = function handleWorkerMessage(event) {
      if (event.data.id !== id) return;
      worker.removeEventListener("message", handler);
      if (event.data.type === "result") {
        resolve(event.data.rows);
      } else {
        reject(new Error(event.data.error || "Worker解析失败"));
      }
    };
    worker.addEventListener("message", handler);
    file.arrayBuffer()
      .then((buffer) => {
        worker.postMessage({ type, id, file: buffer, fileName: file.name }, [buffer]);
      })
      .catch(reject);
  });
}

const UPLOAD_STORE_NAME = "uploaded-files";
const DIMENSION_STORE_NAME = "dimension-files";
const FACT_STORE_NAME = "fact-files";
const CATEGORY_DIMENSION_SLOT = "dimension-1";
const PURCHASE_ASSIGNMENT_SLOT = "dimension-6";
const PURCHASE_ORDER_SLOT = "fact-1";
const KINGDEE_ORDER_SLOT = "fact-2";

const compareEls = {
  filterBar: document.querySelector("#kingdeeFilterBar"),
  tableActions: document.querySelector("#kingdeeTableActions"),
  search: document.querySelector("#kingdeeSearch"),
  resetButton: document.querySelector("#kingdeeResetButton"),
  downloadButton: document.querySelector("#kingdeeDownloadButton"),
  state: document.querySelector("#kingdeeCompareState"),
  sourceNote: document.querySelector("#kingdeeCompareSourceNote"),
  rows: document.querySelector("#kingdeeCompareRows"),
  orderedDiffDocumentCount: document.querySelector("#orderedDiffDocumentCount"),
  remainingDiffDocumentCount: document.querySelector("#remainingDiffDocumentCount"),
  kingdeeHeader: document.querySelector("#kingdeeDataHeader"),
  undeliveredHeader: document.querySelector("#undeliveredDataHeader"),
  differenceHeader: document.querySelector("#differenceDataHeader"),
};

const compareFilterConfigs = [
  { key: "orderUser", id: "orderUserCompareFilter", label: "全部采购订单下单人", field: "orderUsers" },
  { key: "businessUnit", id: "businessUnitCompareFilter", label: "全部事业部", field: "businessUnit" },
  { key: "supplierShort", id: "supplierShortCompareFilter", label: "全部供应商简称", field: "supplierShort" },
  { key: "salesLine", id: "salesLineCompareFilter", label: "全部销售产品线", field: "salesLine" },
  { key: "salesSeries", id: "salesSeriesCompareFilter", label: "全部销售系列", field: "salesSeries" },
  {
    key: "compareMetric",
    id: "compareMetricFilter",
    label: "对比数据",
    options: ["下单数量", "剩余数量"],
    single: true,
  },
  {
    key: "differenceStatus",
    id: "differenceStatusCompareFilter",
    label: "全部差异",
    options: ["有差异", "无差异"],
  },
];

const compareState = {
  records: [],
  filtered: [],
  selectedFilters: Object.fromEntries(compareFilterConfigs.map((config) => [config.key, new Set()])),
  page: 1,
  pageSize: COMPARE_PAGE_SIZE,
  assignmentOrderUsers: [],
  assignmentSupplierShorts: [],
};

async function initKingdeeComparePage() {
  compareFilterConfigs.forEach(renderCompareFilter);
  compareState.selectedFilters.compareMetric.add("下单数量");
  ensureComparePagination();
  bindCompareEvents();
  updateCompareHeaders();
  await loadCompareData();
}

function bindCompareEvents() {
  compareEls.filterBar.addEventListener("click", handleCompareFilterClick);
  compareEls.tableActions.addEventListener("click", handleCompareFilterClick);

  let kingdeeSearchTimer = null;
  compareEls.search.addEventListener("input", () => {
    clearTimeout(kingdeeSearchTimer);
    kingdeeSearchTimer = setTimeout(applyCompareFilters, 300);
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#kingdeeFilterBar") && !event.target.closest("#kingdeeTableActions")) closeCompareFilters();
  });

  compareEls.resetButton.addEventListener("click", () => {
    compareEls.search.value = "";
    Object.values(compareState.selectedFilters).forEach((set) => set.clear());
    compareState.selectedFilters.compareMetric.add("下单数量");
    applyCompareFilters();
  });

  compareEls.downloadButton?.addEventListener("click", downloadCompareRows);

  document.getElementById("kingdeeComparePagination")?.addEventListener("click", (event) => {
    const prevButton = event.target.closest("#kingdeePrevPage");
    const nextButton = event.target.closest("#kingdeeNextPage");
    if (prevButton && compareState.page > 1) {
      compareState.page -= 1;
      renderCompareRows();
    }
    if (nextButton) {
      const totalPages = Math.max(1, Math.ceil(compareState.filtered.length / COMPARE_PAGE_SIZE));
      if (compareState.page < totalPages) {
        compareState.page += 1;
        renderCompareRows();
      }
    }
  });
}

function handleCompareFilterClick(event) {
  const toggle = event.target.closest("[data-filter-toggle]");
  if (toggle) {
    closeCompareFilters(toggle.dataset.filterToggle);
    getFilterElement(toggle.dataset.filterToggle)?.classList.toggle("open");
    return;
  }

  const option = event.target.closest("[data-filter-option]");
  if (!option) return;
  event.preventDefault();
  event.stopPropagation();
  toggleCompareOption(option.dataset.filterKey, option.dataset.filterOption);
  applyCompareFilters();
}

async function loadCompareData() {
  try {
    setCompareMessage("正在读取本地文件库");
    const db = await openAppDb();
    const [kingdeeRecord, deliveryRecord, categoryRecord, purchaseAssignmentRecord] = await Promise.all([
      getRecord(db, FACT_STORE_NAME, KINGDEE_ORDER_SLOT),
      getRecord(db, FACT_STORE_NAME, PURCHASE_ORDER_SLOT),
      getRecord(db, DIMENSION_STORE_NAME, CATEGORY_DIMENSION_SLOT),
      getRecord(db, DIMENSION_STORE_NAME, PURCHASE_ASSIGNMENT_SLOT),
    ]);
    db.close();

    const appliedKingdeeRecord = getAppliedLibraryRecord(kingdeeRecord);
    const appliedDeliveryRecord = getAppliedLibraryRecord(deliveryRecord);
    const appliedCategoryRecord = getAppliedLibraryRecord(categoryRecord);
    const appliedPurchaseAssignmentRecord = getAppliedLibraryRecord(purchaseAssignmentRecord);

    updateSourceNote(compareEls.sourceNote, "数据来源：本地文件库", [
      { name: "Fac-金蝶采购订单列表", record: appliedKingdeeRecord },
      { name: "Fac-采购订单跟进表", record: appliedDeliveryRecord },
      { name: "Dim-YL医疗器械商品分类", record: appliedCategoryRecord },
      { name: "Dim-采购分工明细", record: appliedPurchaseAssignmentRecord },
    ]);

    if (!appliedKingdeeRecord?.file || !appliedDeliveryRecord?.file) {
      resetCompare("请先在文件库更新上传并确认应用 Fac-金蝶采购订单列表 和 Fac-采购订单跟进表");
      return;
    }

    const [categoryResult, assignmentResult, kingdeeRows, deliveryRows] = await Promise.all([
      readOptionalSource("Dim-YL医疗器械商品分类", appliedCategoryRecord?.file, readCategoryDimension, new Map()),
      readOptionalSource("Dim-采购分工明细", appliedPurchaseAssignmentRecord?.file, readPurchaseAssignment, createEmptyAssignmentMaps()),
      readKingdeeRowsFromRecord(appliedKingdeeRecord),
      readRequiredSource("Fac-采购订单跟进表", appliedDeliveryRecord.file, readDeliveryWorkbook),
    ]);

    const assignmentMaps = assignmentResult.value;
    compareState.assignmentOrderUsers = [...assignmentMaps.orderUsers].sort((a, b) => String(a).localeCompare(String(b), "zh-CN"));
    const supplierShorts = new Set();
    for (const [, info] of assignmentMaps.byComposite) {
      if (info.supplierShort) supplierShorts.add(info.supplierShort);
    }
    compareState.assignmentSupplierShorts = [...supplierShorts].sort((a, b) => String(a).localeCompare(String(b), "zh-CN"));

    compareState.records = mergeCompareRows(kingdeeRows, deliveryRows, categoryResult.value, assignmentResult.value);
    if (!compareState.records.length) {
      resetCompare("已应用文件暂无可对比数据");
      return;
    }
    applyCompareFilters();
    const optionalWarnings = [categoryResult, assignmentResult].filter((result) => result.warning).map((result) => result.warning);
    if (optionalWarnings.length) {
      compareEls.state.textContent = `已匹配 ${compareState.filtered.length} 行｜${optionalWarnings.join("；")}`;
    }
  } catch (error) {
    console.error(error);
    resetCompare(`金蝶采购订单对比读取失败：${error.message || "请检查已应用文件"}`);
  }
}

async function readRequiredSource(label, file, reader) {
  try {
    return await reader(file);
  } catch (error) {
    throw new Error(`${label} 读取失败：${error.message || "文件解析异常"}`);
  }
}

async function readKingdeeRowsFromRecord(record) {
  const cachedRows = await getFreshKingdeeCompareCache(record);
  if (cachedRows) return cachedRows;
  if (record?.file) {
    const rows = await readKingdeeWorkbook(record.file);
    if (rows.length) {
      await saveKingdeeCompareCache(record, rows);
      return rows;
    }
  }
  throw new Error("Fac-金蝶采购订单列表未生成对比数据，请到文件库更新重新上传该表并点击确认应用");
}

async function getFreshKingdeeCompareCache(record) {
  if (!record?.id) return null;
  const db = await openAppDb();
  const cacheEntry = await getRecord(db, KINGDEE_CACHE_STORE, record.id);
  db.close();
  if (!cacheEntry?.rows?.length) return null;
  const source = cacheEntry.source || {};
  if (!source.name && !source.size && !source.appliedAt) return null;
  if (source.name && source.name !== record.name) return null;
  if (source.size && Number(source.size) !== Number(record.size)) return null;
  if (source.appliedAt && source.appliedAt !== record.appliedAt) return null;
  if (source.build !== KINGDEE_COMPARE_BUILD) return null;
  return cacheEntry.rows;
}

async function saveKingdeeCompareCache(record, rows) {
  if (!record?.id || !Array.isArray(rows)) return;
  const db = await openAppDb();
  await putRecord(db, KINGDEE_CACHE_STORE, {
    id: record.id,
    rows,
    cachedAt: new Date().toISOString(),
    source: {
      name: record.name,
      size: record.size,
      appliedAt: record.appliedAt,
      build: KINGDEE_COMPARE_BUILD,
    },
  });
  db.close();
}

async function readOptionalSource(label, file, reader, fallback) {
  if (!file) return { value: fallback, warning: `${label}未应用` };
  try {
    return { value: await reader(file), warning: "" };
  } catch (error) {
    console.warn(`${label} read failed`, error);
    return { value: fallback, warning: `${label}读取失败，已按未匹配展示` };
  }
}

function resetCompare(message) {
  compareState.records = [];
  compareState.filtered = [];
  applyCompareFilters(message);
}

function renderCompareFilter(config) {
  const element = document.querySelector(`#${config.id}`);
  element.innerHTML = `
    <button class="multi-filter-button" type="button" data-filter-toggle="${config.key}">
      <span>${config.label}</span>
      <i aria-hidden="true">▾</i>
    </button>
    <div class="multi-filter-menu" role="menu"></div>
  `;
}

function applyCompareFilters(message = "") {
  updateCompareHeaders();
  updateCompareFilters();
  compareState.filtered = message ? [] : filterCompareRows(getCompareFilterValues(), compareEls.search.value);
  compareState.page = 1;
  renderCompareRows(message);
}

function updateCompareFilters() {
  const filters = getCompareFilterValues();
  compareFilterConfigs.forEach((config) => {
    const element = getFilterElement(config.key);
    const selected = compareState.selectedFilters[config.key] || new Set();
    const button = element.querySelector(".multi-filter-button span");
    const menu = element.querySelector(".multi-filter-menu");
    const options = getCompareOptionItems(config, filters);
    syncSelectedValues(config, options);
    button.textContent = getCompareFilterLabel(config, compareState.selectedFilters[config.key]);
    menu.innerHTML = renderCompareOptions(config, compareState.selectedFilters[config.key], options);
  });
}

function getCompareOptionItems(config, filters) {
  if (config.options) return config.options.map((value) => ({ value, label: value }));
  if (config.key === "orderUser") {
    const values = [...compareState.assignmentOrderUsers];
    if (!values.includes("未维护")) values.push("未维护");
    return values.map((value) => ({ value, label: value }));
  }
  if (config.key === "supplierShort") {
    return compareState.assignmentSupplierShorts.map((value) => ({ value, label: value }));
  }
  const optionRows = filterCompareRows({ ...filters, [config.key]: [] }, compareEls.search.value);
  return uniqueFilterValues(optionRows, config.field).map((value) => ({ value, label: value }));
}

function syncSelectedValues(config, options) {
  if (config.single) return;
  const availableValues = new Set(options.map((option) => option.value));
  const selected = compareState.selectedFilters[config.key] || new Set();
  [...selected].forEach((value) => {
    if (!availableValues.has(value)) selected.delete(value);
  });
}

function renderCompareOptions(config, selected, options) {
  const allOption = config.single
    ? ""
    : `
      <label class="multi-filter-option ${selected.size ? "" : "selected"}" data-filter-key="${config.key}" data-filter-option="all">
        <input type="checkbox" ${selected.size ? "" : "checked"} />
        <span>${escapeHtml(config.label)}</span>
      </label>`;
  const optionList = options.length ? options : [{ value: "等待数据", label: "等待数据", disabled: true }];
  return `
    ${allOption}
    ${optionList
      .map((option) => {
        const disabled = option.disabled || option.value === "等待数据";
        const checked = selected.has(option.value);
        return `
          <label class="multi-filter-option ${checked ? "selected" : ""}" data-filter-key="${config.key}" data-filter-option="${escapeAttribute(option.value)}">
            <input type="checkbox" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />
            <span>${escapeHtml(option.label)}</span>
          </label>`;
      })
      .join("")}
  `;
}

function toggleCompareOption(key, value) {
  const config = compareFilterConfigs.find((item) => item.key === key);
  const selected = compareState.selectedFilters[key];
  if (!config || !selected || value === "等待数据") return;
  if (value === "all") {
    selected.clear();
    return;
  }
  if (config.single) {
    selected.clear();
    selected.add(value);
    return;
  }
  if (selected.has(value)) selected.delete(value);
  else selected.add(value);
}

function updateCompareHeaders() {
  const metric = getSelectedMetric();
  compareEls.kingdeeHeader.textContent = `${metric}-金蝶数据`;
  compareEls.undeliveredHeader.textContent = `${metric}-未交付表数据`;
  compareEls.differenceHeader.textContent = `${metric}-差异数据`;
}

function renderCompareRows(message = "") {
  const rows = compareState.filtered;
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / COMPARE_PAGE_SIZE));
  if (compareState.page > totalPages) compareState.page = totalPages;
  const startIndex = (compareState.page - 1) * COMPARE_PAGE_SIZE;
  const pageRows = rows.slice(startIndex, startIndex + COMPARE_PAGE_SIZE);
  const metric = getSelectedMetric();
  renderCompareMetrics(pageRows, message);
  compareEls.downloadButton.disabled = Boolean(message) || !rows.length;
  compareEls.state.textContent = message || (totalRows ? `已匹配 ${totalRows} 行｜第 ${compareState.page}/${totalPages} 页｜本页 ${pageRows.length} 行` : "暂无匹配数据");

  if (message || !rows.length) {
    compareEls.rows.innerHTML = `<tr><td colspan="10" class="empty-table-cell">${escapeHtml(message || "暂无匹配数据")}</td></tr>`;
    const paginationEl = document.getElementById("kingdeeComparePagination");
    if (paginationEl) paginationEl.innerHTML = "";
    return;
  }

  compareEls.rows.innerHTML = pageRows.map((record) => renderCompareRow(record, metric)).join("");
  const paginationEl = document.getElementById("kingdeeComparePagination");
  if (paginationEl && totalRows > 0) {
    paginationEl.innerHTML = totalPages <= 1 ? "" : `
      <span>第 ${compareState.page}/${totalPages} 页，共 ${totalRows} 条</span>
      <button id="kingdeePrevPage" type="button" ${compareState.page <= 1 ? "disabled" : ""}>上一页</button>
      <button id="kingdeeNextPage" type="button" ${compareState.page >= totalPages ? "disabled" : ""}>下一页</button>
    `;
  } else if (paginationEl) {
    paginationEl.innerHTML = "";
  }
}

function ensureComparePagination() {
  if (document.getElementById("kingdeeComparePagination")) return;
  const tableWrap = document.querySelector(".kingdee-table-wrap");
  if (!tableWrap) return;
  const paginationEl = document.createElement("div");
  paginationEl.id = "kingdeeComparePagination";
  paginationEl.className = "table-pagination kingdee-compare-pagination";
  tableWrap.insertAdjacentElement("afterend", paginationEl);
}

function renderCompareMetrics(rows, message = "") {
  if (message) {
    compareEls.orderedDiffDocumentCount.textContent = "0";
    compareEls.remainingDiffDocumentCount.textContent = "0";
    return;
  }
  compareEls.orderedDiffDocumentCount.textContent = formatNumber(countDifferentDocuments(rows, "下单数量"));
  compareEls.remainingDiffDocumentCount.textContent = formatNumber(countDifferentDocuments(rows, "剩余数量"));
}

function renderCompareRow(record, metric) {
  const values = getMetricValues(record, metric);
  return `
    <tr>
      <td>${escapeHtml(record.businessUnit || "--")}</td>
      <td>${escapeHtml(formatDocumentNumbers(record.documentNumbers))}</td>
      <td>${escapeHtml(formatDocumentNumbers(record.kingdeeDocumentNumbers))}</td>
      <td>${escapeHtml(record.supplierShort || "--")}</td>
      <td>${escapeHtml(record.materialCode || "--")}</td>
      <td>${escapeHtml(record.sku || "--")}</td>
      <td>${escapeHtml(record.itemName || "--")}</td>
      <td>${formatNumber(values.kingdee)}</td>
      <td>${formatNumber(values.undelivered)}</td>
      <td>${formatNumber(values.difference)}</td>
    </tr>
  `;
}

function getMetricValues(record, metric) {
  const kingdee = metric === "剩余数量" ? record.kingdeeRemainingQty : record.kingdeeOrderedQty;
  const undelivered = metric === "剩余数量" ? record.deliveryRemainingQty : record.deliveryOrderedQty;
  return {
    kingdee,
    undelivered,
    difference: kingdee - undelivered,
  };
}

function downloadCompareRows() {
  if (!compareState.filtered.length) return;
  const metric = getSelectedMetric();
  const headers = ["事业部", "单据编号", "金蝶单据编号", "供应商简称", "物料编码", "SKU", "物料名称", `${metric}-金蝶数据`, `${metric}-未交付表数据`, `${metric}-差异数据`];
  const rows = compareState.filtered.map((record) => {
    const values = getMetricValues(record, metric);
    return [
      record.businessUnit || "",
      formatDocumentNumbers(record.documentNumbers),
      formatDocumentNumbers(record.kingdeeDocumentNumbers),
      record.supplierShort || "",
      record.materialCode || "",
      record.sku || "",
      record.itemName || "",
      values.kingdee,
      values.undelivered,
      values.difference,
    ];
  });
  const csv = [headers, ...rows].map((row) => row.map(csvEscapeCell).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${buildCompareDownloadName(metric)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvEscapeCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCompareDownloadName(metric) {
  const parts = [
    "金蝶采购订单对比",
    metric,
    compareEls.search.value ? `搜索-${compareEls.search.value}` : "",
    ...compareFilterConfigs
      .filter((config) => config.key !== "compareMetric")
      .map((config) => selectedText(config)),
    formatDateCompact(new Date()),
  ];
  return parts.map(sanitizeFileNamePart).filter(Boolean).join("_");
}

async function readCategoryDimension(file) {
  const data = await runWorkerTask("category", file);
  return new Map(data.map);
}

async function readPurchaseAssignment(file) {
  const data = await runWorkerTask("assignment", file);
  const maps = {
    byMaterial: new Map(data.maps.byMaterial),
    bySupplier: new Map(data.maps.bySupplier),
    bySupplierShort: new Map(data.maps.bySupplierShort),
    orderUsers: new Set(data.maps.orderUsersEntries || []),
    byComposite: new Map(data.maps.byComposite || []),
  };
  return maps;
}

function createEmptyAssignmentMaps() {
  return {
    byMaterial: new Map(),
    bySupplier: new Map(),
    bySupplierShort: new Map(),
    orderUsers: new Set(),
    byComposite: new Map(),
  };
}

async function readKingdeeWorkbook(file) {
  return runWorkerTask("kingdee", file);
}

async function readDeliveryWorkbook(file) {
  return runWorkerTask("delivery", file);
}

function mergeCompareRows(kingdeeRows, deliveryRows, categoryMap, assignmentMaps) {
  const rowMap = new Map();

  kingdeeRows.forEach((row) => {
    const enriched = enrichKingdeeRow(row, categoryMap, assignmentMaps);
    const target = getOrCreateCompareRow(rowMap, enriched);
    target.kingdeeOrderedQty += row.purchaseQty;
    target.kingdeeRemainingQty += row.remainingInboundQty;
    addSetValues(target.kingdeeDocumentNumbers, [row.documentNumber]);
    addSetValues(target.orderUsers, enriched.orderUsers);
  });

  deliveryRows.forEach((row) => {
    const enriched = enrichDeliveryRow(row, categoryMap, assignmentMaps);
    const target = getOrCreateCompareRow(rowMap, enriched);
    target.deliveryOrderedQty += row.orderedQty;
    target.deliveryRemainingQty += row.remainingQty;
    addSetValues(target.orderUsers, enriched.orderUsers);
    addSetValues(target.documentNumbers, enriched.documentNumbers);
  });

  return [...rowMap.values()].sort(sortCompareRows).map((record) => ({
    ...record,
    orderUsers: [...record.orderUsers].filter(Boolean),
    documentNumbers: [...record.documentNumbers].filter(Boolean),
    kingdeeDocumentNumbers: [...record.kingdeeDocumentNumbers].filter(Boolean),
  }));
}

function enrichKingdeeRow(row, categoryMap, assignmentMaps) {
  const materialCode = normalizeMaterialCode(row.materialCode);
  const category = categoryMap.get(materialCode);
  const compositeMatchForS = assignmentMaps.byComposite.get(normalizeTextKey(row.supplier || "") + "|" + materialCode);
  const supplierShort = compositeMatchForS?.supplierShort || row.supplier || "未匹配";
  const compositeMatch = assignmentMaps.byComposite.get(normalizeTextKey(supplierShort) + "|" + materialCode);
  const orderUser = row.creator || compositeMatch?.orderUser || "未维护";
  return {
    businessUnit: normalizeBusinessUnit(row.businessUnit),
    supplierShort,
    materialCode: row.materialCode || materialCode || "未匹配",
    materialKey: materialCode,
    kingdeeDocumentNumbers: [row.documentNumber],
    sku: category?.sku || row.sku,
    itemName: category?.itemName || row.itemName,
    salesLine: category?.salesLine || "未匹配",
    salesSeries: category?.salesSeries || "未匹配",
    orderUsers: [orderUser],
  };
}

function enrichDeliveryRow(row, categoryMap, assignmentMaps) {
  const materialCode = normalizeMaterialCode(row.materialCode);
  const category = categoryMap.get(materialCode);
  const compositeMatchForS = assignmentMaps.byComposite.get(normalizeTextKey(row.supplier || "") + "|" + materialCode);
  const supplierShort = compositeMatchForS?.supplierShort || row.supplier || "未匹配";
  const compositeMatch = assignmentMaps.byComposite.get(normalizeTextKey(supplierShort) + "|" + materialCode);
  const orderUser = compositeMatch?.orderUser || "未维护";
  return {
    businessUnit: normalizeBusinessUnit(row.businessUnit),
    documentNumbers: [row.documentNumber],
    supplierShort,
    materialCode: row.materialCode || materialCode || "未匹配",
    materialKey: materialCode,
    sku: category?.sku || row.sku,
    itemName: category?.itemName || row.itemName,
    salesLine: category?.salesLine || "未匹配",
    salesSeries: category?.salesSeries || "未匹配",
    orderUsers: [orderUser],
  };
}

function getOrCreateCompareRow(rowMap, enriched) {
  const materialKey = enriched.materialKey || normalizeMaterialCode(enriched.materialCode);
  const key = materialKey || [enriched.businessUnit, normalizeTextKey(enriched.supplierShort), normalizeTextKey(enriched.sku), normalizeTextKey(enriched.itemName)].join("|");
  if (!rowMap.has(key)) {
    rowMap.set(key, {
      businessUnit: enriched.businessUnit || "未匹配",
      supplierShort: enriched.supplierShort || "未匹配",
      materialCode: enriched.materialCode || "",
      sku: enriched.sku || "",
      itemName: enriched.itemName || "",
      salesLine: enriched.salesLine || "未匹配",
      salesSeries: enriched.salesSeries || "未匹配",
      orderUsers: new Set(enriched.orderUsers || []),
      documentNumbers: new Set(enriched.documentNumbers || []),
      kingdeeDocumentNumbers: new Set(enriched.kingdeeDocumentNumbers || []),
      kingdeeOrderedQty: 0,
      kingdeeRemainingQty: 0,
      deliveryOrderedQty: 0,
      deliveryRemainingQty: 0,
    });
  } else {
    const existing = rowMap.get(key);
    existing.businessUnit = chooseCompareDisplayValue(existing.businessUnit, enriched.businessUnit);
    existing.supplierShort = chooseCompareDisplayValue(existing.supplierShort, enriched.supplierShort);
    existing.materialCode = chooseCompareDisplayValue(existing.materialCode, enriched.materialCode);
    existing.sku = chooseCompareDisplayValue(existing.sku, enriched.sku);
    existing.itemName = chooseCompareDisplayValue(existing.itemName, enriched.itemName);
    existing.salesLine = chooseCompareDisplayValue(existing.salesLine, enriched.salesLine);
    existing.salesSeries = chooseCompareDisplayValue(existing.salesSeries, enriched.salesSeries);
    addSetValues(existing.documentNumbers, enriched.documentNumbers);
    addSetValues(existing.kingdeeDocumentNumbers, enriched.kingdeeDocumentNumbers);
  }
  return rowMap.get(key);
}

function chooseCompareDisplayValue(current, next) {
  const currentText = String(current || "").trim();
  const nextText = String(next || "").trim();
  if (!nextText) return current || "";
  if (!currentText || currentText === "未匹配" || currentText === "--") return nextText;
  return current;
}

function filterCompareRows(filters, searchText = "") {
  const query = normalizeTextKey(searchText);
  const metric = getSelectedMetric();
  return compareState.records.filter((record) => {
    if (!matchesMulti(record.orderUsers, filters.orderUser)) return false;
    if (!matchesFilter(record.businessUnit, filters.businessUnit)) return false;
    if (!matchesFilter(record.supplierShort, filters.supplierShort)) return false;
    if (!matchesFilter(record.salesLine, filters.salesLine)) return false;
    if (!matchesFilter(record.salesSeries, filters.salesSeries)) return false;
    if (!matchesDifferenceStatus(record, filters.differenceStatus, metric)) return false;
    if (!query) return true;
    return [record.businessUnit, ...(record.documentNumbers || []), ...(record.kingdeeDocumentNumbers || []), record.supplierShort, record.materialCode, record.sku, record.itemName, record.salesLine, record.salesSeries, ...(record.orderUsers || [])]
      .some((value) => normalizeTextKey(value).includes(query));
  });
}

function matchesDifferenceStatus(record, selectedValues = [], metric = getSelectedMetric()) {
  if (!selectedValues?.length) return true;
  const { difference } = getMetricValues(record, metric);
  const hasDifference = Math.abs(Number(difference) || 0) > 0.000001;
  return selectedValues.some(
    (value) => (value === "有差异" && hasDifference) || (value === "无差异" && !hasDifference)
  );
}

function getCompareFilterValues() {
  return Object.fromEntries(
    compareFilterConfigs.map((config) => [config.key, [...(compareState.selectedFilters[config.key] || new Set())]])
  );
}

function uniqueFilterValues(rows, field) {
  const values = new Set();
  rows.forEach((row) => {
    const raw = row[field];
    const items = Array.isArray(raw) ? raw : [raw];
    items.forEach((value) => {
      if (value) values.add(value);
    });
  });
  return [...values].sort((a, b) => String(a).localeCompare(String(b), "zh-CN"));
}

function matchesFilter(value, selectedValues = []) {
  return !selectedValues?.length || selectedValues.includes(value);
}

function matchesMulti(values, selectedValues = []) {
  if (!selectedValues?.length) return true;
  const valueSet = new Set(Array.isArray(values) ? values : [values]);
  return selectedValues.some((value) => valueSet.has(value));
}

function formatDocumentNumbers(values) {
  const items = Array.isArray(values) ? values : [values];
  const unique = [...new Set(items.map((value) => String(value || "").trim()).filter(Boolean))];
  return unique.length ? unique.join("、") : "--";
}

function countDifferentDocuments(rows, metric) {
  const documents = new Set();
  rows.forEach((record, index) => {
    const { difference } = getMetricValues(record, metric);
    if (Math.abs(Number(difference) || 0) <= 0.000001) return;
    const values = Array.isArray(record.documentNumbers) ? record.documentNumbers : [];
    const validValues = values.map((value) => String(value || "").trim()).filter(Boolean);
    if (validValues.length) {
      validValues.forEach((value) => documents.add(value));
    } else {
      documents.add(`未匹配单据-${index}`);
    }
  });
  return documents.size;
}

function getSelectedMetric() {
  return [...compareState.selectedFilters.compareMetric][0] || "下单数量";
}

function getCompareFilterLabel(config, selected) {
  if (!selected.size) return config.label;
  if (selected.size === 1) return [...selected][0];
  if (selected.size === 2) return [...selected].join("、");
  return `已选${selected.size}项`;
}

function selectedText(config) {
  return getCompareFilterLabel(config, compareState.selectedFilters[config.key] || new Set());
}

function getFilterElement(key) {
  const config = compareFilterConfigs.find((item) => item.key === key);
  return config ? document.querySelector(`#${config.id}`) : null;
}

function closeCompareFilters(exceptKey = "") {
  compareFilterConfigs.forEach((config) => {
    if (config.key !== exceptKey) getFilterElement(config.key)?.classList.remove("open");
  });
}

function normalizeBusinessUnit(value) {
  const text = String(value || "").trim().split("*")[0].trim().replace(/[（(].*?[）)]/g, "").trim();
  if (!text) return "未匹配";
  if (text === "全球招商事业部") return "全球招商部";
  return text;
}

function normalizeMaterialCode(value) {
  return String(value || "")
    .trim()
    .replace(/\.0$/, "")
    .toLowerCase();
}

function normalizeTextKey(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

function addSetValues(target, values) {
  (values || []).forEach((value) => {
    if (value) target.add(value);
  });
}

function sortCompareRows(a, b) {
  return (
    String(a.businessUnit).localeCompare(String(b.businessUnit), "zh-CN") ||
    String(a.supplierShort).localeCompare(String(b.supplierShort), "zh-CN") ||
    String(a.materialCode).localeCompare(String(b.materialCode), "zh-CN")
  );
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

function formatDateCompact(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function sanitizeFileNamePart(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "");
}

function getAppliedLibraryRecord(record) {
  return record?.applied && record?.file ? record : null;
}

function setCompareMessage(message) {
  compareEls.state.textContent = message;
  compareEls.rows.innerHTML = `<tr><td colspan="10" class="empty-table-cell">${escapeHtml(message)}</td></tr>`;
  if (compareEls.downloadButton) compareEls.downloadButton.disabled = true;
}

function openAppDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      [UPLOAD_STORE_NAME, DIMENSION_STORE_NAME, FACT_STORE_NAME, KINGDEE_CACHE_STORE].forEach((storeName) => {
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

function putRecord(db, storeName, record) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    const request = transaction.objectStore(storeName).put(record);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
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

initKingdeeComparePage().catch((error) => {
  console.error(error);
  setCompareMessage("金蝶采购订单对比异常");
});
