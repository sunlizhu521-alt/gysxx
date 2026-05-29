const DB_NAME = "supply-chain-library";
const DB_VERSION = 2;
const UPLOAD_STORE_NAME = "uploaded-files";
const STORE_NAME = "dimension-files";
const SLOT_COUNT = 8;

const dimensionNames = [
  "Dim-YL医疗器械商品分类",
  "Dim-仓库_金蝶、旺店通、领星",
  "Dim-仓库与物料对照表",
  "Dim-店铺名称汇总（金蝶&领星&简称）",
  "Dim-客户与物料对照表",
  "采购分工明细",
  "维度 7",
  "维度 8",
];

const slots = Array.from({ length: SLOT_COUNT }, (_, index) => ({
  id: `dimension-${index + 1}`,
  name: dimensionNames[index],
}));

const libraryState = {
  files: new Map(),
  hiddenSlots: new Set(),
};

const libraryEls = {
  state: document.querySelector("#libraryState"),
  count: document.querySelector("#libraryCount"),
  appliedCount: document.querySelector("#appliedCount"),
  updatedAt: document.querySelector("#libraryUpdatedAt"),
  slots: document.querySelector("#dimensionSlots"),
  applyAll: document.querySelector("#applyAllButton"),
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
}

async function saveFile(slotId, file) {
  if (!file) return;
  const savedAt = new Date().toISOString();
  const record = {
    id: slotId,
    file,
    name: file.name,
    size: file.size,
    typeLabel: getFileTypeLabel(file),
    refreshMonth: getMonthFromDate(savedAt),
    savedAt,
    applied: false,
    appliedAt: null,
  };
  const db = await openLibraryDb();
  await putRecord(db, record);
  db.close();
  await refreshLibrary();
}

async function applySlot(slotId) {
  const record = libraryState.files.get(slotId);
  if (!record) return;
  record.applied = true;
  record.appliedAt = new Date().toISOString();
  const db = await openLibraryDb();
  await putRecord(db, record);
  db.close();
  await refreshLibrary();
}

async function applyAllSlots() {
  const records = [...libraryState.files.values()];
  if (!records.length) return;
  const appliedAt = new Date().toISOString();
  const db = await openLibraryDb();
  await Promise.all(
    records.map((record) =>
      putRecord(db, {
        ...record,
        applied: true,
        appliedAt,
      })
    )
  );
  db.close();
  await refreshLibrary();
}

async function deleteSlot(slotId) {
  libraryState.hiddenSlots.add(slotId);
  renderLibrary();
}

async function refreshLibrary() {
  const db = await openLibraryDb();
  const records = await getAllRecords(db);
  db.close();
  const slotIds = new Set(slots.map((slot) => slot.id));
  libraryState.files = new Map(
    records.filter((record) => slotIds.has(record.id)).map((record) => [record.id, normalizeRecord(record)])
  );
  libraryState.hiddenSlots.clear();
  renderLibrary();
}

function normalizeRecord(record) {
  return {
    ...record,
    refreshMonth: record.refreshMonth || getMonthFromDate(record.savedAt),
    applied: Boolean(record.applied),
    appliedAt: record.appliedAt || null,
  };
}

function renderLibrary() {
  const records = getVisibleRecords();
  const appliedRecords = records.filter((record) => record.applied);
  const latest = records.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))[0];

  libraryEls.count.textContent = records.length;
  libraryEls.appliedCount.textContent = appliedRecords.length;
  libraryEls.updatedAt.textContent = latest ? formatDateTime(latest.savedAt) : "--";
  libraryEls.state.textContent = records.length ? "维度文件已保存" : "等待上传";
  libraryEls.applyAll.disabled = !records.length || appliedRecords.length === records.length;

  libraryEls.slots.innerHTML = slots.map(renderSlot).join("");
}

function renderSlot(slot) {
  if (libraryState.hiddenSlots.has(slot.id)) {
    return renderEmptySlot(slot);
  }
  const record = libraryState.files.get(slot.id);
  if (!record) {
    return renderEmptySlot(slot);
  }

  return `
    <article class="dimension-card">
      <div class="dimension-card-head">
        <div>
          <p class="eyebrow">Dimension Slot</p>
          <h2>${slot.name}</h2>
        </div>
        <span class="slot-status ${record.applied ? "applied" : "pending"}">${record.applied ? "已应用" : "待应用"}</span>
      </div>
      <div class="dimension-file">
        <strong>${escapeHtml(record.name)}</strong>
        <span>${escapeHtml(record.typeLabel)} · ${formatFileSize(record.size)}</span>
      </div>
      <div class="dimension-meta">
        <div>
          <span>刷新月份</span>
          <strong>${formatMonth(record.refreshMonth)}</strong>
        </div>
        <div>
          <span>更新日期</span>
          <strong>${formatDateTime(record.savedAt)}</strong>
        </div>
      </div>
      <div class="dimension-actions">
        <label>
          <input type="file" accept=".xlsx,.xls,.csv" data-upload-slot="${slot.id}" />
          替换文件
        </label>
        <button type="button" data-apply-slot="${slot.id}" ${record.applied ? "disabled" : ""}>应用刷新</button>
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
          <p class="eyebrow">Dimension Slot</p>
          <h2>${slot.name}</h2>
        </div>
        <span class="slot-status">空</span>
      </div>
      <label class="slot-upload">
        <input type="file" accept=".xlsx,.xls,.csv" data-upload-slot="${slot.id}" />
        <strong>上传维度文件</strong>
        <span>刷新月份和更新日期会自动记录</span>
      </label>
    </article>
  `;
}

function getVisibleRecords() {
  return [...libraryState.files.values()].filter((record) => !libraryState.hiddenSlots.has(record.id));
}

function openLibraryDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(UPLOAD_STORE_NAME)) {
        db.createObjectStore(UPLOAD_STORE_NAME, { keyPath: "id" });
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
  libraryEls.state.textContent = "文件库异常";
});
