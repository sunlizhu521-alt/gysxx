const DB_NAME = "supply-chain-library";
const DB_VERSION = 3;
const STORE_NAME = "uploaded-files";
const DIMENSION_STORE_NAME = "dimension-files";
const FACT_STORE_NAME = "fact-files";
const FILE_KEY = "current-file";

const supplierState = {
  selectedFile: null,
  applied: false,
  records: [],
  filtered: [],
};

const uploadEls = {
  fileInput: document.querySelector("#fileInput"),
  uploadDropzone: document.querySelector("#uploadDropzone"),
  uploadState: document.querySelector("#uploadState"),
  fileName: document.querySelector("#fileName"),
  fileSize: document.querySelector("#fileSize"),
  fileType: document.querySelector("#fileType"),
  applyStatus: document.querySelector("#applyStatus"),
  applyButton: document.querySelector("#applyButton"),
  deleteButton: document.querySelector("#deleteButton"),
};

const dashboardEls = {
  search: document.querySelector("#supplierSearch"),
  productLineFilter: document.querySelector("#productLineFilter"),
  ownerFilter: document.querySelector("#ownerFilter"),
  supplierCount: document.querySelector("#supplierCount"),
  materialCount: document.querySelector("#materialCount"),
  productLineCount: document.querySelector("#productLineCount"),
  missingCount: document.querySelector("#missingCount"),
  productLineBars: document.querySelector("#productLineBars"),
  ownerBars: document.querySelector("#ownerBars"),
  rows: document.querySelector("#supplierRows"),
  recordState: document.querySelector("#recordState"),
  resetButton: document.querySelector("#resetButton"),
};

const columnAliases = {
  supplier: ["供应商", "供应商名称", "供应商编码", "厂家", "厂商", "供方"],
  materialCode: ["物料编码", "商品编码", "存货编码", "SKU", "sku", "货品编号", "产品编码"],
  materialName: ["物料名称", "商品名称", "存货名称", "产品名称", "品名"],
  productLine: ["销售产品线", "产品线", "事业部", "分类", "商品分类"],
  owner: ["采购负责人", "采购员", "采购", "负责人", "维护人", "组员", "事业部唯一对接人"],
  status: ["状态", "供应商状态", "启用状态"],
};

async function initUpload() {
  bindUploadEvents();
  await restoreSavedFile();
}

function bindUploadEvents() {
  uploadEls.fileInput.addEventListener("change", async (event) => {
    await handleSelectedFile(event.target.files[0]);
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    uploadEls.uploadDropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      uploadEls.uploadDropzone.classList.add("dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    uploadEls.uploadDropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      uploadEls.uploadDropzone.classList.remove("dragging");
    });
  });

  uploadEls.uploadDropzone.addEventListener("drop", async (event) => {
    await handleSelectedFile(event.dataTransfer.files[0]);
  });

  uploadEls.applyButton.addEventListener("click", async () => {
    if (!supplierState.selectedFile) return;
    supplierState.applied = true;
    await saveCurrentFile();
    await parseAppliedFile();
    renderFileState();
  });

  uploadEls.deleteButton.addEventListener("click", async () => {
    await deleteSavedFile();
    supplierState.selectedFile = null;
    supplierState.applied = false;
    supplierState.records = [];
    supplierState.filtered = [];
    uploadEls.fileInput.value = "";
    renderFileState();
    hydrateFilters();
    renderDashboard();
  });

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

async function handleSelectedFile(file) {
  if (!file) return;
  supplierState.selectedFile = file;
  supplierState.applied = false;
  supplierState.records = [];
  supplierState.filtered = [];
  await saveCurrentFile();
  renderFileState();
  hydrateFilters();
  renderDashboard();
}

async function restoreSavedFile() {
  const record = await readSavedFile();
  if (!record?.file) {
    renderFileState();
    hydrateFilters();
    renderDashboard();
    return;
  }

  supplierState.selectedFile = record.file;
  supplierState.applied = Boolean(record.applied);
  if (supplierState.applied) {
    await parseAppliedFile();
  }
  renderFileState();
}

function renderFileState() {
  const file = supplierState.selectedFile;
  if (!file) {
    uploadEls.fileName.textContent = "未选择";
    uploadEls.fileSize.textContent = "--";
    uploadEls.fileType.textContent = "--";
    uploadEls.applyStatus.textContent = "未应用";
    uploadEls.uploadState.textContent = "等待上传";
    uploadEls.applyButton.disabled = true;
    uploadEls.deleteButton.disabled = true;
    return;
  }

  uploadEls.fileName.textContent = file.name;
  uploadEls.fileSize.textContent = formatFileSize(file.size);
  uploadEls.fileType.textContent = getFileTypeLabel(file);
  uploadEls.applyStatus.textContent = supplierState.applied ? "已应用" : "待应用";
  uploadEls.uploadState.textContent = supplierState.applied ? "看板已刷新" : "文件已保存";
  uploadEls.applyButton.disabled = supplierState.applied;
  uploadEls.deleteButton.disabled = false;
}

async function parseAppliedFile() {
  if (!supplierState.selectedFile) return;
  try {
    supplierState.records = await readSupplierRecords(supplierState.selectedFile);
    hydrateFilters();
    applyDashboardFilters();
  } catch (error) {
    console.error(error);
    supplierState.records = [];
    supplierState.filtered = [];
    dashboardEls.recordState.textContent = "文件解析失败";
    renderDashboard();
  }
}

