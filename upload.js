const DB_NAME = "supply-chain-library";
const DB_VERSION = 3;
const UPLOAD_STORE_NAME = "uploaded-files";
const DIMENSION_STORE_NAME = "dimension-files";
const FACT_STORE_NAME = "fact-files";
const CATEGORY_DIMENSION_SLOT = "dimension-1";
const PURCHASE_ASSIGNMENT_SLOT = "dimension-6";
const SUPPLIER_SOURCE_LABEL = "\u6570\u636e\u6765\u6e90\uff1a\u7ef4\u5ea6\u8868\u6587\u4ef6\u5e93 / \u91c7\u8d2d\u5206\u5de5\u660e\u7ec6";
const PURCHASE_GROUP_ORDER = ["采购一组", "采购二组", "采购三组", "采购四组", "其他配件"];
const BAR_COLORS = ["#2f6fed", "#159a9c", "#6957d6", "#2f9e44", "#d98b11", "#d64545", "#0f766e", "#7c3aed", "#2563eb", "#ea580c"];
const DIVISION_DISPLAY_COLUMNS = ["组名", "事业部唯一对接人", "组员", "产品线", "负责事项"];

const supplierState = {
  records: [],
  filtered: [],
  categoryMap: new Map(),
  divisionRows: [],
  divisionHeaders: [],
};

const dashboardEls = {
  search: document.querySelector("#supplierSearch"),
  productLineFilter: document.querySelector("#productLineFilter"),
  ownerFilter: document.querySelector("#ownerFilter"),
  orderUserFilter: document.querySelector("#orderUserFilter"),
  skuCount: document.querySelector("#skuCount"),
  activeSupplierCount: document.querySelector("#activeSupplierCount"),
  supplierInfoRows: document.querySelector("#supplierInfoRows"),
  divisionInfoHead: document.querySelector("#divisionInfoHead"),
  divisionInfoRows: document.querySelector("#divisionInfoRows"),
  productLineBars: document.querySelector("#productLineBars"),
  orderUserSupplierBars: document.querySelector("#orderUserSupplierBars"),
  purchaseGroupSupplierBars: document.querySelector("#purchaseGroupSupplierBars"),
  rows: document.querySelector("#supplierRows"),
  recordState: document.querySelector("#recordState"),
  sourceNote: document.querySelector("#supplierSourceNote"),
  downloadButton: document.querySelector("#downloadButton"),
  resetButton: document.querySelector("#resetButton"),
};

const columnAliases = {
  primaryLine: ["一级产品线", "产品线", "销售产品线", "大类"],
  secondaryLine: ["二级产品线", "细分产品线", "品类", "商品分类"],
  owner: ["采购下单人"],
  group: ["采购组别", "采购组", "组名", "小组"],
  materialCode: ["物料编码", "商品编码", "存货编码", "产品编码", "货品编号"],
  sku: ["SKU", "sku"],
  materialName: ["物料名称", "商品名称", "存货名称", "产品名称", "品名"],
  supplier: ["供应商", "供应商名称", "厂家", "厂商", "供方"],
  supplierShort: ["供应商简称", "简称", "供应商简名"],
  purchasePrice: ["采购价格", "采购价"],
  unitPrice: ["单价", "价格"],
  moq: ["起订量", "MOQ", "moq", "最小起订量"],
  leadTime: ["生产周期", "生产周期(天)", "生产周期（天）", "供货周期", "交期"],
  hasContract: ["是否有年框", "年框", "年框协议", "是否年框"],
  paymentTerm: ["账期", "付款账期", "付款方式"],
  contact: ["联系人", "供应商联系人"],
  phone: ["联系电话", "电话", "手机号", "供应商电话"],
  address: ["供应商地址", "地址", "工厂地址"],
};

async function initSupplierDashboard() {
  bindDashboardEvents();
  if (await loadPurchaseAssignmentSource({ silent: true })) {
    return;
  }
  await loadPurchaseAssignmentSource();
}

