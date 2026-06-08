const DB_NAME = "yile-reconciliation-library";
const DB_VERSION = 1;
const STORE_NAME = "file-slots";

const slots = [
  { id: "file-1", label: "对账文件 1" },
  { id: "file-2", label: "对账文件 2" },
  { id: "file-3", label: "对账文件 3" },
  { id: "file-4", label: "对账文件 4" },
];

const els = {
  slotGrid: document.querySelector("#slotGrid"),
  applyAllButton: document.querySelector("#applyAllButton"),
  libraryState: document.querySelector("#libraryState"),
  sourceNote: document.querySelector("#librarySourceNote"),
  slotCount: document.querySelector("#slotCount"),
  uploadedCount: document.querySelector("#uploadedCount"),
  appliedCount: document.querySelector("#appliedCount"),
  latestMonth: document.querySelector("#latestMonth"),
};

const state = {
  records: new Map(),
};

async function init() {
  bindEvents();
  if (window.ensureSharedLibraryLoaded) {
    await window.ensureSharedLibraryLoaded();
  }
  await refresh();
}

function bindEvents() {
  els.slotGrid.addEventListener("change", async (event) => {
    const input = event.target.closest("[data-upload]");
    if (!input) return;
    await savePendingFile(input.dataset.upload, input.files[0]);
    input.value = "";
  });

  els.slotGrid.addEventListener("click", async (event) => {
    const applyButton = event.target.closest("[data-apply]");
    if (applyButton) {
      await applySlot(applyButton.dataset.apply);
      return;
    }

    const deleteButton = event.target.closest("[data-delete]");
    if (deleteButton) {
      await deleteSlot(deleteButton.dataset.delete);
    }
  });

  els.slotGrid.addEventListener("dragover", (event) => {
    const card = event.target.closest("[data-drop]");
    if (!card) return;
    event.preventDefault();
    card.classList.add("drag-over");
  });

  els.slotGrid.addEventListener("dragleave", (event) => {
    const card = event.target.closest("[data-drop]");
    if (!card || card.contains(event.relatedTarget)) return;
    card.classList.remove("drag-over");
  });

  els.slotGrid.addEventListener("drop", async (event) => {
    const card = event.target.closest("[data-drop]");
    if (!card) return;
    event.preventDefault();
    card.classList.remove("drag-over");
    await savePendingFile(card.dataset.drop, event.dataTransfer?.files?.[0]);
  });

  els.applyAllButton.addEventListener("click", applyAllSlots);
}

async function refresh() {
  const db = await openDb();
  const entries = await Promise.all(slots.map(async (slot) => [slot.id, await getRecord(db, slot.id)]));
  db.close();
  state.records = new Map(entries);
  render();
}

async function savePendingFile(slotId, file) {
  if (!file) return;
  const now = new Date().toISOString();
  const existing = state.records.get(slotId) || { id: slotId };
  const record = {
    ...existing,
    id: slotId,
    pendingFile: file,
    pendingName: file.name,
    pendingSize: file.size,
    pendingTypeLabel: getFileTypeLabel(file),
    pendingRefreshMonth: getRefreshMonth(file.name, now),
    pendingSavedAt: now,
  };
  const db = await openDb();
  await putRecord(db, record);
  db.close();
  await refresh();
}

async function applySlot(slotId, options = {}) {
  const record = state.records.get(slotId);
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
  const db = await openDb();
  await putRecord(db, updatedRecord);
  db.close();
  if (!options.skipRefresh) await refresh();
}

async function applyAllSlots() {
  const targetSlotIds = slots
    .filter((slot) => {
      const record = state.records.get(slot.id);
      return record?.pendingFile || (record && !record.applied);
    })
    .map((slot) => slot.id);
  if (!targetSlotIds.length) return;

  els.applyAllButton.disabled = true;
  els.libraryState.textContent = "应用中";
  try {
    for (const slotId of targetSlotIds) {
      await applySlot(slotId, { skipRefresh: true });
    }
    await refresh();
  } catch (error) {
    console.warn("apply all failed", error);
    els.libraryState.textContent = "应用失败";
  }
}

async function deleteSlot(slotId) {
  const db = await openDb();
  await deleteRecord(db, slotId);
  db.close();
  await refresh();
}

