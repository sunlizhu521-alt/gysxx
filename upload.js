const DB_NAME = "supply-chain-library";
const DB_VERSION = 3;
const UPLOAD_STORE_NAME = "uploaded-files";
const DIMENSION_STORE_NAME = "dimension-files";
const FACT_STORE_NAME = "fact-files";
const CATEGORY_DIMENSION_SLOT = "dimension-1";
const PURCHASE_ASSIGNMENT_SLOT = "dimension-6";
const PURCHASE_GROUP_ORDER = ["采购一组", "采购二组", "采购三组", "采购四组", "其他配件"];
const BAR_COLORS = ["#2f6fed", "#159a9c", "#6957d6", "#2f9e44", "#d98b11", "#d64545", "#0f766e", "#7c3aed", "#2563eb", "#ea580c"];
const DIVISION_DISPLAY_COLUMNS = ["组名", "事业部唯一对接人", "组员", "负责事项"];

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
  skuCount: document.querySelector("#skuCount"),
  activeSupplierCount: document.querySelector("#activeSupplierCount"),
  supplierInfoRows: document.querySelector("#supplierInfoRows"),
  divisionInfoHead: document.querySelector("#divisionInfoHead"),
  divisionInfoRows: document.querySelector("#divisionInfoRows"),
  productLineBars: document.querySelector("#productLineBars"),
  rows: document.querySelector("#supplierRows"),
  recordState: document.querySelector("#recordState"),
  downloadButton: document.querySelector("#downloadButton"),
  resetButton: document.querySelector("#resetButton"),
};

const columnAliases = {
  primaryLine: ["一级产品线", "产品线", "销售产品线", "大类"],
  secondaryLine: ["二级产品线", "细分产品线", "品类", "商品分类"],
  owner: ["对接人", "采购负责人", "采购员", "采购", "组员", "事业部唯一对接人", "负责人"],
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
  if (window.ensureSharedLibraryLoaded) {
    await window.ensureSharedLibraryLoaded();
  }
  await loadPurchaseAssignmentSource();
}

function bindDashboardEvents() {
  [dashboardEls.search, dashboardEls.productLineFilter, dashboardEls.ownerFilter].forEach((el) => {
    el.addEventListener("input", applyDashboardFilters);
  });

  dashboardEls.resetButton.addEventListener("click", () => {
    dashboardEls.search.value = "";
    dashboardEls.productLineFilter.value = "all";
    dashboardEls.ownerFilter.value = "all";
    applyDashboardFilters();
  });

  dashboardEls.downloadButton.addEventListener("click", downloadCurrentRows);
}

async function loadPurchaseAssignmentSource() {
  try {
    const db = await openAppDb();
    const [purchaseRecord, categoryRecord] = await Promise.all([
      getRecord(db, DIMENSION_STORE_NAME, PURCHASE_ASSIGNMENT_SLOT),
      getRecord(db, DIMENSION_STORE_NAME, CATEGORY_DIMENSION_SLOT),
    ]);
    db.close();

    if (!purchaseRecord?.file) {
      resetDashboard("请先在维度表文件库上传并应用采购分工明细");
      return;
    }

    if (!purchaseRecord.applied) {
      resetDashboard("采购分工明细待应用刷新");
      return;
    }

    if (!categoryRecord?.file) {
      resetDashboard("请先在维度表文件库上传并应用Dim-YL医疗器械商品分类");
      return;
    }

    if (!categoryRecord.applied) {
      resetDashboard("Dim-YL医疗器械商品分类待应用刷新");
      return;
    }

    supplierState.categoryMap = await readCategoryDimension(categoryRecord.file);
    const { records, divisionRows, divisionHeaders } = await readSupplierRecords(purchaseRecord.file);
    supplierState.records = enrichSupplierRecords(records, supplierState.categoryMap);
    supplierState.divisionRows = enrichDivisionRows(divisionRows, supplierState.categoryMap, divisionHeaders);
    supplierState.divisionHeaders = divisionHeaders;
    hydrateFilters();
    applyDashboardFilters();
  } catch (error) {
    console.error(error);
    resetDashboard("采购分工明细读取失败");
  }
}

function resetDashboard(message) {
  supplierState.records = [];
  supplierState.filtered = [];
  supplierState.categoryMap = new Map();
  supplierState.divisionRows = [];
  supplierState.divisionHeaders = [];
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
  const moq = parseNumber(getValue("moq", 10));
  const leadTime = parseNumber(getValue("leadTime", 11));
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
    purchasePrice: parseNumber(getValue("purchasePrice", 8)),
    unitPrice: parseNumber(getValue("unitPrice", 9)),
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
      region: formatRegion(record.address),
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

function hydrateFilters() {
  fillSelect(dashboardEls.productLineFilter, uniqueValues(supplierState.records, "dimProductLine"), "全部产品线");
  fillSelect(dashboardEls.ownerFilter, sortPurchaseGroups(uniqueValues(supplierState.records, "dimPurchaseGroup")), "全部采购组");
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
  const query = dashboardEls.search.value.trim().toLowerCase();
  const productLine = dashboardEls.productLineFilter.value;
  const owner = dashboardEls.ownerFilter.value;

  supplierState.filtered = supplierState.records.filter((record) => {
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
      (!query || searchable.includes(query)) &&
      (productLine === "all" || record.dimProductLine === productLine) &&
      (owner === "all" || record.dimPurchaseGroup === owner)
    );
  });
  renderDashboard();
}

function getProductLineDistributionRecords() {
  const query = dashboardEls.search.value.trim().toLowerCase();
  const owner = dashboardEls.ownerFilter.value;
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
    return (!query || searchable.includes(query)) && (owner === "all" || record.dimPurchaseGroup === owner);
  });
}

function renderDashboard(message) {
  const all = supplierState.records;
  const visible = supplierState.filtered;
  const productLineDistribution = getProductLineDistributionRecords();

  dashboardEls.skuCount.textContent = visible.length || all.length || 0;
  dashboardEls.activeSupplierCount.textContent = uniqueSuppliers(visible.length ? visible : all).length;
  dashboardEls.recordState.textContent = message || (all.length ? `当前 ${visible.length} / ${all.length} 条` : "等待数据");
  dashboardEls.downloadButton.disabled = Boolean(message) || !visible.length;

  renderSupplierInfo(dashboardEls.supplierInfoRows, visible, message);
  renderDivisionInfo(dashboardEls.divisionInfoHead, dashboardEls.divisionInfoRows, getVisibleDivisionRows(), supplierState.divisionHeaders, message);
  renderBars(dashboardEls.productLineBars, countBy(productLineDistribution, "dimProductLine"), message || "暂无产品线数据");
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
  const owner = dashboardEls.ownerFilter.value;
  if (owner !== "all") {
    const ownerKey = normalizeGroupKey(owner);
    return supplierState.divisionRows.filter((row) => row.groupKey === ownerKey || normalizeGroupKey(row.matchedPurchaseGroup) === ownerKey);
  }
  return supplierState.divisionRows;
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
