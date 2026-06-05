const DB_NAME = "supply-chain-library";
const DB_VERSION = 3;
const UPLOAD_STORE_NAME = "uploaded-files";
const DIMENSION_STORE_NAME = "dimension-files";
const STORE_NAME = "fact-files";
const SLOT_COUNT = 8;
const MAINTAINER_KEY = "3.1415926";
const UNLOCK_KEY = "fact-library-key-unlocked-v2";

const factNames = [
  "采购订单跟进表",
  "备货发货事实表 2",
  "备货发货事实表 3",
  "备货发货事实表 4",
  "备货发货事实表 5",
  "备货发货事实表 6",
  "备货发货事实表 7",
  "备货发货事实表 8",
];

const slots = Array.from({ length: SLOT_COUNT }, (_, index) => ({
  id: `fact-${index + 1}`,
  name: factNames[index],
}));

const deprecatedSharedRecords = [
  { id: "fact-1", name: "Fac-采购订单跟进表.xlsx", size: 804971, savedAt: "2026-06-04T05:43:46+00:00" },
];

const libraryState = {
  files: new Map(),
  hiddenSlots: new Set(),
  canReplace: true,
};

const libraryEls = {
  state: document.querySelector("#libraryState"),
  count: document.querySelector("#libraryCount"),
  appliedCount: document.querySelector("#appliedCount"),
  updatedAt: document.querySelector("#libraryUpdatedAt"),
  slots: document.querySelector("#dimensionSlots"),
  applyAll: document.querySelector("#applyAllButton"),
  maintainerGate: document.querySelector(".maintainer-gate"),
  maintainerState: document.querySelector("#maintainerState"),
  maintainerCode: document.querySelector("#maintainerCode"),
  unlockButton: document.querySelector("#unlockButton"),
};

async function initLibrary() {
  bindLibraryEvents();
  await refreshLibrary();
}

function bindLibraryEvents() {
  libraryEls.slots.addEventListener("change", async (event) => {
    const input = event.target.closest("[data-upload-slot]");
    if (!input) return;
    await saveFile(input.dataset.uploadSlot, input.files[0]);
    input.value = "";
  });

  libraryEls.slots.addEventListener("click", async (event) => {
    const deleteButton = event.target.closest("[data-delete-slot]");
    if (deleteButton) {
      await deleteSlot(deleteButton.dataset.deleteSlot);
      return;
    }

    const applyButton = event.target.closest("[data-apply-slot]");
    if (applyButton) {
      await applySlot(applyButton.dataset.applySlot);
    }
  });

  libraryEls.applyAll.addEventListener("click", applyAllSlots);

  if (libraryEls.unlockButton) {
    libraryEls.unlockButton.addEventListener("click", unlockReplaceAccess);
  }
}

async function saveFile(slotId, file) {
  if (!file) return;
  const savedAt = new Date().toISOString();
  const existing = libraryState.files.get(slotId) || { id: slotId };
  const record = {
    ...existing,
    id: slotId,
    pendingFile: file,
    pendingName: file.name,
    pendingSize: file.size,
    pendingTypeLabel: getFileTypeLabel(file),
    pendingRefreshMonth: getMonthFromDate(savedAt),
    pendingSavedAt: savedAt,
  };
  const db = await openLibraryDb();
  await putRecord(db, record);
  db.close();
  await refreshLibrary();
}

async function applySlot(slotId) {
  const record = libraryState.files.get(slotId);
  if (!record) return;
  const appliedAt = new Date().toISOString();
  const updatedRecord = record.pendingFile
    ? clearPendingFields({
        ...record,
        file: record.pendingFile,
        name: record.pendingName,
        size: record.pendingSize,
        typeLabel: record.pendingTypeLabel,
        refreshMonth: record.pendingRefreshMonth,
        savedAt: record.pendingSavedAt,
        applied: true,
        appliedAt,
      })
    : {
        ...record,
        applied: true,
        appliedAt,
      };
  const db = await openLibraryDb();
  await putRecord(db, updatedRecord);
  db.close();
  await refreshLibrary();
}

