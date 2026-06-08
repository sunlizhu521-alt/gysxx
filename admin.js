const DB_NAME = "supply-chain-library";
const DB_VERSION = 3;
const LOCAL_LIBRARY_SOURCE = "local-upload";
const LIBRARY_UNLOCK_KEYS = ["dimension-library-key-unlocked-v2", "fact-library-key-unlocked-v2"];
const KINGDEE_ORDER_SLOT = "fact-2";
const MAX_EXTRACT_SHEET_ROWS = 120000;
const MAX_EXTRACT_SHEET_COLUMNS = 80;

const librarySlots = [
  {
    store: "dimension-files",
    id: "dimension-1",
    library: "\u7ef4\u5ea6\u8868",
    label: "Dim-YL\u533b\u7597\u5668\u68b0\u5546\u54c1\u5206\u7c7b",
  },
  {
    store: "dimension-files",
    id: "dimension-6",
    library: "\u7ef4\u5ea6\u8868",
    label: "Dim-\u91c7\u8d2d\u5206\u5de5\u660e\u7ec6",
  },
  {
    store: "fact-files",
    id: "fact-1",
    library: "\u4e8b\u5b9e\u8868",
    label: "Fac-\u91c7\u8d2d\u8ba2\u5355\u8ddf\u8fdb\u8868",
  },
  {
    store: "fact-files",
    id: "fact-2",
    library: "\u4e8b\u5b9e\u8868",
    label: "Fac-\u91d1\u8776\u91c7\u8d2d\u8ba2\u5355\u5217\u8868",
  },
];

const adminEls = {
  slots: document.querySelector("#adminLibrarySlots"),
  applyAllButton: document.querySelector("#applyAllButton"),
  clearCacheButton: document.querySelector("#clearLibraryCacheButton"),
  referenceState: document.querySelector("#adminReferenceState"),
  referenceRows: document.querySelector("#adminReferenceRows"),
};

const adminState = {
  records: new Map(),
};

function bindAdminEvents() {
  adminEls.slots.addEventListener("change", async (event) => {
    const input = event.target.closest("[data-admin-upload]");
    if (!input) return;
    await saveFile(input.dataset.adminUpload, input.files[0]);
    input.value = "";
  });

  adminEls.slots.addEventListener("click", async (event) => {
    const applyButton = event.target.closest("[data-admin-apply]");
    if (applyButton) {
      await applySlot(applyButton.dataset.adminApply);
      return;
    }

    const deleteButton = event.target.closest("[data-admin-delete]");
    if (deleteButton) {
      await deleteSlot(deleteButton.dataset.adminDelete);
    }
  });

  adminEls.slots.addEventListener("dragover", (event) => {
    const card = event.target.closest("[data-admin-drop]");
    if (!card) return;
    event.preventDefault();
    card.classList.add("drag-over");
  });

  adminEls.slots.addEventListener("dragleave", (event) => {
    const card = event.target.closest("[data-admin-drop]");
    if (!card || card.contains(event.relatedTarget)) return;
    card.classList.remove("drag-over");
  });

  adminEls.slots.addEventListener("drop", async (event) => {
    const card = event.target.closest("[data-admin-drop]");
    if (!card) return;
    event.preventDefault();
    card.classList.remove("drag-over");
    const file = event.dataTransfer?.files?.[0];
    await saveFile(card.dataset.adminDrop, file);
  });

  adminEls.clearCacheButton.addEventListener("click", clearLibraryCache);
  adminEls.applyAllButton.addEventListener("click", applyAllSlots);
}

async function refreshAdmin() {
  const db = await openAppDb();
  const entries = await Promise.all(
    librarySlots.map(async (slot) => [slot.id, await getRecord(db, slot.store, slot.id)])
  );
  db.close();
  adminState.records = new Map(entries);
  renderLibrarySlots();
  renderReferenceRows();
}

async function saveFile(slotId, file) {
  if (!file) return;
  const slot = getSlot(slotId);
  if (slotId === KINGDEE_ORDER_SLOT && !isLightKingdeeFile(file)) {
    window.alert("Fac-金蝶采购订单列表请上传轻量CSV文件。原始Excel请先用转换脚本处理后再上传。");
    return;
  }
  const savedAt = new Date().toISOString();
  const existing = adminState.records.get(slotId) || { id: slotId };
  const record = {
    ...existing,
    id: slotId,
    pendingFile: file,
    pendingName: file.name,
    pendingSize: file.size,
    pendingTypeLabel: getFileTypeLabel(file),
    pendingRefreshMonth: getMonthFromDate(savedAt),
    pendingSavedAt: savedAt,
    pendingLibrarySource: LOCAL_LIBRARY_SOURCE,
  };
  const db = await openAppDb();
  await putRecord(db, slot.store, record);
  db.close();
  await refreshAdmin();
}

