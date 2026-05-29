const state = {
  documents: [],
  filtered: [],
  sortKey: "updatedAt",
  sortDirection: "desc",
};

const statusColors = {
  有效: "#2f9e44",
  待补充: "#d98b11",
  已归档: "#637083",
};

const els = {
  search: document.querySelector("#searchInput"),
  category: document.querySelector("#categoryFilter"),
  status: document.querySelector("#statusFilter"),
  rows: document.querySelector("#documentRows"),
  total: document.querySelector("#totalDocuments"),
  activeRatio: document.querySelector("#activeRatio"),
  categoryCount: document.querySelector("#categoryCount"),
  ownerCount: document.querySelector("#ownerCount"),
  pendingCount: document.querySelector("#pendingCount"),
  visibleCount: document.querySelector("#visibleCount"),
  categoryBars: document.querySelector("#categoryBars"),
  actionList: document.querySelector("#actionList"),
  statusChart: document.querySelector("#statusChart"),
  reset: document.querySelector("#resetButton"),
  sortButtons: document.querySelectorAll(".sort-button"),
};

async function init() {
  if (Array.isArray(window.DOCUMENTS_DATA)) {
    state.documents = window.DOCUMENTS_DATA;
  } else {
    const response = await fetch("./data/documents.json");
    state.documents = await response.json();
  }
  hydrateFilters();
  bindEvents();
  applyFilters();
}

function hydrateFilters() {
  const categories = [...new Set(state.documents.map((item) => item.category))].sort();
  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    els.category.appendChild(option);
  });
}

function bindEvents() {
  [els.search, els.category, els.status].forEach((el) => {
    el.addEventListener("input", applyFilters);
  });

  els.reset.addEventListener("click", () => {
    els.search.value = "";
    els.category.value = "all";
    els.status.value = "all";
    state.sortKey = "updatedAt";
    state.sortDirection = "desc";
    applyFilters();
  });

  els.sortButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextKey = button.dataset.sort;
      state.sortDirection = state.sortKey === nextKey && state.sortDirection === "desc" ? "asc" : "desc";
      state.sortKey = nextKey;
      applyFilters();
    });
  });
}

function applyFilters() {
  const query = els.search.value.trim().toLowerCase();
  const category = els.category.value;
  const status = els.status.value;

  state.filtered = state.documents
    .filter((doc) => {
      const searchable = [
        doc.title,
        doc.category,
        doc.supplier,
        doc.material,
        doc.tags.join(" "),
        doc.owner,
        doc.department,
        doc.summary,
      ]
        .join(" ")
        .toLowerCase();
      const matchesQuery = !query || searchable.includes(query);
      const matchesCategory = category === "all" || doc.category === category;
      const matchesStatus = status === "all" || doc.status === status;
      return matchesQuery && matchesCategory && matchesStatus;
    })
    .sort((a, b) => {
      const direction = state.sortDirection === "desc" ? -1 : 1;
      if (state.sortKey === "updatedAt") {
        return (new Date(a.updatedAt) - new Date(b.updatedAt)) * direction;
      }
      return String(a[state.sortKey]).localeCompare(String(b[state.sortKey]), "zh-CN") * direction;
    });

  render();
}

function render() {
  renderMetrics();
  renderRows();
  renderStatusChart();
  renderCategoryBars();
  renderActions();
  renderSortState();
}

function renderMetrics() {
  const all = state.documents;
  const active = all.filter((item) => item.status === "有效").length;
  const categories = new Set(all.map((item) => item.category)).size;
  const owners = new Set(all.map((item) => item.owner)).size;
  const pending = all.filter((item) => item.status === "待补充").length;

  els.total.textContent = all.length;
  els.activeRatio.textContent = `${Math.round((active / Math.max(all.length, 1)) * 100)}% 可直接打开`;
  els.categoryCount.textContent = categories;
  els.ownerCount.textContent = owners;
  els.pendingCount.textContent = pending;
  els.visibleCount.textContent = state.filtered.length;
}

function renderRows() {
  els.rows.innerHTML = state.filtered
    .map(
      (doc) => `
        <tr>
          <td>
            <span class="doc-name">
              <strong>${escapeHtml(doc.title)}</strong>
              <small>${escapeHtml(doc.summary)}</small>
            </span>
          </td>
          <td>${escapeHtml(doc.category)}</td>
          <td>${escapeHtml(doc.supplier)}</td>
          <td>${escapeHtml(doc.material)}</td>
          <td>${renderTags(doc.tags)}</td>
          <td>${escapeHtml(doc.owner)}</td>
          <td>${escapeHtml(doc.department)}</td>
          <td>${formatDate(doc.updatedAt)}</td>
          <td><span class="badge ${doc.status === "有效" ? "status-active" : "status-review"}">${escapeHtml(doc.status)}</span></td>
          <td><a class="open-link" href="${doc.link}" target="_blank" rel="noopener noreferrer">打开钉钉文档</a></td>
        </tr>
      `
    )
    .join("");
}

function renderStatusChart() {
  const ctx = els.statusChart.getContext("2d");
  const width = els.statusChart.width;
  const center = width / 2;
  const radius = 102;
  const lineWidth = 30;
  const counts = countBy(state.filtered, "status");
  const total = Math.max(state.filtered.length, 1);
  let start = -Math.PI / 2;

  ctx.clearRect(0, 0, width, els.statusChart.height);
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";

  ["有效", "待补充", "已归档"].forEach((status) => {
    const value = counts[status] || 0;
    const angle = (value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.strokeStyle = value ? statusColors[status] : "#e6edf5";
    ctx.arc(center, center, radius, start, start + Math.max(angle - 0.04, 0.02));
    ctx.stroke();
    start += angle;
  });
}

function renderCategoryBars() {
  const counts = countBy(state.filtered, "category");
  const max = Math.max(...Object.values(counts), 1);
  els.categoryBars.innerHTML = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([category, count]) => `
        <div class="bar-row">
          <span>${escapeHtml(category)}</span>
          <span class="bar-track"><span class="bar-fill" style="width: ${(count / max) * 100}%"></span></span>
          <strong>${count}</strong>
        </div>
      `
    )
    .join("");
}

function renderActions() {
  const actions = state.documents
    .filter((item) => item.status !== "已归档")
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 5);

  els.actionList.innerHTML = actions
    .map(
      (item) => `
        <div class="action-item ${item.status === "待补充" ? "high" : ""}">
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.nextAction)}</span>
        </div>
      `
    )
    .join("");
}

function renderSortState() {
  els.sortButtons.forEach((button) => {
    button.classList.toggle("active-sort", button.dataset.sort === state.sortKey);
  });
}

function countBy(items, key) {
  return items.reduce((result, item) => {
    result[item[key]] = (result[item[key]] || 0) + 1;
    return result;
  }, {});
}

function renderTags(tags) {
  return tags.map((tag) => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join("");
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

init().catch((error) => {
  console.error(error);
  els.rows.innerHTML = `<tr><td colspan="10">数据加载失败，请检查 data/documents.json。</td></tr>`;
});