function bindDashboardEvents() {
  [dashboardEls.search, dashboardEls.productLineFilter, dashboardEls.ownerFilter, dashboardEls.orderUserFilter].forEach((el) => {
    el.addEventListener("input", applyDashboardFilters);
  });

  dashboardEls.resetButton.addEventListener("click", () => {
    dashboardEls.search.value = "";
    dashboardEls.productLineFilter.value = "all";
    dashboardEls.ownerFilter.value = "all";
    dashboardEls.orderUserFilter.value = "all";
    applyDashboardFilters();
    return true;
  });

  dashboardEls.downloadButton.addEventListener("click", downloadCurrentRows);
}

async function loadPurchaseAssignmentSource(options = {}) {
  try {
    const db = await openAppDb();
    const [purchaseRecord, categoryRecord] = await Promise.all([
      getRecord(db, DIMENSION_STORE_NAME, PURCHASE_ASSIGNMENT_SLOT),
      getRecord(db, DIMENSION_STORE_NAME, CATEGORY_DIMENSION_SLOT),
    ]);
    db.close();
    const appliedPurchaseRecord = getAppliedLibraryRecord(purchaseRecord);
    const appliedCategoryRecord = getAppliedLibraryRecord(categoryRecord);

    if (!appliedPurchaseRecord?.file) {
      if (options.silent) return false;
      resetDashboard("\u8bf7\u5148\u5728\u7ef4\u5ea6\u8868\u6587\u4ef6\u5e93\u4e0a\u4f20\u5e76\u786e\u8ba4\u5e94\u7528\u91c7\u8d2d\u5206\u5de5\u660e\u7ec6");
      return false;
    }

    if (!appliedCategoryRecord?.file) {
      if (options.silent) return false;
      resetDashboard("\u8bf7\u5148\u5728\u7ef4\u5ea6\u8868\u6587\u4ef6\u5e93\u4e0a\u4f20\u5e76\u786e\u8ba4\u5e94\u7528Dim-YL\u533b\u7597\u5668\u68b0\u5546\u54c1\u5206\u7c7b");
      return false;
    }

    supplierState.categoryMap = await readCategoryDimension(appliedCategoryRecord.file);
    const { records, divisionRows, divisionHeaders } = await readSupplierRecords(appliedPurchaseRecord.file);
    const enrichedRecords = enrichSupplierRecords(records, supplierState.categoryMap);
    if (!enrichedRecords.length) {
      if (options.silent) return false;
      resetDashboard("\u5df2\u5e94\u7528\u7684\u91c7\u8d2d\u5206\u5de5\u660e\u7ec6\u65e0\u53ef\u7528\u6570\u636e");
      return false;
    }
    supplierState.records = enrichedRecords;
    supplierState.divisionRows = enrichDivisionRows(divisionRows, supplierState.categoryMap, divisionHeaders);
    supplierState.divisionHeaders = divisionHeaders;
    updateSourceNote(dashboardEls.sourceNote, "数据来源：本地文件库", [
      { name: "Dim-采购分工明细", record: appliedPurchaseRecord },
      { name: "Dim-YL医疗器械商品分类", record: appliedCategoryRecord },
    ]);
    hydrateFilters();
    applyDashboardFilters();
    return true;
  } catch (error) {
    console.error(error);
    if (options.silent) return false;
    resetDashboard("\u91c7\u8d2d\u5206\u5de5\u660e\u7ec6\u8bfb\u53d6\u5931\u8d25");
    return false;
  }
}

function getAppliedLibraryRecord(record) {
  return record?.applied && record?.file ? record : null;
}

function resetDashboard(message) {
  supplierState.records = [];
  supplierState.filtered = [];
  supplierState.categoryMap = new Map();
  supplierState.divisionRows = [];
  supplierState.divisionHeaders = [];
  updateSourceNote(dashboardEls.sourceNote, SUPPLIER_SOURCE_LABEL, null);
  hydrateFilters();
  renderDashboard(message);
}

