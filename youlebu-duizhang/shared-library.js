(function () {
  const DB_NAME = "yile-reconciliation-library";
  const DB_VERSION = 1;
  const STORE_NAME = "file-slots";
  const SHARED_LIBRARY_URL = "./data/shared-library.json";

  let sharedLibraryPromise = null;

  window.ensureSharedLibraryLoaded = function ensureSharedLibraryLoaded() {
    if (!sharedLibraryPromise) {
      sharedLibraryPromise = hydrateSharedLibrary().catch((error) => {
        console.warn("shared library unavailable", error);
        return { imported: 0, skipped: 0 };
      });
    }
    return sharedLibraryPromise;
  };

  async function hydrateSharedLibrary() {
    const response = await fetch(`${SHARED_LIBRARY_URL}?v=20260608-1`, { cache: "no-store" });
    if (!response.ok) return { imported: 0, skipped: 0 };
    const payload = await response.json();
    const records = payload?.stores?.[STORE_NAME] || [];
    if (!records.length) return { imported: 0, skipped: 0 };

    const db = await openDb();
    let imported = 0;
    let skipped = 0;
    try {
      for (const record of records) {
        const existing = await getRecord(db, record.id);
        if (existing && !shouldImportSharedRecord(record, existing)) {
          skipped += 1;
          continue;
        }
        await putRecord(db, await reviveSharedRecord(record));
        imported += 1;
      }
    } finally {
      db.close();
    }
    return { imported, skipped };
  }

  function shouldImportSharedRecord(sharedRecord, existingRecord) {
    if (!existingRecord) return true;
    if (existingRecord.pendingFile || existingRecord.pendingSavedAt) return false;
    if (!existingRecord.sharedSource) return false;
    const sharedSavedAt = Date.parse(sharedRecord.savedAt || "");
    const existingSavedAt = Date.parse(existingRecord.savedAt || "");
    return Number.isFinite(sharedSavedAt) && (!Number.isFinite(existingSavedAt) || sharedSavedAt >= existingSavedAt);
  }

  async function reviveSharedRecord(record) {
    const file = new File([base64ToBytes(record.dataBase64 || "")], record.name || "shared-file", {
      type: record.mimeType || "application/octet-stream",
    });
    return {
      id: record.id,
      file,
      name: record.name,
      size: record.size || file.size,
      typeLabel: record.typeLabel || "文件",
      refreshMonth: record.refreshMonth || "",
      savedAt: record.savedAt || "",
      applied: Boolean(record.applied),
      appliedAt: record.appliedAt || "",
      sharedSource: true,
      sharedSavedAt: record.savedAt || "",
    };
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
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

  function runStoreRequest(db, mode, createRequest) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = createRequest(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  }
})();
