const uploadState = {
  selectedFile: null,
};

const uploadEls = {
  fileInput: document.querySelector("#fileInput"),
  uploadDropzone: document.querySelector("#uploadDropzone"),
  uploadState: document.querySelector("#uploadState"),
  fileName: document.querySelector("#fileName"),
  fileSize: document.querySelector("#fileSize"),
  fileType: document.querySelector("#fileType"),
  analysisButton: document.querySelector("#analysisButton"),
};

function initUpload() {
  uploadEls.fileInput.addEventListener("change", (event) => {
    handleSelectedFile(event.target.files[0]);
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

  uploadEls.uploadDropzone.addEventListener("drop", (event) => {
    handleSelectedFile(event.dataTransfer.files[0]);
  });

  uploadEls.analysisButton.addEventListener("click", () => {
    uploadEls.uploadState.textContent = "文件已就绪";
    uploadEls.analysisButton.textContent = "等待分析逻辑";
  });
}

function handleSelectedFile(file) {
  if (!file) return;
  uploadState.selectedFile = file;
  uploadEls.fileName.textContent = file.name;
  uploadEls.fileSize.textContent = formatFileSize(file.size);
  uploadEls.fileType.textContent = getFileTypeLabel(file);
  uploadEls.uploadState.textContent = "已选择文件";
  uploadEls.analysisButton.disabled = false;
  uploadEls.analysisButton.textContent = "生成看板";
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

initUpload();