async function readCategoryDimension(file) {
  const rows = await readWorkbookRows(file, "Dim-YL医疗器械商品分类");
  const map = new Map();
  rows.forEach((row) => {
    const materialCode = normalizeMaterialCode(row[0]);
    if (!materialCode || materialCode === "物料编码" || materialCode === "商品编码") return;
    map.set(materialCode, {
      sku: String(row[2] ?? "").trim(),
      materialName: String(row[3] ?? "").trim(),
      productLine: String(row[6] ?? "").trim(),
      purchaseGroup: String(row[20] ?? "").trim(),
    });
    const purchaseGroup = normalizeGroupKey(row[20]);
    if (purchaseGroup) {
      map.set(`group:${purchaseGroup}`, {
        productLine: String(row[6] ?? "").trim(),
        purchaseGroup: String(row[20] ?? "").trim(),
      });
    }
  });
  return map;
}

async function readSupplierRecords(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") {
    return {
      records: parseRows(await readWorkbookRows(file)),
      divisionRows: [],
      divisionHeaders: [],
    };
  }
  if (!window.XLSX) {
    throw new Error("XLSX parser is not available.");
  }
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
  const detailRows = readWorkbookSheetRows(workbook);
  const divisionData = readDivisionSheet(workbook);
  return {
    records: parseRows(detailRows),
    ...divisionData,
  };
}

async function readWorkbookRows(file, preferredSheet) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") {
    return csvToRows(await file.text());
  }
  if (!window.XLSX) {
    throw new Error("XLSX parser is not available.");
  }
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
  return readWorkbookSheetRows(workbook, preferredSheet);
}

function readWorkbookSheetRows(workbook, preferredSheet) {
  const sheetName = chooseSheetName(workbook.SheetNames, preferredSheet);
  return window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
}

function chooseSheetName(sheetNames, preferredSheet) {
  if (preferredSheet) {
    const exact = sheetNames.find((name) => name === preferredSheet);
    if (exact) return exact;
    const fuzzy = sheetNames.find((name) => name.includes(preferredSheet));
    if (fuzzy) return fuzzy;
  }
  return (
    sheetNames.find((name) => name.includes("产品线明细")) ||
    sheetNames.find((name) => name.includes("明细")) ||
    sheetNames[0]
  );
}

function parseRows(rows) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => hasKnownHeader(cell)));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((cell) => String(cell || "").trim());
  const headerMap = createHeaderMap(headers);

  return rows
    .slice(headerIndex + 1)
    .map((row, index) => normalizeRow(row, headerMap, index))
    .filter((record) => record.primaryLine || record.materialCode || record.sku || record.materialName || record.supplier || record.owner);
}

function normalizeRow(row, headerMap, index) {
  const getValue = (key, fallbackIndex) => {
    const columnIndex = headerMap[key] ?? fallbackIndex;
    return columnIndex === undefined ? "" : String(row[columnIndex] ?? "").trim();
  };

  const owner = getValue("owner", 2);
  const group = getValue("group") || extractGroup(owner);
  const supplier = getValue("supplier", 6);
  const supplierShort = getValue("supplierShort", 7) || supplier;
  const moq = parseNumber(getValue("moq", 8));
  const leadTime = parseNumber(getValue("leadTime", 9));
  const hasContract = parseBoolean(getValue("hasContract", 12));

  return {
    id: `${index}-${getValue("materialCode", 3)}-${getValue("sku", 4)}-${supplierShort}`,
    primaryLine: getValue("primaryLine", 0) || "未分类",
    secondaryLine: getValue("secondaryLine", 1),
    group: group || "未分组",
    owner: owner || "未分配",
    materialCode: getValue("materialCode", 3),
    sku: getValue("sku", 4),
    materialName: getValue("materialName", 5),
    supplier,
    supplierShort,
    purchasePrice: 0,
    unitPrice: 0,
    moq,
    leadTime,
    hasContract,
    paymentTerm: getValue("paymentTerm", 13) || "未填写",
    contact: getValue("contact", 17),
    phone: getValue("phone", 18),
    address: getValue("address", 19),
  };
}

