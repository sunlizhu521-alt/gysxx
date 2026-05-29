const DB_NAME = "supply-chain-library";
const DB_VERSION = 3;
const UPLOAD_STORE_NAME = "uploaded-files";
const DIMENSION_STORE_NAME = "dimension-files";
const FACT_STORE_NAME = "fact-files";
const PURCHASE_ASSIGNMENT_SLOT = "dimension-6";
const LONG_LEAD_DAYS = 45;
const HIGH_MOQ = 200;

const supplierState = {
  records: [],
  filtered: [],
};

const dashboardEls = {
  search: document.querySelector("#supplierSearch"),
  productLineFilter: document.querySelector("#productLineFilter"),
  ownerFilter: document.querySelector("#ownerFilter"),
  skuCount: document.querySelector("#skuCount"),
  activeSupplierCount: document.querySelector("#activeSupplierCount"),
  contractRate: document.querySelector("#contractRate"),
  riskCount: document.querySelector("#riskCount"),
  groupBars: document.querySelector("#groupBars"),
  productLineBars: document.querySelector("#productLineBars"),
  paymentBars: document.querySelector("#paymentBars"),
  leadTimeList: document.querySelector("#leadTimeList"),
  moqList: document.querySelector("#moqList"),
  rows: document.querySelector("#supplierRows"),
  recordState: document.querySelector("#recordState"),
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
}

async function loadPurchaseAssignmentSource() {
  try {
    const db = await openAppDb();
    const record = await getRecord(db, DIMENSION_STORE_NAME, PURCHASE_ASSIGNMENT_SLOT);
    db.close();

    if (!record?.file) {
      resetDashboard("请先在维度表文件库上传并应用采购分工明细");
      return;
    }

    if (!record.applied) {
      resetDashboard("采购分工明细待应用刷新");
      return;
    }

    supplierState.records = await readSupplierRecords(record.file);
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
  hydrateFilters();
  renderDashboard(message);
}

async function readSupplierRecords(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") {
    return parseRows(csvToRows(await file.text()));
  }
  if (!window.XLSX) {
    throw new Error("XLSX parser is not available.");
  }
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheetName = chooseSheetName(workbook.SheetNames);
  const sheet = workbook.Sheets[sheetName];
  const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  return parseRows(rows);
}

function chooseSheetName(sheetNames) {
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
    riskLevel: getRiskLevel(moq, leadTime),
  };
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
  fillSelect(dashboardEls.productLineFilter, uniqueValues(supplierState.records, "primaryLine"), "全部产品线");
  fillSelect(dashboardEls.ownerFilter, uniqueGroupOptions(supplierState.records), "全部采购组/对接人");
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
      record.owner,
      record.materialCode,
      record.sku,
      record.materialName,
      record.supplier,
      record.supplierShort,
      record.paymentTerm,
      record.contact,
      record.phone,
    ]
      .join(" ")
      .toLowerCase();
    return (
      (!query || searchable.includes(query)) &&
      (productLine === "all" || record.primaryLine === productLine) &&
      (owner === "all" || record.group === owner || record.owner === owner)
    );
  });
  renderDashboard();
}

function renderDashboard(message) {
  const all = supplierState.records;
  const visible = supplierState.filtered;
  const riskItems = visible.filter((record) => record.riskLevel !== "low");
  const contractKnown = visible.filter((record) => record.hasContract !== null);
  const contractYes = contractKnown.filter((record) => record.hasContract).length;

  dashboardEls.skuCount.textContent = visible.length || all.length || 0;
  dashboardEls.activeSupplierCount.textContent = uniqueSuppliers(visible.length ? visible : all).length;
  dashboardEls.contractRate.textContent = contractKnown.length ? `${Math.round((contractYes / contractKnown.length) * 100)}%` : "--";
  dashboardEls.riskCount.textContent = riskItems.length;
  dashboardEls.recordState.textContent = message || (all.length ? `当前 ${visible.length} / ${all.length} 条` : "等待数据");

  renderBars(dashboardEls.groupBars, countBy(visible, "group"), message || "暂无采购组数据");
  renderBars(dashboardEls.productLineBars, countBy(visible, "primaryLine"), message || "暂无产品线数据");
  renderBars(dashboardEls.paymentBars, countBy(visible, "paymentTerm"), message || "暂无账期数据");
  renderRiskList(dashboardEls.leadTimeList, getLeadTimeRisks(visible), "暂无长周期风险");
  renderRiskList(dashboardEls.moqList, getMoqRisks(visible), "暂无高 MOQ 风险");
  renderRows(visible, message);
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
      ([label, count]) => `
        <div class="bar-row">
          <span title="${escapeHtml(label)}">${escapeHtml(label)}</span>
          <span class="bar-track"><span class="bar-fill" style="width: ${(count / max) * 100}%"></span></span>
          <strong>${count}</strong>
        </div>
      `
    )
    .join("");
}

function renderRiskList(container, records, emptyText) {
  if (!records.length) {
    container.innerHTML = `<div class="empty-state compact-empty">${escapeHtml(emptyText)}</div>`;
    return;
  }
  container.innerHTML = records
    .slice(0, 6)
    .map(
      (record) => `
        <div class="risk-item ${record.riskLevel}">
          <strong>${escapeHtml(record.materialCode || record.sku || record.materialName || record.primaryLine)}</strong>
          <span>${escapeHtml(record.supplierShort || record.supplier || record.owner)} · MOQ ${formatNumber(record.moq)} · ${formatNumber(record.leadTime)} 天</span>
        </div>
      `
    )
    .join("");
}

function renderRows(records, message) {
  if (!records.length) {
    dashboardEls.rows.innerHTML = `<tr><td colspan="11" class="empty-table-cell">${escapeHtml(
      message || "采购分工明细应用后显示采购黄页"
    )}</td></tr>`;
    return;
  }
  dashboardEls.rows.innerHTML = records
    .slice(0, 300)
    .map(
      (record) => `
        <tr>
          <td>
            <span class="doc-name">
              <strong>${escapeHtml(record.primaryLine)}</strong>
              <small>${escapeHtml(record.secondaryLine || "--")}</small>
            </span>
          </td>
          <td>${escapeHtml(record.group || record.owner || "--")}</td>
          <td>${escapeHtml(record.materialCode || "--")}</td>
          <td>${escapeHtml(record.sku || "--")}</td>
          <td>${escapeHtml(record.materialName || "--")}</td>
          <td>${escapeHtml(record.supplierShort || record.supplier || "--")}</td>
          <td>${escapeHtml(record.paymentTerm)}</td>
          <td>${formatNumber(record.moq)}</td>
          <td><span class="badge ${record.leadTime > LONG_LEAD_DAYS ? "risk-mid" : "status-active"}">${formatNumber(record.leadTime)} 天</span></td>
          <td>${escapeHtml(record.contact || "--")}</td>
          <td>${escapeHtml(record.phone || "--")}</td>
        </tr>
      `
    )
    .join("");
}

function getLeadTimeRisks(records) {
  return records
    .filter((record) => record.leadTime > LONG_LEAD_DAYS)
    .sort((a, b) => b.leadTime - a.leadTime);
}

function getMoqRisks(records) {
  return records
    .filter((record) => record.moq >= HIGH_MOQ)
    .sort((a, b) => b.moq - a.moq);
}

function getRiskLevel(moq, leadTime) {
  if (leadTime > 60 || moq >= 500) return "high";
  if (leadTime > LONG_LEAD_DAYS || moq >= HIGH_MOQ) return "mid";
  return "low";
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
