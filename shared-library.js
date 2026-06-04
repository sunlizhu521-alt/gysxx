(function () {
  const DB_NAME = "supply-chain-library";
  const DB_VERSION = 3;
  const STORES = ["uploaded-files", "dimension-files", "fact-files"];
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
    const response = await fetch(`${SHARED_LIBRARY_URL}?v=20260530-13`, { cache: "no-store" });
    if (!response.ok) return { imported: 0, skipped: 0 };

    const payload = await response.json();
    const db = await openSharedDb();
    let imported = 0;
    let skipped = 0;

    try {
      for (const storeName of ["dimension-files", "fact-files"]) {
        const records = payload?.stores?.[storeName] || [];
        for (const record of records) {
          const existing = await getRecord(db, storeName, record.id);
          if (existing && !isSharedRecordNewer(record, existing)) {
            skipped += 1;
            continue;
          }
          await putRecord(db, storeName, await reviveSharedRecord(record));
          imported += 1;
        }
      }
    } finally {
      db.close();
    }

    return { imported, skipped };
  }

  function isSharedRecordNewer(sharedRecord, existingRecord) {
    const sharedDate = new Date(sharedRecord.savedAt || 0).getTime();
    const existingDate = new Date(existingRecord.savedAt || 0).getTime();
    return !existingRecord || sharedDate > existingDate;
  }

  async function reviveSharedRecord(record) {
    const bytes = base64ToBytes(record.dataBase64 || "");
    const file = new File([bytes], record.name, {
      type: record.mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    return {
      id: record.id,
      file,
      name: record.name,
      size: record.size || file.size,
      typeLabel: record.typeLabel || "Excel 工作簿",
      refreshMonth: record.refreshMonth,
      savedAt: record.savedAt,
      applied: Boolean(record.applied),
      appliedAt: record.appliedAt || null,
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

  function openSharedDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        STORES.forEach((storeName) => {
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

  function runStoreRequest(db, storeName, mode, createRequest) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const request = createRequest(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  }
})();