function enrichSupplierRecords(records, categoryMap) {
  return records.map((record) => {
    const matched = categoryMap.get(normalizeMaterialCode(record.materialCode));
    const dimProductLine = matched?.productLine || "";
    const dimPurchaseGroup = matched?.purchaseGroup || "";
    const dimSku = matched?.sku || "";
    const dimMaterialName = matched?.materialName || "";
    return {
      ...record,
      dimProductLine,
      dimPurchaseGroup,
      primaryLine: dimProductLine || "未匹配",
      group: dimPurchaseGroup || "未匹配",
      sku: dimSku,
      materialName: dimMaterialName,
      region: formatRegion(record.address) || inferRegionFromSupplierName(record.supplier, record.supplierShort) || "未维护地址",
    };
  });
}

function createHeaderMap(headers) {
  return Object.fromEntries(
    Object.entries(columnAliases)
      .map(([key, aliases]) => {
        const index = headers.findIndex((header) => aliases.some((alias) => normalizeHeader(header) === normalizeHeader(alias)));
        return [key, index >= 0 ? index : undefined];
      })
      .filter(([, index]) => index !== undefined)
  );
}

function getDashboardFilterValues() {
  return {
    query: dashboardEls.search.value.trim().toLowerCase(),
    productLine: dashboardEls.productLineFilter.value,
    owner: dashboardEls.ownerFilter.value,
    orderUser: dashboardEls.orderUserFilter.value,
  };
}

function updateDashboardFilterOptions() {
  const filters = getDashboardFilterValues();
  const productLineScoped = filterSupplierRecords({ ...filters, productLine: "all" });

  syncDashboardSelect(dashboardEls.productLineFilter, uniqueValues(productLineScoped, "dimProductLine"), "\u5168\u90e8\u4ea7\u54c1\u7ebf", filters.productLine);
  const ownerScoped = filterSupplierRecords({ ...getDashboardFilterValues(), owner: "all" });
  syncDashboardSelect(
    dashboardEls.ownerFilter,
    sortPurchaseGroups(uniqueValues(ownerScoped, "dimPurchaseGroup")),
    "\u5168\u90e8\u91c7\u8d2d\u7ec4",
    filters.owner
  );
  const orderUserScoped = filterSupplierRecords({ ...getDashboardFilterValues(), orderUser: "all" });
  syncDashboardSelect(dashboardEls.orderUserFilter, uniqueValues(orderUserScoped, "owner"), "全部采购下单人", filters.orderUser);
}

function syncDashboardSelect(select, values, label, preferredValue = select.value) {
  select.innerHTML = `<option value="all">${label}</option>`;
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  select.value = values.includes(preferredValue) ? preferredValue : "all";
}

function filterSupplierRecords(filters) {
  const selectedGroupKey = normalizeGroupKey(filters.owner);
  return supplierState.records.filter((record) => {
    const searchable = [
      record.primaryLine,
      record.secondaryLine,
      record.group,
      record.dimProductLine,
      record.dimPurchaseGroup,
      record.owner,
      record.materialCode,
      record.sku,
      record.materialName,
      record.supplier,
      record.supplierShort,
      record.paymentTerm,
    ]
      .join(" ")
      .toLowerCase();
    return (
      (!filters.query || searchable.includes(filters.query)) &&
      (filters.productLine === "all" || record.dimProductLine === filters.productLine) &&
      (filters.owner === "all" || normalizeGroupKey(record.dimPurchaseGroup) === selectedGroupKey) &&
      (filters.orderUser === "all" || record.owner === filters.orderUser)
    );
  });
}

function hydrateFilters() {
  updateDashboardFilterOptions();
}

function fillSelect(select, values, label) {
  const currentValue = select.value;
  select.innerHTML = `<option value="all">${label}</option>`;
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  select.value = values.includes(currentValue) ? currentValue : "all";
}

function applyDashboardFilters() {
  updateDashboardFilterOptions();
  supplierState.filtered = filterSupplierRecords(getDashboardFilterValues());
  renderDashboard();
}