async function readSupplierRecords(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") {
    return parseRows(csvToRows(await file.text()));
  }
  if (!window.XLSX) {
    throw new Error("XLSX parser is not available.");
  }
  const buffer = await file.arrayBuffer();
  const workbook = window.XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  return parseRows(rows);
}

function parseRows(rows) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => normalizeHeader(cell)));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((cell) => String(cell || "").trim());
  const headerMap = createHeaderMap(headers);

  return rows
    .slice(headerIndex + 1)
    .map((row, index) => {
      const getValue = (key) => {
        const columnIndex = headerMap[key];
        return columnIndex === undefined ? "" : String(row[columnIndex] ?? "").trim();
      };
      const supplier = getValue("supplier");
      const materialCode = getValue("materialCode");
      const materialName = getValue("materialName");
      const productLine = getValue("productLine") || "未分类";
      const owner = getValue("owner") || "未分配";
      const status = getValue("status") || "正常";
      return {
        id: `${index}-${supplier}-${materialCode}`,
        supplier,
        materialCode,
        materialName,
        productLine,
        owner,
        status,
        isMissing: !supplier || !materialCode,
      };
    })
    .filter((record) => record.supplier || record.materialCode || record.materialName || record.productLine !== "未分类" || record.owner !== "未分配");
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
  fillSelect(dashboardEls.productLineFilter, uniqueValues(supplierState.records, "productLine"), "全部产品线");
  fillSelect(dashboardEls.ownerFilter, uniqueValues(supplierState.records, "owner"), "全部负责人");
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
    const searchable = [record.supplier, record.materialCode, record.materialName, record.productLine, record.owner, record.status]
      .join(" ")
      .toLowerCase();
    return (
      (!query || searchable.includes(query)) &&
      (productLine === "all" || record.productLine === productLine) &&
      (owner === "all" || record.owner === owner)
    );
  });
  renderDashboard();
}

function renderDashboard() {
  const all = supplierState.records;
  const visible = supplierState.filtered;
  dashboardEls.supplierCount.textContent = uniqueValues(all, "supplier").filter(Boolean).length;
  dashboardEls.materialCount.textContent = uniqueValues(all, "materialCode").filter(Boolean).length;
  dashboardEls.productLineCount.textContent = uniqueValues(all, "productLine").filter(Boolean).length;
  dashboardEls.missingCount.textContent = all.filter((record) => record.isMissing).length;
  dashboardEls.recordState.textContent = all.length ? `当前 ${visible.length} / ${all.length} 条` : "等待数据";
  renderBars(dashboardEls.productLineBars, countBy(visible, "productLine"), "暂无产品线数据");
  renderBars(dashboardEls.ownerBars, countBy(visible, "owner"), "暂无负责人数据");
  renderRows(visible);
}

function renderBars(container, counts, emptyText) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!entries.length) {
    container.innerHTML = `<div class="empty-state compact-empty">${emptyText}</div>`;
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

function renderRows(records) {
  if (!records.length) {
    dashboardEls.rows.innerHTML = `<tr><td colspan="6" class="empty-table-cell">应用供应商信息文件后显示明细</td></tr>`;
    return;
  }
  dashboardEls.rows.innerHTML = records
    .slice(0, 300)
    .map(
      (record) => `
        <tr>
          <td><strong>${escapeHtml(record.supplier || "未填写")}</strong></td>
          <td>${escapeHtml(record.materialCode || "--")}</td>
          <td>${escapeHtml(record.materialName || "--")}</td>
          <td><span class="tag-chip">${escapeHtml(record.productLine)}</span></td>
          <td>${escapeHtml(record.owner)}</td>
          <td><span class="badge ${record.isMissing ? "risk-mid" : "status-active"}">${record.isMissing ? "待完善" : escapeHtml(record.status)}</span></td>
        </tr>
      `
    )
    .join("");
}

async function saveCurrentFile() {
  if (!supplierState.selectedFile) return;
  const db = await openUploadDb();
  await putRecord(db, {
    id: FILE_KEY,
    file: supplierState.selectedFile,
    applied: supplierState.applied,
    savedAt: new Date().toISOString(),
  });
  db.close();
}

async function readSavedFile() {
  const db = await openUploadDb();
  const record = await getRecord(db, FILE_KEY);
  db.close();
  return record;
}

async function deleteSavedFile() {
  const db = await openUploadDb();
  await deleteRecord(db, FILE_KEY);
  db.close();
}

function openUploadDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
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

function putRecord(db, record) {
  return runStoreRequest(db, "readwrite", (store) => store.put(record));
}

function getRecord(db, key) {
  return runStoreRequest(db, "readonly", (store) => store.get(key));
}

function deleteRecord(db, key) {
  return runStoreRequest(db, "readwrite", (store) => store.delete(key));
}

function runStoreRequest(db, mode, createRequest) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = createRequest(transaction.objectStore(STORE_NAME));
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

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "--";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function getFileTypeLabel(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "xlsx" || extension === "xls") return "Excel 工作簿";
  if (extension === "csv") return "CSV 文件";
  return file.type || "未知类型";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

initUpload().catch((error) => {
  console.error(error);
  uploadEls.uploadState.textContent = "供应商看板异常";
});