async function applySlot(slotId, options = {}) {
  const slot = getSlot(slotId);
  const record = adminState.records.get(slotId);
  if (!record) return;
  const appliedAt = new Date().toISOString();
  const extractFields = record.pendingFile ? await buildSlotExtractFields(slotId, record, appliedAt) : {};
  const updatedRecord = record.pendingFile
    ? clearPendingFields({
        ...record,
        file: record.pendingFile,
        name: record.pendingName,
        size: record.pendingSize,
        typeLabel: record.pendingTypeLabel,
        refreshMonth: record.pendingRefreshMonth,
        savedAt: record.pendingSavedAt,
        librarySource: LOCAL_LIBRARY_SOURCE,
        applied: true,
        appliedAt,
        ...extractFields,
      })
    : {
        ...record,
        librarySource: record.librarySource || LOCAL_LIBRARY_SOURCE,
        applied: true,
        appliedAt,
      };
  const db = await openAppDb();
  await putRecord(db, slot.store, updatedRecord);
  db.close();
  if (!options.skipRefresh) await refreshAdmin();
}

async function applyAllSlots() {
  const slotIds = librarySlots
    .filter((slot) => {
      const record = adminState.records.get(slot.id);
      return record?.pendingFile || (record && !record.applied);
    })
    .map((slot) => slot.id);
  if (!slotIds.length) return;
  adminEls.applyAllButton.disabled = true;
  adminEls.referenceState.textContent = "\u5e94\u7528\u4e2d";
  try {
    for (const slotId of slotIds) {
      await applySlot(slotId, { skipRefresh: true });
    }
    await refreshAdmin();
    adminEls.referenceState.textContent = "\u5df2\u4e00\u952e\u5e94\u7528";
  } catch (error) {
    console.warn("apply all slots failed", error);
    adminEls.referenceState.textContent = "\u4e00\u952e\u5e94\u7528\u5931\u8d25";
  } finally {
    updateApplyAllButton();
  }
}

async function buildSlotExtractFields(slotId, record, appliedAt) {
  if (slotId !== KINGDEE_ORDER_SLOT) return {};
  if (!record.pendingFile) return clearKingdeeExtractFields("未上传轻量CSV文件");
  if (!isLightKingdeeFile(record.pendingFile)) return clearKingdeeExtractFields("请上传轻量CSV文件，不再支持浏览器解析原始Excel");
  try {
    adminEls.referenceState.textContent = "正在生成金蝶轻量数据";
    const rows = await readKingdeeCompareRows(record.pendingFile);
    return {
      kingdeeCompareRows: rows,
      kingdeeCompareCachedAt: new Date().toISOString(),
      kingdeeCompareExtractError: "",
      kingdeeCompareCacheSource: {
        name: record.pendingName,
        size: record.pendingSize,
        appliedAt,
      },
    };
  } catch (error) {
    console.warn("kingdee compare extract failed", error);
    return clearKingdeeExtractFields(error.message || "轻量数据生成失败");
  }
}

async function deleteSlot(slotId) {
  const slot = getSlot(slotId);
  const db = await openAppDb();
  await deleteRecord(db, slot.store, slotId);
  db.close();
  await refreshAdmin();
}

async function clearLibraryCache() {
  const confirmed = window.confirm("\u786e\u8ba4\u6e05\u9664\u5f53\u524d\u6d4f\u89c8\u5668\u91cc\u7684\u6240\u6709\u6587\u4ef6\u5e93\u7f13\u5b58\u5417\uff1f\u6e05\u9664\u540e\u9700\u8981\u91cd\u65b0\u4e0a\u4f20\u5e76\u786e\u8ba4\u5e94\u7528\u5237\u65b0\u3002");
  if (!confirmed) return;

  adminEls.clearCacheButton.disabled = true;
  adminEls.referenceState.textContent = "\u6e05\u9664\u4e2d";
  try {
    await deleteLibraryDatabase();
    LIBRARY_UNLOCK_KEYS.forEach((key) => localStorage.removeItem(key));
    adminState.records = new Map();
    renderLibrarySlots();
    renderReferenceRows();
    adminEls.referenceState.textContent = "\u5df2\u6e05\u9664\u7f13\u5b58";
  } catch (error) {
    console.warn("clear library cache failed", error);
    adminEls.referenceState.textContent = "\u6e05\u9664\u5931\u8d25";
  } finally {
    adminEls.clearCacheButton.disabled = false;
  }
}