function renderDashboard(message) {
  const all = supplierState.records;
  const visible = supplierState.filtered;

  dashboardEls.skuCount.textContent = visible.length;
  dashboardEls.activeSupplierCount.textContent = uniqueSuppliers(visible).length;
  dashboardEls.recordState.textContent = message || (all.length ? `当前 ${visible.length} / ${all.length} 条` : "等待数据");
  dashboardEls.downloadButton.disabled = Boolean(message) || !visible.length;

  renderSupplierInfo(dashboardEls.supplierInfoRows, visible, message);
  renderDivisionInfo(dashboardEls.divisionInfoHead, dashboardEls.divisionInfoRows, getVisibleDivisionRows(), supplierState.divisionHeaders, message);
  renderBars(dashboardEls.productLineBars, countBy(visible, "dimProductLine"), message || "暂无产品线数据");
  renderBars(dashboardEls.orderUserSupplierBars, countSuppliersByOrderUser(visible), message || "暂无采购下单人数据");
  renderBars(dashboardEls.purchaseGroupSupplierBars, countSuppliersByPurchaseGroup(visible), message || "暂无采购组数据");
  renderRows(visible, message);
}

function renderSupplierInfo(container, records, message) {
  if (!records.length) {
    container.innerHTML = `<tr><td colspan="2" class="empty-table-cell">${escapeHtml(message || "暂无供应商信息")}</td></tr>`;
    return;
  }

  const suppliers = [...records.reduce((result, record) => {
    const key = record.supplierShort || record.supplier || "未填写";
    if (!result.has(key)) {
      result.set(key, {
        supplierShort: key,
        region: record.region || formatRegion(record.address),
        count: 0,
      });
    }
    const item = result.get(key);
    item.count += 1;
    if (!item.region && record.address) item.region = formatRegion(record.address);
    return result;
  }, new Map()).values()]
    .sort((a, b) => b.count - a.count);

  container.innerHTML = suppliers
    .map(
      (item) => `
        <tr>
          <td><strong>${escapeHtml(item.supplierShort)}</strong></td>
          <td>${escapeHtml(item.region || "未填写")}</td>
        </tr>
      `
    )
    .join("");
}

function getVisibleDivisionRows() {
  if (!supplierState.filtered.length) return [];
  const visibleGroupKeys = new Set(
    supplierState.filtered
      .map((record) => normalizeGroupKey(record.dimPurchaseGroup || record.group || record.owner))
      .filter(Boolean)
  );
  const visibleProductLines = new Set(
    supplierState.filtered
      .map((record) => normalizeDivisionMatchText(record.dimProductLine || record.primaryLine))
      .filter(Boolean)
  );

  return supplierState.divisionRows.filter((row) => {
    const rowGroupKey = normalizeGroupKey(row.matchedPurchaseGroup || row.groupName);
    const rowText = normalizeDivisionMatchText([row.key, row.groupName, row.matchedPurchaseGroup, ...(row.cells || [])].join(" "));
    const rowTokens = getDivisionLineTokens(row.key || row.cells?.[0] || "");
    const groupMatched = !visibleGroupKeys.size || visibleGroupKeys.has(rowGroupKey);
    const productLineMatched =
      !visibleProductLines.size ||
      [...visibleProductLines].some((line) => matchesDivisionProductLine(line, rowText, rowTokens));
    return groupMatched && productLineMatched;
  });
}

function matchesDivisionProductLine(line, rowText, rowTokens) {
  if (line === "升降椅" && rowText.includes("升降系列")) return true;
  if (line === "防褥疮气床垫" && rowText.includes("气床垫")) return true;
  return rowText.includes(line) || line.includes(rowText) || rowTokens.some((token) => line.includes(token));
}

function getDivisionLineTokens(value) {
  return String(value || "")
    .split(/[+＋、,，/／()（）\s]+/)
    .map(normalizeDivisionMatchText)
    .filter((token) => token.length >= 2)
    .map((token) => token.replace(/^含/, ""));
}

