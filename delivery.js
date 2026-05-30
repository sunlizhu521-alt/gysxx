const DB_NAME = "supply-chain-library";
const DB_VERSION = 3;
const UPLOAD_STORE_NAME = "uploaded-files";
const DIMENSION_STORE_NAME = "dimension-files";
const FACT_STORE_NAME = "fact-files";
const CATEGORY_DIMENSION_SLOT = "dimension-1";
const PURCHASE_ORDER_SLOT = "fact-1";

const deliveryState = {
  records: [],
  filtered: [],
  categoryMap: new Map(),
};

const deliveryEls = {
  businessUnitFilter: document.querySelector("#businessUnitFilter"),
  purchaseGroupFilter: document.querySelector("#purchaseGroupFilter"),
  salesLineFilter: document.querySelector("#salesLineFilter"),
  salesSeriesFilter: document.querySelector("#salesSeriesFilter"),
  resetButton: document.querySelector("#deliveryResetButton"),
  orderedQty: document.querySelector("#orderedQty"),
  shippedQty: document.querySelector("#shippedQty"),
  remainingQty: document.querySelector("#remainingQty"),
  over60Qty: document.querySelector("#over60Qty"),
  rows: document.querySelector("#deliveryRows"),
  state: document.querySelector("#deliveryState"),
};

const columnAliases = {
  businessUnit: ["事业部", "事业部名称", "业务部", "部门", "阿米巴", "所属事业部"],
  purchaseGroup: ["采购分组", "采购组", "采购组别", "组名"],
  salesLine: ["销售产品线", "一级产品线", "产品线"],
  salesSeries: ["销售系列", "系列", "产品系列"],
  materialCode: ["物料编码", "商品编码", "存货编码", "产品编码", "品号"],
  sku: ["SKU", "sku", "领星SKU"],
  itemName: ["物品名称", "物料名称", "商品名称", "存货名称", "产品名称", "金蝶名称", "品名"],
  orderedQty: ["下单数量", "采购数量", "订单数量", "订购数量", "数量"],
  shippedQty: ["已发货数量", "发货数量", "已交付数量", "已到货数量", "入库数量"],
  undeliveredQty: ["未交付数量", "欠货数量", "未发货数量", "未到货数量"],
  remainingQty: ["剩余数量", "剩余未交付", "剩余未发货", "未清数量"],
  over60Qty: ["库存超60天数量", "超60天数量", "超60天库存", "库龄超60天数量"],
};

async function initDeliveryDashboard() {
  bindDeliveryEvents();
  if (window.ensureSharedLibraryLoaded) {
    await window.ensureSharedLibraryLoaded();
  }
  await loadDeliverySource();
}

function bindDeliveryEvents() {
  [
    deliveryEls.businessUnitFilter,
    deliveryEls.purchaseGroupFilter,
    deliveryEls.salesLineFilter,
    deliveryEls.salesSeriesFilter,
  ].forEach((select) => select.addEventListener("input", applyDeliveryFilters));

  deliveryEls.resetButton.addEventListener("click", () => {
    deliveryEls.businessUnitFilter.value = "all";
    deliveryEls.purchaseGroupFilter.value = "all";
    deliveryEls.salesLineFilter.value = "all";
    deliveryEls.salesSeriesFilter.value = "all";
    applyDeliveryFilters();
  });
}

async function loadDeliverySource() {
  try {
    const db = await openAppDb();
    const [factRecord, categoryRecord] = await Promise.all([
      getRecord(db, FACT_STORE_NAME, PURCHASE_ORDER_SLOT),
      getRecord(db, DIMENSION_STORE_NAME, CATEGORY_DIMENSION_SLOT),
    ]);
    db.close();

    if (!factRecord?.file) {
      resetDelivery("请先在备货事实表库上传并应用采购订单跟进表");
      return;
    }

    if (!factRecord.applied) {
      resetDelivery("采购订单跟进表待应用刷新");
      return;
    }

    deliveryState.categoryMap = categoryRecord?.file ? await readCategoryDimension(categoryRecord.file) : new Map();
    deliveryState.records = enrichDeliveryRecords(parseRows(await readWorkbookRows(factRecord.file)), deliveryState.categoryMap);
    hydrateDeliveryFilters();
    applyDeliveryFilters();
  } catch (error) {
    console.error(error);
    resetDelivery("供应商交付信息读取失败");
  }
}

function resetDelivery(message) {
  deliveryState.records = [];
  deliveryState.filtered = [];
  hydrateDeliveryFilters();
  renderDelivery(message);
}

async function readCategoryDimension(file) {
  const rows = await readWorkbookRows(file);
  const map = new Map();
  rows.slice(1).forEach((row) => {
    const materialCode = normalizeMaterialCode(row[0]);
    if (!materialCode) return;
    map.set(materialCode, {
      salesLine: String(row[6] ?? "").trim(),
      salesSeries: String(row[7] ?? "").trim(),
      purchaseGroup: String(row[20] ?? "").trim(),
    });
  });
  return map;
}

async function readWorkbookRows(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") {
    return csvToRows(await file.text());
  }
  if (!window.XLSX) {
    throw new Error("XLSX parser is not available.");
  }
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheetName = chooseSheetName(workbook.SheetNames);
  return window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
}