function renderLibrarySlots() {
  adminEls.slots.innerHTML = librarySlots.map(renderLibrarySlot).join("");
  updateApplyAllButton();
}

function renderLibrarySlot(slot) {
  const record = adminState.records.get(slot.id);
  const display = getDisplayRecord(record);
  const isApplied = Boolean(record?.applied && !record.pendingFile);
  const hasPending = Boolean(record?.pendingFile);
  return `
    <article class="admin-file-card ${isApplied ? "applied" : ""}" data-admin-drop="${slot.id}">
      <div class="admin-file-card-head">
        <div>
          <p class="eyebrow">${escapeHtml(slot.library)}</p>
          <h2>${escapeHtml(slot.label)}</h2>
        </div>
        <span class="slot-status ${isApplied ? "applied" : "pending"}">${isApplied ? "\u5df2\u5f15\u7528" : hasPending ? "\u5f85\u5e94\u7528" : "\u672a\u4e0a\u4f20"}</span>
      </div>
      <div class="admin-file-meta">
        <span>${escapeHtml(display?.name || "\u672a\u4e0a\u4f20\u6587\u4ef6")}</span>
        <strong>${display ? `${escapeHtml(display.typeLabel || "\u6587\u4ef6")} / ${formatFileSize(display.size)}` : "--"}</strong>
        <small>\u66f4\u65b0\uff1a${display ? formatDateTime(display.savedAt) : "--"}</small>
        <small>${escapeHtml(getSlotHelperText(slot, record))}</small>
      </div>
      <div class="admin-file-actions">
        <label class="admin-upload-button">
          <input type="file" accept="${getSlotAccept(slot)}" data-admin-upload="${slot.id}" />
          \u4e0a\u4f20/\u66ff\u6362
        </label>
        <button type="button" data-admin-apply="${slot.id}" ${hasPending || (record && !record.applied) ? "" : "disabled"}>\u786e\u8ba4\u5e94\u7528</button>
        <button class="danger-button" type="button" data-admin-delete="${slot.id}" ${record ? "" : "disabled"}>\u5220\u9664</button>
      </div>
    </article>
  `;
}

function renderReferenceRows() {
  const rows = librarySlots.map((slot) => renderReferenceRow(slot, adminState.records.get(slot.id)));
  adminEls.referenceRows.innerHTML = rows.join("");
  adminEls.referenceState.textContent = "\u672c\u5730\u6587\u4ef6\u5e93";
  updateApplyAllButton();
}

function renderReferenceRow(slot, record) {
  const applied = Boolean(record?.applied);
  const statusText = getReferenceStatusText(slot, record, applied);
  const statusClass = applied && !record?.kingdeeCompareExtractError ? "applied" : "pending";
  return `
    <tr>
      <td>${escapeHtml(slot.library)}</td>
      <td>${escapeHtml(slot.label)}</td>
      <td>${escapeHtml(record?.name || "--")}</td>
      <td>${escapeHtml(record?.refreshMonth || "--")}</td>
      <td>${formatDateTime(record?.savedAt)}</td>
      <td>${formatDateTime(record?.appliedAt || "")}</td>
      <td><span class="slot-status ${statusClass}">${escapeHtml(statusText)}</span></td>
    </tr>
  `;
}

function getSlotHelperText(slot, record) {
  if (slot.id !== KINGDEE_ORDER_SLOT) return "可点击上传，也可拖拽文件到此处";
  if (record?.pendingFile) return "确认应用时会读取轻量CSV并生成对比数据";
  if (record?.kingdeeCompareExtractError) return `轻量数据失败：${record.kingdeeCompareExtractError}`;
  if (Array.isArray(record?.kingdeeCompareRows) && record.kingdeeCompareRows.length) {
    return `轻量数据已生成：${record.kingdeeCompareRows.length} 行`;
  }
  if (record?.applied) return "已引用，但未生成轻量数据，请重新上传并确认应用";
  return "请上传转换后的轻量CSV，不要上传原始Excel";
}