function normalizeDivisionMatchText(value) {
  return String(value || "")
    .trim()
    .replace(/[\s()（）【】\[\]_\-+\/、，,]/g, "")
    .toLowerCase();
}

function readDivisionSheet(workbook) {
  const sheetName = workbook.SheetNames.find((name) => name === "产品线分工表") || workbook.SheetNames.find((name) => name.includes("产品线分工表"));
  if (!sheetName) return { divisionRows: [], divisionHeaders: [] };
  const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
  const headerIndex = rows.findIndex((row) => row.some((cell) => String(cell ?? "").trim()));
  if (headerIndex < 0) return { divisionRows: [], divisionHeaders: [] };
  const divisionHeaders = rows[headerIndex].map((cell) => String(cell ?? "").trim());
  const divisionRows = rows
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => String(cell ?? "").trim()))
    .map((row) => ({
      key: String(row[0] ?? "").trim(),
      cells: divisionHeaders.map((_, index) => String(row[index] ?? "").trim()),
    }));
  return { divisionRows, divisionHeaders };
}

function enrichDivisionRows(rows, categoryMap, headers) {
  const groupColumnIndex = getDivisionColumnIndexes(headers)[0] ?? 0;
  return rows.map((row) => {
    const groupName = row.cells[groupColumnIndex] || row.key || "";
    const groupKey = normalizeGroupKey(groupName);
    const matchedPurchaseGroup = categoryMap.get(`group:${groupKey}`)?.purchaseGroup || groupName;
    return {
      ...row,
      groupName,
      groupKey,
      matchedPurchaseGroup,
    };
  });
}

function renderDivisionInfo(head, body, rows, headers, message) {
  const columnIndexes = getDivisionColumnIndexes(headers);
  head.innerHTML = columnIndexes.length
    ? `<tr>${DIVISION_DISPLAY_COLUMNS.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>`
    : "";

  if (!rows.length || !columnIndexes.length) {
    const colspan = Math.max(columnIndexes.length, 1);
    body.innerHTML = `<tr><td colspan="${colspan}" class="empty-table-cell">${escapeHtml(message || "暂无产品线分工表信息")}</td></tr>`;
    return;
  }

  body.innerHTML = rows
    .slice(0, 80)
    .map(
      (row) => `
        <tr>
          ${columnIndexes
            .map((columnIndex) => `<td title="${escapeHtml(row.cells[columnIndex] || "--")}">${escapeHtml(row.cells[columnIndex] || "--")}</td>`)
            .join("")}
        </tr>
      `
    )
    .join("");
  fitDivisionTable();
}

function getDivisionColumnIndexes(headers) {
  if (!headers.length) return [];
  return DIVISION_DISPLAY_COLUMNS.map((label, index) => {
    const matchedIndex = headers.findIndex((header) => normalizeHeader(header) === normalizeHeader(label));
    return matchedIndex >= 0 ? matchedIndex : index;
  });
}

function fitDivisionTable() {
  window.requestAnimationFrame(() => {
    const wrap = document.querySelector(".division-info-wrap");
    const table = document.querySelector(".division-info-table");
    if (!wrap || !table) return;

    table.style.removeProperty("font-size");
    table.style.removeProperty("transform");
    table.style.removeProperty("width");

    const maxFont = 12;
    const minFont = 8;
    for (let size = maxFont; size >= minFont; size -= 1) {
      table.style.fontSize = `${size}px`;
      if (table.scrollWidth <= wrap.clientWidth + 1) {
        return;
      }
    }

    const ratio = Math.max(0.72, Math.min(1, wrap.clientWidth / Math.max(table.scrollWidth, 1)));
    table.style.transformOrigin = "left top";
    table.style.transform = `scaleX(${ratio})`;
    table.style.width = `${100 / ratio}%`;
  });
}