function render() {
  els.slotCount.textContent = String(slots.length);
  els.uploadedCount.textContent = String(countUploadedRecords());
  els.appliedCount.textContent = String(countAppliedRecords());
  els.latestMonth.textContent = getLatestMonth();
  els.sourceNote.textContent = `本地文件库｜引用时间：${getLatestAppliedTime()}`;
  els.slotGrid.innerHTML = slots.map(renderSlot).join("");
  els.libraryState.textContent = "本地文件库";
  updateApplyAllButton();
}

function renderSlot(slot) {
  const record = state.records.get(slot.id);
  const display = getDisplayRecord(record);
  const hasPending = Boolean(record?.pendingFile);
  const isApplied = Boolean(record?.applied && !hasPending);
  return `
    <article class="slot-card ${isApplied ? "applied" : ""}" data-drop="${slot.id}">
      <div class="slot-head">
        <div>
          <p class="eyebrow">Slot</p>
          <h2>${escapeHtml(slot.label)}</h2>
        </div>
        <span class="slot-status ${isApplied ? "applied" : hasPending ? "pending" : ""}">
          ${isApplied ? "已引用" : hasPending ? "待应用" : "未上传"}
        </span>
      </div>
      <div class="file-meta">
        <span>${escapeHtml(display?.name || "未上传文件")}</span>
        <strong>${display ? `${escapeHtml(display.typeLabel)} / ${formatFileSize(display.size)}` : "--"}</strong>
        <small>刷新月份：${escapeHtml(display?.refreshMonth || "--")}</small>
        <small>更新时间：${formatDateTime(display?.savedAt)}</small>
        <small>引用时间：${formatDateTime(record?.appliedAt)}</small>
      </div>
      <div class="slot-actions">
        <label class="upload-button">
          <input type="file" accept=".xlsx,.xls,.csv,.txt,.pdf" data-upload="${slot.id}" />
          上传/替换
        </label>
        <button type="button" data-apply="${slot.id}" ${hasPending || (record && !record.applied) ? "" : "disabled"}>应用刷新</button>
        <button class="danger-button" type="button" data-delete="${slot.id}" ${record ? "" : "disabled"}>删除</button>
      </div>
    </article>
  `;
}

function getDisplayRecord(record) {
  if (!record) return null;
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

function countUploadedRecords() {
  return slots.filter((slot) => {
    const record = state.records.get(slot.id);
    return record?.file || record?.pendingFile;
  }).length;
}

function countAppliedRecords() {
  return slots.filter((slot) => state.records.get(slot.id)?.applied).length;
}

function getLatestMonth() {
  const times = slots
    .map((slot) => getDisplayRecord(state.records.get(slot.id))?.savedAt)
    .filter(Boolean)
    .sort();
  if (!times.length) return "--";
  return getMonthFromDate(times.at(-1));
}

function getLatestAppliedTime() {
  const times = slots
    .map((slot) => state.records.get(slot.id)?.appliedAt)
    .filter(Boolean)
    .sort();
  if (!times.length) return "--";
  return formatDateTime(times.at(-1));
}

function updateApplyAllButton() {
  const hasApplicableRecord = slots.some((slot) => {
    const record = state.records.get(slot.id);
    return record?.pendingFile || (record && !record.applied);
  });
  els.applyAllButton.disabled = !hasApplicableRecord;
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

function getRefreshMonth(fileName, fallbackTime) {
  const name = String(fileName || "");
  const compact = name.match(/(20\d{2})(0[1-9]|1[0-2])/);
  if (compact) return `${compact[1]}-${compact[2]}`;
  const separated = name.match(/(20\d{2})[-_.年 ]+(0?[1-9]|1[0-2])/);
  if (separated) return `${separated[1]}-${String(separated[2]).padStart(2, "0")}`;
  return getMonthFromDate(fallbackTime);
}

function getMonthFromDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getFileTypeLabel(file) {
  const extension = String(file?.name || "").split(".").pop()?.toLowerCase();
  if (extension === "xlsx" || extension === "xls") return "Excel 工作簿";
  if (extension === "csv") return "CSV 文件";
  if (extension === "txt") return "文本文件";
  if (extension === "pdf") return "PDF 文件";
  return file?.type || "文件";
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getRecord(db, key) {
  return runStoreRequest(db, "readonly", (store) => store.get(key));
}

function putRecord(db, record) {
  return runStoreRequest(db, "readwrite", (store) => store.put(record));
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

init().catch((error) => {
  console.error(error);
  els.libraryState.textContent = "读取失败";
});