function getReferenceStatusText(slot, record, applied) {
  if (!applied) return "未引用";
  if (slot.id !== KINGDEE_ORDER_SLOT) return "已引用";
  if (record?.kingdeeCompareExtractError) return "轻量数据失败";
  if (Array.isArray(record?.kingdeeCompareRows) && record.kingdeeCompareRows.length) {
    return `已引用 / 轻量${record.kingdeeCompareRows.length}行`;
  }
  return "已引用 / 未生成轻量数据";
}

function getSlot(slotId) {
  return librarySlots.find((slot) => slot.id === slotId);
}

function getSlotAccept(slot) {
  return slot.id === KINGDEE_ORDER_SLOT ? ".csv,.txt" : ".xlsx,.xls,.csv";
}

function getDisplayRecord(record) {
  if (!record) return null;
  if (record.pendingFile) {
    return {
      name: record.pendingName,
      size: record.pendingSize,
      typeLabel: record.pendingTypeLabel,
      savedAt: record.pendingSavedAt,
    };
  }
  return record;
}

function updateApplyAllButton() {
  if (!adminEls.applyAllButton) return;
  const hasApplicableRecord = librarySlots.some((slot) => {
    const record = adminState.records.get(slot.id);
    return record?.pendingFile || (record && !record.applied);
  });
  adminEls.applyAllButton.disabled = !hasApplicableRecord;
}

function clearPendingFields(record) {
  const nextRecord = { ...record };
  delete nextRecord.pendingFile;
  delete nextRecord.pendingName;
  delete nextRecord.pendingSize;
  delete nextRecord.pendingTypeLabel;
  delete nextRecord.pendingRefreshMonth;
  delete nextRecord.pendingSavedAt;
  delete nextRecord.pendingLibrarySource;
  return nextRecord;
}

function clearKingdeeExtractFields(errorMessage = "") {
  return {
    kingdeeCompareRows: [],
    kingdeeCompareCachedAt: "",
    kingdeeCompareExtractError: errorMessage,
    kingdeeCompareCacheSource: null,
  };
}

const kingdeeAliases = {
  materialCode: ["物料编码", "品号", "物料代码", "商品编码", "存货编码", "产品编码"],
  sku: ["SKU", "sku", "领星SKU", "商品SKU", "物料SKU"],
  itemName: ["物料名称", "商品名称", "物品名称", "存货名称", "产品名称", "金蝶名称", "品名"],
  supplier: ["供应商", "供应商名称", "供方", "厂家", "厂商"],
  creator: ["创建人", "采购订单下单人", "下单人", "制单人"],
  businessUnit: ["事业部", "部门", "业务部门"],
  purchaseQty: ["采购数量", "数量", "订单数量"],
  remainingInboundQty: ["剩余入库数量", "未入库数量", "剩余数量"],
};

async function readKingdeeCompareRows(file) {
  if (!isLightKingdeeFile(file)) {
    throw new Error("请上传轻量CSV文件，不再支持浏览器解析原始Excel");
  }
  const rows = csvToRows(await readFileText(file));
  return parseKingdeeSheet(rows);
}

function isLightKingdeeFile(file) {
  const extension = String(file?.name || "").split(".").pop()?.toLowerCase();
  return extension === "csv" || extension === "txt";
}

function parseKingdeeSheet(rows) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => hasKnownHeader(cell, kingdeeAliases)));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((cell) => String(cell || "").trim());
  const dataRows = rows.slice(headerIndex + 1);
  const headerMap = createHeaderMap(headers, dataRows, kingdeeAliases);
  if (headerMap.purchaseQty === undefined && headerMap.remainingInboundQty === undefined) return [];

  return dataRows
    .map((row, index) => {
      const materialCode = getRowValue(row, headerMap.materialCode);
      const sku = getRowValue(row, headerMap.sku);
      const itemName = getRowValue(row, headerMap.itemName);
      const supplier = getRowValue(row, headerMap.supplier);
      return {
        id: `kingdee-${index}-${materialCode}-${sku}-${supplier}`,
        materialCode,
        sku,
        itemName,
        supplier,
        creator: getRowValue(row, headerMap.creator),
        businessUnit: normalizeBusinessUnit(getRowValue(row, headerMap.businessUnit)),
        purchaseQty: parseNumber(getRowValue(row, headerMap.purchaseQty)),
        remainingInboundQty: parseNumber(getRowValue(row, headerMap.remainingInboundQty)),
      };
    })
    .filter((item) => item.materialCode || item.sku || item.itemName || item.supplier);
}