async function applyAllSlots() {
  const records = [...libraryState.files.values()].filter((record) => record.pendingFile);
  if (!records.length) return;
  const appliedAt = new Date().toISOString();
  const db = await openLibraryDb();
  await Promise.all(
    records.map((record) =>
      putRecord(
        db,
        clearPendingFields({
          ...record,
          file: record.pendingFile,
          name: record.pendingName,
          size: record.pendingSize,
          typeLabel: record.pendingTypeLabel,
          refreshMonth: record.pendingRefreshMonth,
          savedAt: record.pendingSavedAt,
          applied: true,
          appliedAt,
        })
      )
    )
  );
  db.close();
  await refreshLibrary();
}

async function deleteSlot(slotId) {
  const db = await openLibraryDb();
  await deleteRecord(db, slotId);
  db.close();
  await refreshLibrary();
}

async function refreshLibrary() {
  const db = await openLibraryDb();
  await purgeDeprecatedSharedRecords(db);
  const records = await getAllRecords(db);
  db.close();
  const slotIds = new Set(slots.map((slot) => slot.id));
  libraryState.files = new Map(
    records.filter((record) => slotIds.has(record.id)).map((record) => [record.id, normalizeRecord(record)])
  );
  libraryState.hiddenSlots.clear();
  renderLibrary();
}

async function purgeDeprecatedSharedRecords(db) {
  const records = await getAllRecords(db);
  const cleanupRecords = records.filter(isDeprecatedSharedRecord);
  await Promise.all(cleanupRecords.map((record) => deleteRecord(db, record.id)));
}

function isDeprecatedSharedRecord(record) {
  if (record.pendingFile) return false;
  if (isLegacySlotRecord(record, "fact-1", 804971, "2026-06-04T05:43:46+00:00")) return true;
  return deprecatedSharedRecords.some(
    (deprecatedRecord) =>
      record.id === deprecatedRecord.id &&
      record.name === deprecatedRecord.name &&
      Number(record.size || 0) === deprecatedRecord.size &&
      record.savedAt === deprecatedRecord.savedAt
  );
}

function isLegacySlotRecord(record, id, size, cutoffSavedAt) {
  if (record.id !== id) return false;
  if (Number(record.size || 0) !== size) return false;
  const savedAt = Date.parse(record.savedAt || "");
  const cutoff = Date.parse(cutoffSavedAt);
  return Number.isFinite(savedAt) && Number.isFinite(cutoff) && savedAt <= cutoff;
}

function normalizeRecord(record) {
  return {
    ...record,
    refreshMonth: record.refreshMonth || (record.savedAt ? getMonthFromDate(record.savedAt) : null),
    applied: Boolean(record.applied),
    appliedAt: record.appliedAt || null,
    pendingRefreshMonth: record.pendingRefreshMonth || (record.pendingSavedAt ? getMonthFromDate(record.pendingSavedAt) : null),
  };
}

function renderLibrary() {
  const records = getVisibleRecords();
  const appliedRecords = records.filter((record) => record.applied);
  const pendingRecords = records.filter((record) => record.pendingFile);
  const latest = records
    .map(getDisplayRecord)
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))[0];

  libraryEls.count.textContent = records.length;
  libraryEls.appliedCount.textContent = appliedRecords.length;
  libraryEls.updatedAt.textContent = latest ? formatDateTime(latest.savedAt) : "--";
  libraryEls.state.textContent = records.length ? "事实表文件已保存" : "等待上传";
  libraryEls.applyAll.disabled = !pendingRecords.length;
  renderMaintainerState();

  libraryEls.slots.innerHTML = slots.map(renderSlot).join("");
}

function unlockReplaceAccess() {
  const value = libraryEls.maintainerCode.value.trim();
  if (value !== MAINTAINER_KEY) {
    libraryEls.maintainerState.textContent = "验证失败，请输入正确秘钥";
    libraryEls.maintainerGate.classList.remove("unlocked");
    return;
  }
  libraryState.canReplace = true;
  localStorage.setItem(UNLOCK_KEY, "true");
  libraryEls.maintainerCode.value = "";
  renderLibrary();
}

function renderMaintainerState() {
  if (!libraryEls.maintainerGate) return;
  libraryEls.maintainerGate.classList.toggle("unlocked", libraryState.canReplace);
  libraryEls.maintainerState.textContent = libraryState.canReplace ? "已启用秘钥替换权限" : "验证秘钥后可替换文件";
  libraryEls.unlockButton.disabled = libraryState.canReplace;
  libraryEls.maintainerCode.disabled = libraryState.canReplace;
}