function renderBars(container, counts, emptyText) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!entries.length) {
    container.innerHTML = `<div class="empty-state compact-empty">${escapeHtml(emptyText)}</div>`;
    return;
  }
  const max = Math.max(...entries.map(([, count]) => count), 1);
  container.innerHTML = entries
    .map(
      ([label, count], index) => `
        <div class="bar-row" style="--bar-color: ${BAR_COLORS[index % BAR_COLORS.length]}">
          <span title="${escapeHtml(label)}">${escapeHtml(label)}</span>
          <span class="bar-track"><span class="bar-fill" style="width: ${(count / max) * 100}%"></span></span>
          <strong>${count}</strong>
        </div>
      `
    )
    .join("");
}

function countSuppliersByOrderUser(records) {
  const groups = records.reduce((result, record) => {
    const orderUser = record.owner || "未填写";
    const supplier = record.supplierShort || record.supplier || "";
    if (!supplier) return result;
    if (!result.has(orderUser)) result.set(orderUser, new Set());
    result.get(orderUser).add(supplier);
    return result;
  }, new Map());
  return Object.fromEntries([...groups.entries()].map(([orderUser, suppliers]) => [orderUser, suppliers.size]));
}

function countSuppliersByPurchaseGroup(records) {
  const groups = records.reduce((result, record) => {
    const purchaseGroup = record.dimPurchaseGroup || record.group || "未分组";
    const supplier = record.supplierShort || record.supplier || "";
    if (!supplier) return result;
    if (!result.has(purchaseGroup)) result.set(purchaseGroup, new Set());
    result.get(purchaseGroup).add(supplier);
    return result;
  }, new Map());
  return Object.fromEntries([...groups.entries()].map(([purchaseGroup, suppliers]) => [purchaseGroup, suppliers.size]));
}

function renderRows(records, message) {
  if (!records.length) {
    dashboardEls.rows.innerHTML = `<tr><td colspan="8" class="empty-table-cell">${escapeHtml(
      message || "采购分工明细应用后显示采购黄页"
    )}</td></tr>`;
    return;
  }
  dashboardEls.rows.innerHTML = records
    .slice(0, 300)
    .map(
      (record) => `
        <tr>
          <td>${escapeHtml(record.primaryLine)}</td>
          <td>${escapeHtml(record.group || record.owner || "--")}</td>
          <td>${escapeHtml(record.materialCode || "--")}</td>
          <td>${escapeHtml(record.sku || "--")}</td>
          <td>${escapeHtml(record.materialName || "--")}</td>
          <td>${escapeHtml(record.supplierShort || record.supplier || "--")}</td>
          <td>${formatNumber(record.moq)}</td>
          <td>${formatNumber(record.leadTime)} 天</td>
        </tr>
      `
    )
    .join("");
}

