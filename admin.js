const ADMIN_KEY = "3.1415926";
const ADMIN_SESSION_KEY = "supply-chain-admin-unlocked";
const DB_NAME = "supply-chain-library";
const DB_VERSION = 3;

const referenceSlots = [
  { store: "dimension-files", id: "dimension-1", library: "\u7ef4\u5ea6\u8868\u6587\u4ef6\u5e93", label: "Dim-YL\u533b\u7597\u5668\u68b0\u5546\u54c1\u5206\u7c7b" },
  { store: "dimension-files", id: "dimension-2", library: "\u7ef4\u5ea6\u8868\u6587\u4ef6\u5e93", label: "Dim-\u4ed3\u5e93_\u91d1\u8776\u3001\u65fa\u5e97\u901a\u3001\u9886\u661f" },
  { store: "dimension-files", id: "dimension-3", library: "\u7ef4\u5ea6\u8868\u6587\u4ef6\u5e93", label: "Dim-\u4ed3\u5e93\u4e0e\u7269\u6599\u5bf9\u7167\u8868" },
  { store: "dimension-files", id: "dimension-4", library: "\u7ef4\u5ea6\u8868\u6587\u4ef6\u5e93", label: "Dim-\u5e97\u94fa\u540d\u79f0\u6c47\u603b" },
  { store: "dimension-files", id: "dimension-5", library: "\u7ef4\u5ea6\u8868\u6587\u4ef6\u5e93", label: "Dim-\u5ba2\u6237\u4e0e\u7269\u6599\u5bf9\u7167\u8868" },
  { store: "dimension-files", id: "dimension-6", library: "\u7ef4\u5ea6\u8868\u6587\u4ef6\u5e93", label: "\u91c7\u8d2d\u5206\u5de5\u660e\u7ec6" },
  { store: "dimension-files", id: "dimension-7", library: "\u7ef4\u5ea6\u8868\u6587\u4ef6\u5e93", label: "\u7ef4\u5ea67" },
  { store: "dimension-files", id: "dimension-8", library: "\u7ef4\u5ea6\u8868\u6587\u4ef6\u5e93", label: "\u7ef4\u5ea68" },
  { store: "fact-files", id: "fact-1", library: "\u5907\u8d27\u4e8b\u5b9e\u8868\u5e93", label: "\u91c7\u8d2d\u8ba2\u5355\u8ddf\u8fdb\u8868" },
  { store: "fact-files", id: "fact-2", library: "\u5907\u8d27\u4e8b\u5b9e\u8868\u5e93", label: "\u4e8b\u5b9e\u88682" },
  { store: "fact-files", id: "fact-3", library: "\u5907\u8d27\u4e8b\u5b9e\u8868\u5e93", label: "\u4e8b\u5b9e\u88683" },
  { store: "fact-files", id: "fact-4", library: "\u5907\u8d27\u4e8b\u5b9e\u8868\u5e93", label: "\u4e8b\u5b9e\u88684" },
  { store: "fact-files", id: "fact-5", library: "\u5907\u8d27\u4e8b\u5b9e\u8868\u5e93", label: "\u4e8b\u5b9e\u88685" },
  { store: "fact-files", id: "fact-6", library: "\u5907\u8d27\u4e8b\u5b9e\u8868\u5e93", label: "\u4e8b\u5b9e\u88686" },
  { store: "fact-files", id: "fact-7", library: "\u5907\u8d27\u4e8b\u5b9e\u8868\u5e93", label: "\u4e8b\u5b9e\u88687" },
  { store: "fact-files", id: "fact-8", library: "\u5907\u8d27\u4e8b\u5b9e\u8868\u5e93", label: "\u4e8b\u5b9e\u88688" },
];

const adminEls = {
  gatePanel: document.querySelector("#adminGatePanel"),
  links: document.querySelector("#adminLinks"),
  keyInput: document.querySelector("#adminKey"),
  unlockButton: document.querySelector("#adminUnlockButton"),
  state: document.querySelector("#adminState"),
  referenceState: document.querySelector("#adminReferenceState"),
  referenceRows: document.querySelector("#adminReferenceRows"),
};

function unlockAdmin() {
  const value = adminEls.keyInput.value.trim();
  if (value !== ADMIN_KEY) {
    adminEls.state.textContent = "\u79d8\u94a5\u9519\u8bef";
    adminEls.keyInput.select();
    return;
  }
  sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
  showAdminLinks();
}

function showAdminLinks() {
  if (adminEls.gatePanel) adminEls.gatePanel.classList.add("unlocked");
  if (adminEls.links) adminEls.links.hidden = false;
  if (adminEls.state) adminEls.state.textContent = "\u5df2\u9a8c\u8bc1";
}

async function loadReferenceTimes() {
  try {
    const db = await openAppDb();
    const rows = [];
    for (const slot of referenceSlots) {
      const record = await getRecord(db, slot.store, slot.id);
      rows.push(renderReferenceRow(slot, record));
    }
    db.close();
    adminEls.referenceRows.innerHTML = rows.join("");
    adminEls.referenceState.textContent = "\u672c\u5730\u6587\u4ef6\u5e93";
  } catch (error) {
    console.warn("reference table unavailable", error);
    adminEls.referenceState.textContent = "\u8bfb\u53d6\u5931\u8d25";
    adminEls.referenceRows.innerHTML = `<tr><td colspan="7" class="empty-table-cell">\u6682\u65e0\u6587\u4ef6\u5e93\u8bb0\u5f55</td></tr>`;
  }
}

function renderReferenceRow(slot, record) {
  const applied = Boolean(record?.applied);
  return `
    <tr>
      <td>${escapeHtml(slot.library)}</td>
      <td>${escapeHtml(slot.label)}</td>
      <td>${escapeHtml(record?.name || "--")}</td>
      <td>${escapeHtml(record?.refreshMonth || "--")}</td>
      <td>${formatDateTime(record?.savedAt)}</td>
      <td>${formatDateTime(record?.appliedAt || record?.savedAt)}</td>
      <td><span class="slot-status ${applied ? "applied" : "pending"}">${applied ? "\u5df2\u5f15\u7528" : "\u672a\u5f15\u7528"}</span></td>
    </tr>
  `;
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
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

if (adminEls.unlockButton) {
  adminEls.unlockButton.addEventListener("click", unlockAdmin);
}
if (adminEls.keyInput) {
  adminEls.keyInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") unlockAdmin();
  });
}

sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
showAdminLinks();

loadReferenceTimes();
