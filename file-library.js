const DB_NAME = "supply-chain-library";
const DB_VERSION = 2;
const UPLOAD_STORE_NAME = "uploaded-files";
const STORE_NAME = "dimension-files";

const libraryState = {
  files: [],
};

const libraryEls = {
  input: document.querySelector("#libraryInput"),
  dropzone: document.querySelector("#libraryDropzone"),
  refreshMonth: document.querySelector("#refreshMonth"),
  state: document.querySelector("#libraryState"),
  count: document.querySelector("#libraryCount"),
  updatedAt: document.querySelector("#libraryUpdatedAt"),
  list: document.querySelector("#libraryList"),
};

async function initLibrary() {
  libraryEls.refreshMonth.value = getCurrentMonth();
  bindLibraryEvents();
  await refreshLibrary();
}

function bindLibraryEvents() {
  libraryEls.input.addEventListener("change", async (event) => {
    await saveFiles([...event.target.files]);
    libraryEls.input.value = "";
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    libraryEls.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      libraryEls.dropzone.classList.add("dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    libraryEls.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      libraryEls.dropzone.classList.remove("dragging");
    });
  });

  libraryEls.dropzone.addEventListener("drop", async (event) => {
    await saveFiles([...event.dataTransfer.files]);
  });

  libraryEls.list.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-id]");
    if (!button) return;
    await deleteFile(button.dataset.deleteId);
    await refreshLibrary();
  });
}

async function saveFiles(files) {
  const validFiles = files.filter((file) => file);
  if (!validFiles.length) return;

  const db = await openLibraryDb();
  const month = libraryEls.refreshMonth.value || getCurrentMonth();
  const savedAt = new Date().toISOString();
  await Promise.all(
    validFiles.map((file) =>
      putRecord(db, {
        id: `${Date.now()}-${crypto.randomUUID()}`,
        file,
        name: file.name,
        size: file.size,
        typeLabel: getFileTypeLabel(file),
        refreshMonth: month,
        savedAt,
      })
    )
  );
  db.close();
  await refreshLibrary();
}

async function refreshLibrary() {
  const db = await openLibraryDb();
  libraryState.files = await getAllRecords(db);
  db.close();
  libraryState.files.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  renderLibrary();
}

function renderLibrary() {
  const files = libraryState.files;
  libraryEls.count.textContent = files.length;
  libraryEls.state.textContent = files.length ? "维度文件已保存" : "等待上传";
  libraryEls.updatedAt.textContent = files[0] ? formatDateTime(files[0].savedAt) : "--";

  if (!files.length) {
    libraryEls.list.innerHTML = `<div class="empty-state">暂无维度文件，请先上传本月匹配维度表。</div>`;
    return;
  }

  libraryEls.list.innerHTML = files
    .map(
      (item) => `
        <article class="library-item">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.typeLabel)} · ${formatFileSize(item.size)} · ${formatMonth(item.refreshMonth)}</span>
          </div>
          <div class="library-item-meta">
            <span>${formatDateTime(item.savedAt)}</span>
            <button class="danger-button" type="button" data-delete-id="${escapeHtml(item.id)}">删除</button>
          </div>
        </article>
      `
    )
    .join("");
}

async function deleteFile(id) {
  const db = await openLibraryDb();
  await deleteRecord(db, id);
  db.close();
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

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(value) {
  if (!value) return "未设置月份";
  const [year, month] = value.split("-");
  return `${year}年${Number(month)}月维度`;
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