function renderSlot(slot) {
  if (libraryState.hiddenSlots.has(slot.id)) {
    return renderEmptySlot(slot);
  }
  const record = libraryState.files.get(slot.id);
  if (!record) {
    return renderEmptySlot(slot);
  }

  const displayRecord = getDisplayRecord(record);
  const isPending = Boolean(record.pendingFile);

  return `
    <article class="dimension-card">
      <div class="dimension-card-head">
        <div>
          <p class="eyebrow">Fact Slot</p>
          <h2>${slot.name}</h2>
        </div>
        <span class="slot-status ${isPending ? "pending" : "applied"}">${isPending ? "\u5f85\u786e\u8ba4\u5e94\u7528" : "\u5df2\u5e94\u7528"}</span>
      </div>
      <div class="dimension-file">
        <strong>${escapeHtml(displayRecord.name)}</strong>
        <span>${escapeHtml(displayRecord.typeLabel)} · ${formatFileSize(displayRecord.size)}</span>
      </div>
      <div class="dimension-meta">
        <div>
          <span>刷新月份</span>
          <strong>${formatMonth(displayRecord.refreshMonth)}</strong>
        </div>
        <div>
          <span>更新日期</span>
          <strong>${formatDateTime(displayRecord.savedAt)}</strong>
        </div>
      </div>
      <div class="dimension-actions">
        <label class="${libraryState.canReplace ? "" : "disabled"}">
          <input type="file" accept=".xlsx,.xls,.csv" data-upload-slot="${slot.id}" ${libraryState.canReplace ? "" : "disabled"} />
          替换文件
        </label>
        <button type="button" data-apply-slot="${slot.id}" ${isPending ? "" : "disabled"}>\u786e\u8ba4\u5e94\u7528\u5237\u65b0</button>
        <button class="danger-button" type="button" data-delete-slot="${slot.id}">删除</button>
      </div>
    </article>
  `;
}

function renderEmptySlot(slot) {
  return `
    <article class="dimension-card empty-dimension">
      <div class="dimension-card-head">
        <div>
          <p class="eyebrow">Fact Slot</p>
          <h2>${slot.name}</h2>
        </div>
        <span class="slot-status">空</span>
      </div>
      <label class="slot-upload ${libraryState.canReplace ? "" : "disabled"}">
        <input type="file" accept=".xlsx,.xls,.csv" data-upload-slot="${slot.id}" ${libraryState.canReplace ? "" : "disabled"} />
        <strong>上传事实表文件</strong>
        <span>${libraryState.canReplace ? "刷新月份和更新日期会自动记录" : "验证秘钥后可替换文件"}</span>
      </label>
    </article>
  `;
}

function getVisibleRecords() {
  return [...libraryState.files.values()].filter((record) => !libraryState.hiddenSlots.has(record.id));
}

function getDisplayRecord(record) {
  if (record.pendingFile) {
    return {
      name: record.pendingName,
      size: record.pendingSize,
      typeLabel: record.pendingTypeLabel,
      refreshMonth: record.pendingRefreshMonth,
      savedAt: record.pendingSavedAt,
    };
  }
  return record;
}

function clearPendingFields(record) {
  const nextRecord = { ...record };
  delete nextRecord.pendingFile;
  delete nextRecord.pendingName;
  delete nextRecord.pendingSize;
  delete nextRecord.pendingTypeLabel;
  delete nextRecord.pendingRefreshMonth;
  delete nextRecord.pendingSavedAt;
  return nextRecord;
}

function openLibraryDb() {
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
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putRecord(db, record) {
  return runStoreRequest(db, "readwrite", (store) => store.put(record));
}

function getAllRecords(db) {
  return runStoreRequest(db, "readonly", (store) => store.getAll());
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

function getMonthFromDate(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(value) {
  if (!value) return "未设置月份";
  const [year, month] = value.split("-");
  return `${year}年${Number(month)}月`;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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

initLibrary().catch((error) => {
  console.error(error);
  libraryEls.state.textContent = "备货事实表库异常";
});
