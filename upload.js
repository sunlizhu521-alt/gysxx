const DB_NAME = "supply-chain-library";
const DB_VERSION = 1;
const STORE_NAME = "uploaded-files";
const FILE_KEY = "current-file";

const uploadState = {
  selectedFile: null,
  applied: false,
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
    if (!uploadState.selectedFile) return;
    uploadState.applied = true;
    await saveCurrentFile();
    renderFileState();
  });

  uploadEls.deleteButton.addEventListener("click", async () => {
    await deleteSavedFile();
    uploadState.selectedFile = null;
    uploadState.applied = false;
    uploadEls.fileInput.value = "";
    renderFileState();
  });
}

async function handleSelectedFile(file) {
  if (!file) return;
  uploadState.selectedFile = file;
  uploadState.applied = false;
  await saveCurrentFile();
  renderFileState();
}

async function restoreSavedFile() {
  const record = await readSavedFile();
  if (!record?.file) {
    renderFileState();
    return;
  }
  uploadState.selectedFile = record.file;
  uploadState.applied = Boolean(record.applied);
  renderFileState();
}

function renderFileState() {
  const file = uploadState.selectedFile;
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
  uploadEls.applyStatus.textContent = uploadState.applied ? "已应用" : "待应用";
  uploadEls.uploadState.textContent = uploadState.applied ? "文件已应用" : "已保存文件";
  uploadEls.applyButton.disabled = uploadState.applied;
  uploadEls.deleteButton.disabled = false;
}

async function saveCurrentFile() {
  if (!uploadState.selectedFile) return;
  const db = await openUploadDb();
  await putRecord(db, {
    id: FILE_KEY,
    file: uploadState.selectedFile,
    applied: uploadState.applied,
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

initUpload().catch((error) => {
  console.error(error);
  uploadEls.uploadState.textContent = "上传功能异常";
});