async function readWorkbookSheetRows(file, preferredSheetName = "") {
  const fileName = String(file?.name || "");
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "csv") return csvToRows(await readFileText(file));
  if (!window.XLSX) throw new Error("XLSX parser is not available.");
  const sheetNames = await readWorkbookSheetNames(file);
  const targetSheetName = sheetNames.find((name) => preferredSheetName && name.includes(preferredSheetName)) || sheetNames[0];
  if (!targetSheetName) return [];
  const workbook = await readWorkbook(file, { sheets: targetSheetName, sheetRows: MAX_EXTRACT_SHEET_ROWS });
  return sheetToRows(workbook.Sheets[targetSheetName]);
}

async function readWorkbookSheetNames(file) {
  const workbook = await readWorkbook(file, { bookSheets: true });
  return workbook.SheetNames || [];
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
  return {
    s: rawRange.s,
    e: {
      r: Math.min(rawRange.e.r, rawRange.s.r + MAX_EXTRACT_SHEET_ROWS - 1),
      c: Math.min(rawRange.e.c, rawRange.s.c + MAX_EXTRACT_SHEET_COLUMNS - 1),
    },
  };
}

async function readFileArrayBuffer(file) {
  if (file?.arrayBuffer) return file.arrayBuffer();
  if (file instanceof Blob) return file.arrayBuffer();
  throw new Error("文件对象不可读取，请重新上传并确认应用");
}

function readFileBinaryString(file) {
  if (!file) return Promise.reject(new Error("文件对象不可读取，请重新上传并确认应用"));
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
  throw new Error("文件对象不可读取，请重新上传并确认应用");
}

function createHeaderMap(headers, dataRows, aliasesByKey) {
  const headerMap = createAliasHeaderMap(headers, aliasesByKey);
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

function hasKnownHeader(value, aliasesByKey) {
  const header = normalizeHeader(value);
  return Object.values(aliasesByKey).some((aliases) => aliases.some((alias) => normalizeHeader(alias) === header));
}

function inferMaterialCodeColumn(headers, dataRows, usedColumns) {
  const candidates = headers.map((_, index) => index).filter((index) => !usedColumns.has(index));
  let bestColumn;
  let bestScore = 0;
  candidates.forEach((column) => {
    const score = dataRows.slice(0, 60).reduce((sum, row) => sum + scoreMaterialCodeCell(row[column]), 0);
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

function getRowValue(row, index) {
  return index === undefined ? "" : String(row[index] ?? "").trim();
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

function normalizeBusinessUnit(value) {
  const text = String(value || "").trim().split("*")[0].trim().replace(/[（(].*?[）)]/g, "").trim();
  if (!text) return "未匹配";
  if (text === "全球招商事业部") return "全球招商部";
  return text;
}

function parseNumber(value) {
  const number = Number(String(value || "").replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function isAllocationError(error) {
  return /allocation|array buffer|out of memory|memory/i.test(String(error?.message || error || ""));
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

function openAppDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      ["uploaded-files", "dimension-files", "fact-files"].forEach((storeName) => {
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
  return runStoreRequest(db, storeName, "readonly", (store) => store.get(key));
}

function putRecord(db, storeName, record) {
  return runStoreRequest(db, storeName, "readwrite", (store) => store.put(record));
}

function deleteRecord(db, storeName, key) {
  return runStoreRequest(db, storeName, "readwrite", (store) => store.delete(key));
}

function runStoreRequest(db, storeName, mode, createRequest) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = createRequest(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

function deleteLibraryDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("\u6587\u4ef6\u5e93\u6b63\u5728\u88ab\u5176\u4ed6\u9875\u9762\u5360\u7528\uff0c\u8bf7\u5173\u95ed\u5176\u4ed6\u770b\u677f\u9875\u9762\u540e\u91cd\u8bd5"));
  });
}

function getMonthFromDate(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatDateTime(value) {
  if (!value) return "--";
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
  if (extension === "xlsx" || extension === "xls") return "Excel \u5de5\u4f5c\u7c3f";
  if (extension === "csv") return "CSV \u6587\u4ef6";
  return file.type || "\u672a\u77e5\u7c7b\u578b";
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

bindAdminEvents();
refreshAdmin().catch((error) => {
  console.error(error);
  adminEls.referenceState.textContent = "\u8bfb\u53d6\u5931\u8d25";
});
