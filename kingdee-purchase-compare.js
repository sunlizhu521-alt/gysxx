const compareEls = {
  filterBar: document.querySelector("#kingdeeFilterBar"),
  search: document.querySelector("#kingdeeSearch"),
  resetButton: document.querySelector("#kingdeeResetButton"),
  state: document.querySelector("#kingdeeCompareState"),
  rows: document.querySelector("#kingdeeCompareRows"),
  kingdeeHeader: document.querySelector("#kingdeeDataHeader"),
  undeliveredHeader: document.querySelector("#undeliveredDataHeader"),
  differenceHeader: document.querySelector("#differenceDataHeader"),
};

const compareFilterConfigs = [
  { key: "orderUser", id: "orderUserCompareFilter", label: "全部采购订单下单人", options: [] },
  { key: "businessUnit", id: "businessUnitCompareFilter", label: "全部事业部", options: [] },
  { key: "supplierShort", id: "supplierShortCompareFilter", label: "全部供应商简称", options: [] },
  { key: "salesLine", id: "salesLineCompareFilter", label: "全部销售产品线", options: [] },
  { key: "salesSeries", id: "salesSeriesCompareFilter", label: "全部销售系列", options: [] },
  {
    key: "compareMetric",
    id: "compareMetricFilter",
    label: "对比数据",
    options: ["下单数量", "剩余数量"],
    single: true,
  },
];

const compareState = {
  selectedFilters: Object.fromEntries(compareFilterConfigs.map((config) => [config.key, new Set()])),
};

function initKingdeeComparePage() {
  compareFilterConfigs.forEach(renderCompareFilter);
  compareState.selectedFilters.compareMetric.add("下单数量");
  updateCompareFilters();
  updateCompareHeaders();
  bindCompareEvents();
}

function bindCompareEvents() {
  compareEls.filterBar.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-filter-toggle]");
    if (toggle) {
      closeCompareFilters(toggle.dataset.filterToggle);
      getFilterElement(toggle.dataset.filterToggle)?.classList.toggle("open");
      return;
    }

    const option = event.target.closest("[data-filter-option]");
    if (!option) return;
    event.preventDefault();
    toggleCompareOption(option.dataset.filterKey, option.dataset.filterOption);
    updateCompareFilters();
    updateCompareHeaders();
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#kingdeeFilterBar")) closeCompareFilters();
  });

  compareEls.resetButton.addEventListener("click", () => {
    compareEls.search.value = "";
    Object.values(compareState.selectedFilters).forEach((set) => set.clear());
    compareState.selectedFilters.compareMetric.add("下单数量");
    updateCompareFilters();
    updateCompareHeaders();
  });
}

function renderCompareFilter(config) {
  const element = document.querySelector(`#${config.id}`);
  element.innerHTML = `
    <button class="multi-filter-button" type="button" data-filter-toggle="${config.key}">
      <span>${config.label}</span>
      <i aria-hidden="true">▾</i>
    </button>
    <div class="multi-filter-menu" role="menu"></div>
  `;
}

function updateCompareFilters() {
  compareFilterConfigs.forEach((config) => {
    const element = getFilterElement(config.key);
    const selected = compareState.selectedFilters[config.key] || new Set();
    const button = element.querySelector(".multi-filter-button span");
    const menu = element.querySelector(".multi-filter-menu");
    button.textContent = getCompareFilterLabel(config, selected);
    menu.innerHTML = renderCompareOptions(config, selected);
  });
}

function renderCompareOptions(config, selected) {
  const allSelected = !selected.size;
  const allOption = config.single
    ? ""
    : `
      <label class="multi-filter-option ${allSelected ? "selected" : ""}" data-filter-key="${config.key}" data-filter-option="all">
        <input type="checkbox" ${allSelected ? "checked" : ""} />
        <span>${escapeHtml(config.label)}</span>
      </label>`;
  const options = config.options.length ? config.options : ["等待数据"];
  return `
    ${allOption}
    ${options
      .map((value) => {
        const disabled = value === "等待数据";
        const checked = selected.has(value);
        return `
          <label class="multi-filter-option ${checked ? "selected" : ""}" data-filter-key="${config.key}" data-filter-option="${escapeAttribute(value)}">
            <input type="checkbox" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />
            <span>${escapeHtml(value)}</span>
          </label>`;
      })
      .join("")}
  `;
}

function toggleCompareOption(key, value) {
  const config = compareFilterConfigs.find((item) => item.key === key);
  const selected = compareState.selectedFilters[key];
  if (!config || !selected || value === "等待数据") return;
  if (value === "all") {
    selected.clear();
    return;
  }
  if (config.single) {
    selected.clear();
    selected.add(value);
    return;
  }
  if (selected.has(value)) selected.delete(value);
  else selected.add(value);
}

function updateCompareHeaders() {
  const metric = [...compareState.selectedFilters.compareMetric][0] || "下单数量";
  compareEls.kingdeeHeader.textContent = `${metric}-金蝶数据`;
  compareEls.undeliveredHeader.textContent = `${metric}-未交付表数据`;
  compareEls.differenceHeader.textContent = `${metric}-差异数据`;
  compareEls.state.textContent = "等待数据来源规则";
  compareEls.rows.innerHTML = `<tr><td colspan="8" class="empty-table-cell">等待数据来源规则</td></tr>`;
}

function getCompareFilterLabel(config, selected) {
  if (!selected.size) return config.label;
  if (selected.size === 1) return [...selected][0];
  return `已选${selected.size}项`;
}

function getFilterElement(key) {
  const config = compareFilterConfigs.find((item) => item.key === key);
  return config ? document.querySelector(`#${config.id}`) : null;
}

function closeCompareFilters(exceptKey = "") {
  compareFilterConfigs.forEach((config) => {
    if (config.key !== exceptKey) getFilterElement(config.key)?.classList.remove("open");
  });
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

function escapeAttribute(value) {
  return escapeHtml(value);
}

initKingdeeComparePage();