function downloadCurrentRows() {
  if (!supplierState.filtered.length) return;
  const headers = ["一级产品线", "采购组对接人", "物料编码", "SKU", "物料名称", "供应商", "起订量", "生产周期"];
  const rows = supplierState.filtered.map((record) => [
    record.primaryLine,
    record.group || record.owner || "",
    record.materialCode,
    record.sku,
    record.materialName,
    record.supplierShort || record.supplier,
    record.moq || "",
    record.leadTime || "",
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `采购黄页检索_${formatDownloadDate(new Date())}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function parseBoolean(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return null;
  if (["是", "有", "true", "yes", "y", "1", "已签", "已签年框"].includes(text)) return true;
  if (["否", "无", "false", "no", "n", "0", "未签", "未签年框"].includes(text)) return false;
  return null;
}

function parseNumber(value) {
  const number = Number(String(value || "").replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function formatNumber(value) {
  return Number.isFinite(value) && value ? new Intl.NumberFormat("zh-CN").format(value) : "--";
}

function formatContract(value) {
  if (value === true) return "是";
  if (value === false) return "否";
  return "未填写";
}

function formatDownloadDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
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

function escapeCsvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function formatRegion(address) {
  const text = String(address || "").trim();
  if (!text) return "";
  const normalized = text.replace(/\s+/g, "");
  const direct = normalized.match(/^(北京市|上海市|天津市|重庆市)([^省市自治区特别行政区]{1,12}?(区|县|市))?/);
  if (direct) return `${direct[1]}${direct[2] || ""}`;
  const province = normalized.match(/^(.{2,12}?(省|自治区|特别行政区))/);
  if (!province) {
    const cityIndex = normalized.indexOf("市");
    return cityIndex > 0 ? normalized.slice(0, cityIndex + 1) : normalized.slice(0, 12);
  }
  const rest = normalized.slice(province[1].length);
  const cityIndex = rest.indexOf("市");
  if (cityIndex > 0) return `${province[1]}${rest.slice(0, cityIndex + 1)}`;
  const region = rest.match(/^(.{2,12}?(自治州|地区|盟))/);
  return `${province[1]}${region ? region[1] : ""}`;
}

function inferRegionFromSupplierName(...names) {
  const text = names.filter(Boolean).join("");
  const cityMap = new Map([
    ["常州", "江苏省常州市"],
    ["泰兴", "江苏省泰州市"],
    ["苏州", "江苏省苏州市"],
    ["无锡", "江苏省无锡市"],
    ["宁波", "浙江省宁波市"],
    ["杭州", "浙江省杭州市"],
    ["嘉兴", "浙江省嘉兴市"],
    ["金华", "浙江省金华市"],
    ["台州", "浙江省台州市"],
    ["温州", "浙江省温州市"],
    ["中山", "广东省中山市"],
    ["广州", "广东省广州市"],
    ["佛山", "广东省佛山市"],
    ["东莞", "广东省东莞市"],
    ["深圳", "广东省深圳市"],
    ["厦门", "福建省厦门市"],
    ["上海", "上海市"],
    ["北京", "北京市"],
    ["天津", "天津市"],
  ]);
  for (const [city, region] of cityMap) {
    if (text.includes(city)) return region;
  }
  const province = text.match(/(江苏|浙江|广东|福建|上海|北京|天津|山东|安徽|河北|河南|湖北|湖南|江西|四川|重庆|陕西)/)?.[1];
  if (!province) return "";
  return province.endsWith("市") ? province : `${province}省`;
}

function extractGroup(value) {
  const text = String(value || "").trim();
  const match = text.match(/([一二三四五六七八九十]+组|[0-9]+组)/);
  return match ? match[1] : text;
}

function uniqueGroupOptions(records) {
  const groups = uniqueValues(records, "group");
  const owners = uniqueValues(records, "owner").filter((owner) => !groups.includes(owner));
  return [...groups, ...owners];
}

function uniqueSuppliers(records) {
  return [...new Set(records.map((record) => record.supplierShort || record.supplier).filter(Boolean))];
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

function countBy(items, key) {
  return items.reduce((result, item) => {
    const value = item[key] || "未填写";
    result[value] = (result[value] || 0) + 1;
    return result;
  }, {});
}

function hasKnownHeader(value) {
  const header = normalizeHeader(value);
  return Object.values(columnAliases).some((aliases) => aliases.some((alias) => normalizeHeader(alias) === header));
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

function normalizeGroupKey(value) {
  const text = String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[()（）【】\\[\\]_-]/g, "")
    .toLowerCase();
  if (!text) return "";
  if (text.includes("其他配件")) return "其他配件";
  if (text.includes("一组") || text.includes("1组")) return "采购一组";
  if (text.includes("二组") || text.includes("2组")) return "采购二组";
  if (text.includes("三组") || text.includes("3组")) return "采购三组";
  if (text.includes("四组") || text.includes("4组")) return "采购四组";
  return text;
}

function openAppDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(UPLOAD_STORE_NAME)) {
        db.createObjectStore(UPLOAD_STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(DIMENSION_STORE_NAME)) {
        db.createObjectStore(DIMENSION_STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(FACT_STORE_NAME)) {
        db.createObjectStore(FACT_STORE_NAME, { keyPath: "id" });
      }
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

initSupplierDashboard().catch((error) => {
  console.error(error);
  dashboardEls.recordState.textContent = "供应商看板异常";
});