function chooseSheetName(sheetNames) {
  return (
    sheetNames.find((name) => /订单|跟进|明细/.test(name)) ||
    sheetNames.find((name) => /产品线明细/.test(name)) ||
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
    .filter((record) => record.materialCode || record.sku || record.itemName);
}

function normalizeRow(row, headerMap, index) {
  const getValue = (key, fallbackIndex) => {
    const columnIndex = headerMap[key] ?? fallbackIndex;
    return columnIndex === undefined ? "" : String(row[columnIndex] ?? "").trim();
  };
  const orderedQty = parseNumber(getValue("orderedQty"));
  const shippedQty = parseNumber(getValue("shippedQty"));
  const fallbackRemaining = Math.max(orderedQty - shippedQty, 0);
  const remainingQty = parseNumber(getValue("remainingQty")) || fallbackRemaining;
  const undeliveredQty = parseNumber(getValue("undeliveredQty")) || remainingQty;

  return {
    id: `${index}-${getValue("materialCode")}-${getValue("sku")}`,
    businessUnit: getValue("businessUnit"),
    purchaseGroup: getValue("purchaseGroup"),
    salesLine: getValue("salesLine"),
    salesSeries: getValue("salesSeries"),
    materialCode: getValue("materialCode", 3),
    sku: getValue("sku", 4),
    itemName: getValue("itemName", 5),
    orderedQty,
    shippedQty,
    undeliveredQty,
    remainingQty,
    over60Qty: parseNumber(getValue("over60Qty")),
  };
}

function enrichDeliveryRecords(records, categoryMap) {
  return records.map((record) => {
    const matched = categoryMap.get(normalizeMaterialCode(record.materialCode));
    return {
      ...record,
      salesLine: matched?.salesLine || record.salesLine || "未匹配",
      salesSeries: matched?.salesSeries || record.salesSeries || "未匹配",
      purchaseGroup: matched?.purchaseGroup || record.purchaseGroup || "未匹配",
      businessUnit: record.businessUnit || "未匹配",
    };
  });
}

function hydrateDeliveryFilters() {
  fillSelect(deliveryEls.businessUnitFilter, uniqueValues(deliveryState.records, "businessUnit"), "全部事业部");
  fillSelect(deliveryEls.purchaseGroupFilter, uniqueValues(deliveryState.records, "purchaseGroup"), "全部采购分组");
  fillSelect(deliveryEls.salesLineFilter, uniqueValues(deliveryState.records, "salesLine"), "全部销售产品线");
  fillSelect(deliveryEls.salesSeriesFilter, uniqueValues(deliveryState.records, "salesSeries"), "全部销售系列");
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

function applyDeliveryFilters() {
  const businessUnit = deliveryEls.businessUnitFilter.value;
  const purchaseGroup = deliveryEls.purchaseGroupFilter.value;
  const salesLine = deliveryEls.salesLineFilter.value;
  const salesSeries = deliveryEls.salesSeriesFilter.value;

  deliveryState.filtered = deliveryState.records.filter(
    (record) =>
      (businessUnit === "all" || record.businessUnit === businessUnit) &&
      (purchaseGroup === "all" || record.purchaseGroup === purchaseGroup) &&
      (salesLine === "all" || record.salesLine === salesLine) &&
      (salesSeries === "all" || record.salesSeries === salesSeries)
  );
  renderDelivery();
}

function renderDelivery(message) {
  const records = deliveryState.filtered;
  deliveryEls.orderedQty.textContent = formatNumber(sumBy(records, "orderedQty"));
  deliveryEls.shippedQty.textContent = formatNumber(sumBy(records, "shippedQty"));
  deliveryEls.remainingQty.textContent = formatNumber(sumBy(records, "remainingQty"));
  deliveryEls.over60Qty.textContent = formatNumber(sumBy(records, "over60Qty"));
  deliveryEls.state.textContent = message || (records.length ? `已匹配 ${records.length} 行` : "暂无匹配数据");

  deliveryEls.rows.innerHTML = records.length
    ? records.map(renderDeliveryRow).join("")
    : `<tr><td colspan="6">${escapeHtml(message || "暂无匹配数据")}</td></tr>`;
}

function renderDeliveryRow(record) {
  return `
    <tr>
      <td>${escapeHtml(record.materialCode || "--")}</td>
      <td>${escapeHtml(record.sku || "--")}</td>
      <td>${escapeHtml(record.itemName || "--")}</td>
      <td>${formatNumber(record.orderedQty)}</td>
      <td>${formatNumber(record.undeliveredQty)}</td>
      <td>${formatNumber(record.remainingQty)}</td>
    </tr>
  `;
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

function hasKnownHeader(value) {
  const header = normalizeHeader(value);
  return Object.values(columnAliases).some((aliases) => aliases.some((alias) => normalizeHeader(alias) === header));
}

function uniqueValues(items, key) {
  return [...new Set(items.map((item) => item[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "zh-CN"));
}

function sumBy(items, key) {
  return items.reduce((sum, item) => sum + (Number(item[key]) || 0), 0);
}

function parseNumber(value) {
  const number = Number(String(value || "").replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value) || 0);
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
