const DB_NAME = "yile-reconciliation-library";
const DB_VERSION = 1;
const STORE_NAME = "file-slots";

const slots = [
  { id: "file-1", label: "旺店通代发表" },
  { id: "file-2", label: "运营登记表" },
  { id: "file-3", label: "易乐对账表" },
  { id: "file-4", label: "对账文件 4" },
];

const generateSlotIds = {
  wdt: "file-1",
  operation: "file-2",
  yile: "file-3",
};

const CHECK_COLUMN_INDEX = 22;
const REMARK_COLUMN_INDEX = 23;
const TABLE_BORDER_STYLE = {
  style: "thin",
  color: { rgb: "FFB7C4D6" },
};
const HEADER_FILL = {
  patternType: "solid",
  fgColor: { rgb: "FFD9EAF7" },
};
const HEADER_FONT = {
  bold: true,
  color: { rgb: "FF1F2933" },
};
const CENTER_ALIGNMENT = {
  horizontal: "center",
  vertical: "center",
};

const els = {
  slotGrid: document.querySelector("#slotGrid"),
  applyAllButton: document.querySelector("#applyAllButton"),
  generateButton: document.querySelector("#generateButton"),
  clearCacheButton: document.querySelector("#clearCacheButton"),
  libraryState: document.querySelector("#libraryState"),
  sourceNote: document.querySelector("#librarySourceNote"),
  slotCount: document.querySelector("#slotCount"),
  uploadedCount: document.querySelector("#uploadedCount"),
  appliedCount: document.querySelector("#appliedCount"),
  latestMonth: document.querySelector("#latestMonth"),
  yileTotalRows: document.querySelector("#yileTotalRows"),
  verifiedCount: document.querySelector("#verifiedCount"),
  pendingCount: document.querySelector("#pendingCount"),
  returnCount: document.querySelector("#returnCount"),
  noRecordCount: document.querySelector("#noRecordCount"),
};

const state = {
  records: new Map(),
  isGenerating: false,
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
  els.generateButton?.addEventListener("click", generateReconciliationWorkbook);
  els.clearCacheButton?.addEventListener("click", clearLibraryCache);
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

  els.applyAllButton.disabled = true;
  els.libraryState.textContent = "刷新应用中";
  try {
    for (const slotId of targetSlotIds) {
      await applySlot(slotId, { skipRefresh: true });
    }
    await refresh();
    const result = await refreshReconciliationMetrics();
    if (!result && !els.libraryState.textContent.startsWith("请先上传")) {
      els.libraryState.textContent = targetSlotIds.length ? "已刷新应用" : "暂无待应用文件";
    }
  } catch (error) {
    console.warn("apply all failed", error);
    els.libraryState.textContent = error.message || "刷新应用失败";
  } finally {
    updateApplyAllButton();
  }
}

async function deleteSlot(slotId) {
  const db = await openDb();
  await deleteRecord(db, slotId);
  db.close();
  await refresh();
}

async function clearLibraryCache() {
  const confirmed = window.confirm("确认清除当前浏览器里的对账文件缓存吗？清除后需要重新上传并应用文件。");
  if (!confirmed) return;

  els.clearCacheButton.disabled = true;
  els.libraryState.textContent = "清除中";
  try {
    await deleteLibraryDatabase();
    state.records = new Map();
    updateReconciliationMetrics();
    render();
    els.libraryState.textContent = "已清除缓存";
  } catch (error) {
    console.warn("clear library cache failed", error);
    els.libraryState.textContent = "清除失败";
    window.alert(error.message || "清除缓存失败，请关闭其他对账页面后重试。");
  } finally {
    els.clearCacheButton.disabled = false;
  }
}

async function generateReconciliationWorkbook() {
  if (state.isGenerating) return;
  state.isGenerating = true;
  updateGenerateButton();
  els.libraryState.textContent = "生成中";

  try {
    const { sources, yileWorkbook, result } = await buildReconciliationWorkbookResult();
    updateReconciliationMetrics(result);
    window.XLSX.writeFile(yileWorkbook, buildGeneratedFileName(sources.yile.name));
    els.libraryState.textContent = `已生成 ${result.checkedRows} 行`;
  } catch (error) {
    console.warn("generate reconciliation workbook failed", error);
    els.libraryState.textContent = "生成失败";
    window.alert(error.message || "一键生成表失败，请检查文件后重试。");
  } finally {
    state.isGenerating = false;
    updateGenerateButton();
  }
}

async function refreshReconciliationMetrics() {
  try {
    const { result } = await buildReconciliationWorkbookResult();
    updateReconciliationMetrics(result);
    els.libraryState.textContent = `已统计 ${result.checkedRows} 行`;
    return result;
  } catch (error) {
    console.warn("refresh reconciliation metrics failed", error);
    if (error.code === "MISSING_RECONCILIATION_SOURCES") {
      updateReconciliationMetrics();
      els.libraryState.textContent = error.message;
      return null;
    }
    els.libraryState.textContent = "统计失败";
    throw error;
  }
}

async function buildReconciliationWorkbookResult() {
  if (!window.XLSX) {
    throw new Error("Excel 解析组件未加载，请刷新页面后重试。");
  }

  const sources = getGenerateSourceRecords();
  const missingLabels = Object.entries(sources)
    .filter(([, record]) => !record?.file)
    .map(([key]) => getGenerateSourceLabel(key));
  if (missingLabels.length) {
    const error = new Error(`请先上传并应用：${missingLabels.join("、")}`);
    error.code = "MISSING_RECONCILIATION_SOURCES";
    throw error;
  }

  const [wdtWorkbook, operationWorkbook, yileWorkbook] = await Promise.all([
    readWorkbook(sources.wdt.file),
    readWorkbook(sources.operation.file),
    readWorkbook(sources.yile.file),
  ]);
  const wdtEntries = buildWorkbookSearchEntries(wdtWorkbook);
  const operationSets = buildOperationSearchSets(operationWorkbook);
  const yileSheetName = pickYileSheetName(yileWorkbook);
  const yileSheet = yileWorkbook.Sheets[yileSheetName];
  if (!yileSheet) throw new Error("易乐对账表没有可读取的工作表。");

  const result = fillReconciliationSheet(yileSheet, operationSets, wdtEntries);
  return { sources, yileWorkbook, result };
}

function getGenerateSourceRecords() {
  return {
    wdt: getAppliedFileRecord(generateSlotIds.wdt),
    operation: getAppliedFileRecord(generateSlotIds.operation),
    yile: getAppliedFileRecord(generateSlotIds.yile),
  };
}

function getAppliedFileRecord(slotId) {
  const record = state.records.get(slotId);
  return record?.applied && record?.file ? record : null;
}

function getGenerateSourceLabel(key) {
  return {
    wdt: "旺店通代发表",
    operation: "运营登记表",
    yile: "易乐对账表",
  }[key] || key;
}

async function readWorkbook(file) {
  const extension = String(file?.name || "").split(".").pop()?.toLowerCase();
  if (extension === "csv" || extension === "txt") {
    return window.XLSX.read(await file.text(), {
      type: "string",
      raw: false,
      cellStyles: true,
      cellHTML: true,
      cellText: true,
    });
  }
  return window.XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellStyles: true,
    cellHTML: true,
    cellText: true,
  });
}

function buildOperationSearchSets(workbook) {
  const vehicleGroups = [
    {
      label: "D75（985S）发货表",
      names: getSheetNamesByMatcher(workbook, (name) => {
        const normalized = normalizeSearchValue(name);
        return normalized.includes("d75") || normalized.includes("985s");
      }),
    },
    {
      label: "D52&D36发货表",
      names: getSheetNamesByMatcher(workbook, (name) => {
        const normalized = normalizeSearchValue(name);
        return normalized.includes("d52") && normalized.includes("d36");
      }),
    },
  ];
  const partsNames = getSheetNamesByMatcher(workbook, (name) => normalizeSearchValue(name).includes("配件表"));
  const vehicleNames = [...new Set(vehicleGroups.flatMap((group) => group.names))];
  return {
    vehicle: buildWorkbookSearchEntries(workbook, vehicleNames),
    vehicleMissing: vehicleGroups.filter((group) => !group.names.length).map((group) => group.label),
    parts: buildWorkbookSearchEntries(workbook, partsNames),
    partsMissing: partsNames.length ? [] : ["配件表"],
  };
}

function getSheetNamesByMatcher(workbook, matcher) {
  return (workbook.SheetNames || []).filter((name) => matcher(String(name || "")));
}

function buildWorkbookSearchEntries(workbook, sheetNames = workbook.SheetNames || []) {
  return sheetNames.flatMap((sheetName) => buildSheetSearchEntries(workbook.Sheets[sheetName], sheetName));
}

function buildSheetSearchEntries(sheet, sheetName) {
  if (!sheet) return [];
  return Object.entries(sheet)
    .filter(([address]) => !address.startsWith("!"))
    .map(([address, cell]) => {
      const text = getCellText(cell);
      return text
        ? {
            address,
            sheetName,
            text,
            normalized: normalizeSearchValue(text),
            red: isRedFontCell(cell),
            returnLike: isReturnOrUnshippedText(text),
          }
        : null;
    })
    .filter(Boolean);
}

function pickYileSheetName(workbook) {
  return (
    (workbook.SheetNames || []).find((name) => String(name || "").includes("对账")) ||
    (workbook.SheetNames || [])[0]
  );
}

function fillReconciliationSheet(sheet, operationSets, wdtEntries) {
  const range = window.XLSX.utils.decode_range(sheet["!ref"] || "A1:X1");
  const headerRow = range.s.r;
  const maxRow = Math.max(range.e.r, headerRow);
  const originalDataMaxColumn = Math.min(Math.max(range.e.c, 6), CHECK_COLUMN_INDEX - 1);
  const stats = {
    checkedRows: 0,
    verifiedCount: 0,
    pendingCount: 0,
    returnCount: 0,
    noRecordCount: 0,
  };

  writeTextCell(sheet, headerRow, CHECK_COLUMN_INDEX, "核对确认");
  writeTextCell(sheet, headerRow, REMARK_COLUMN_INDEX, "备注");

  for (let rowIndex = headerRow + 1; rowIndex <= maxRow; rowIndex += 1) {
    if (!rowHasAnyValue(sheet, rowIndex, originalDataMaxColumn)) continue;
    const type = getSheetCellText(sheet, rowIndex, 1);
    const customer = getSheetCellText(sheet, rowIndex, 2);
    const trackingNumber = getSheetCellText(sheet, rowIndex, 6);
    const result = getRowReconciliationResult(type, customer, trackingNumber, operationSets, wdtEntries);
    writeTextCell(sheet, rowIndex, CHECK_COLUMN_INDEX, result.status);
    writeTextCell(sheet, rowIndex, REMARK_COLUMN_INDEX, result.remark);
    stats.checkedRows += 1;
    if (result.status === "已核实") stats.verifiedCount += 1;
    if (result.status === "待核实") stats.pendingCount += 1;
    if (isReturnRemark(result.remark)) stats.returnCount += 1;
    if (result.status === "无记录") stats.noRecordCount += 1;
  }

  range.e.c = Math.max(range.e.c, REMARK_COLUMN_INDEX);
  range.e.r = Math.max(range.e.r, maxRow);
  sheet["!ref"] = window.XLSX.utils.encode_range(range);
  applyGeneratedTableStyle(sheet, headerRow, range);
  ensureOutputColumnWidths(sheet);
  return stats;
}

function getRowReconciliationResult(type, customer, trackingNumber, operationSets, wdtEntries) {
  const typeText = String(type || "").trim();
  if (!isVehiclePurchase(typeText) && !isPartsPurchase(typeText)) {
    return { status: typeText, remark: "" };
  }

  const operationEntries = isVehiclePurchase(typeText)
    ? getRequiredOperationEntries(operationSets.vehicle, operationSets.vehicleMissing, typeText)
    : getRequiredOperationEntries(operationSets.parts, operationSets.partsMissing, typeText);
  const customerResult = evaluateLookup(customer, operationEntries, wdtEntries);
  if (customerResult.both) {
    return { status: "已核实", remark: customerResult.returnLike ? "退货/未发" : "" };
  }

  const trackingResult = evaluateLookup(trackingNumber, operationEntries, wdtEntries);
  const hasAnyMatch = customerResult.any || trackingResult.any;
  const hasReturnLikeMatch = customerResult.returnLike || trackingResult.returnLike;
  if (trackingResult.both) {
    return { status: "已核实", remark: hasReturnLikeMatch ? "退货/未发" : "" };
  }
  return {
    status: hasAnyMatch ? "待核实" : "无记录",
    remark: hasReturnLikeMatch ? "退货/未发" : "",
  };
}

function getRequiredOperationEntries(entries, missingLabels, typeText) {
  if (missingLabels.length) {
    throw new Error(`${typeText} 缺少运营登记表 sheet：${missingLabels.join("、")}`);
  }
  return entries;
}

function isVehiclePurchase(typeText) {
  return String(typeText || "").trim().includes("整车购买");
}

function isPartsPurchase(typeText) {
  return String(typeText || "").trim().includes("配件购买");
}

function evaluateLookup(query, operationEntries, wdtEntries) {
  const operationResult = searchEntries(query, operationEntries);
  const wdtResult = searchEntries(query, wdtEntries);
  return {
    operationFound: operationResult.found,
    wdtFound: wdtResult.found,
    both: operationResult.found && wdtResult.found,
    any: operationResult.found || wdtResult.found,
    returnLike: operationResult.returnLike || wdtResult.returnLike,
  };
}

function searchEntries(query, entries) {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return { found: false, returnLike: false };
  let found = false;
  let returnLike = false;
  for (const entry of entries) {
    if (!entry.normalized || !entry.normalized.includes(normalizedQuery)) continue;
    found = true;
    if (entry.red || entry.returnLike) returnLike = true;
  }
  return { found, returnLike };
}

function rowHasAnyValue(sheet, rowIndex, maxColumnIndex) {
  for (let columnIndex = 0; columnIndex <= maxColumnIndex; columnIndex += 1) {
    if (getSheetCellText(sheet, rowIndex, columnIndex)) return true;
  }
  return false;
}

function getSheetCellText(sheet, rowIndex, columnIndex) {
  return getCellText(sheet[window.XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })]);
}

function getCellText(cell) {
  if (!cell) return "";
  return String(cell.w ?? cell.v ?? "").trim();
}

function writeTextCell(sheet, rowIndex, columnIndex, value) {
  sheet[window.XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })] = {
    t: "s",
    v: String(value ?? ""),
  };
}

function ensureOutputColumnWidths(sheet) {
  const columns = sheet["!cols"] || [];
  columns[CHECK_COLUMN_INDEX] = { ...(columns[CHECK_COLUMN_INDEX] || {}), wch: 12 };
  columns[REMARK_COLUMN_INDEX] = { ...(columns[REMARK_COLUMN_INDEX] || {}), wch: 10 };
  sheet["!cols"] = columns;
}

function applyGeneratedTableStyle(sheet, headerRow, range) {
  const styledRange = {
    s: { r: headerRow, c: range.s.c },
    e: { r: range.e.r, c: Math.max(range.e.c, REMARK_COLUMN_INDEX) },
  };
  sheet["!autofilter"] = {
    ref: window.XLSX.utils.encode_range({
      s: { r: headerRow, c: styledRange.s.c },
      e: { r: headerRow, c: styledRange.e.c },
    }),
  };

  for (let rowIndex = styledRange.s.r; rowIndex <= styledRange.e.r; rowIndex += 1) {
    for (let columnIndex = styledRange.s.c; columnIndex <= styledRange.e.c; columnIndex += 1) {
      const address = window.XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = sheet[address] || { t: "s", v: "" };
      cell.s = {
        ...(cell.s || {}),
        border: getCellBorder(),
        alignment: { ...(cell.s?.alignment || {}), ...CENTER_ALIGNMENT },
      };
      if (rowIndex === headerRow) {
        cell.s = {
          ...cell.s,
          fill: { ...(cell.s.fill || {}), ...HEADER_FILL },
          font: { ...(cell.s.font || {}), ...HEADER_FONT },
        };
      }
      sheet[address] = cell;
    }
  }
}

function getCellBorder() {
  return {
    top: TABLE_BORDER_STYLE,
    bottom: TABLE_BORDER_STYLE,
    left: TABLE_BORDER_STYLE,
    right: TABLE_BORDER_STYLE,
  };
}

function isRedFontCell(cell) {
  if (!cell) return false;
  const fontColor = cell.s?.font?.color;
  if (isRedColor(fontColor?.rgb) || isRedIndexedColor(fontColor?.indexed)) return true;
  if (Array.isArray(cell.r) && cell.r.some((run) => isRedColor(run?.s?.color?.rgb))) return true;
  return /color\s*:\s*(#?ff0000|#?c00000|red)\b/i.test(String(cell.h || ""));
}

function isReturnOrUnshippedText(value) {
  return /(取消|退款)/.test(String(value || ""));
}

function isReturnRemark(value) {
  return /(退货|未发)/.test(String(value || ""));
}

function isRedIndexedColor(indexed) {
  return Number(indexed) === 3 || Number(indexed) === 10;
}

function isRedColor(value) {
  const raw = String(value || "").replace(/[^0-9a-f]/gi, "");
  if (!raw) return false;
  const hex = raw.length > 6 ? raw.slice(-6) : raw.padStart(6, "0");
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return red >= 180 && green <= 90 && blue <= 90;
}

function normalizeSearchValue(value) {
  return String(value ?? "")
    .trim()
    .replace(/\.0$/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function buildGeneratedFileName(sourceName) {
  const baseName = sanitizeFileNamePart(String(sourceName || "易乐对账表").replace(/\.[^.]+$/, "")) || "易乐对账表";
  const stamp = formatFileTimestamp(new Date());
  return `${baseName}_已核对_${stamp}.xlsx`;
}

function formatFileTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function sanitizeFileNamePart(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "");
}

function render() {
  els.slotCount.textContent = String(slots.length);
  els.uploadedCount.textContent = String(countUploadedRecords());
  els.appliedCount.textContent = String(countAppliedRecords());
  els.latestMonth.textContent = getLatestMonth();
  els.sourceNote.textContent = `本地文件库｜引用时间：${getLatestAppliedTime()}`;
  els.slotGrid.innerHTML = slots.map(renderSlot).join("");
  updateReconciliationMetrics();
  els.libraryState.textContent = "本地文件库";
  updateApplyAllButton();
  updateGenerateButton();
}

function updateReconciliationMetrics(stats = {}) {
  if (els.yileTotalRows) els.yileTotalRows.textContent = String(stats.checkedRows || 0);
  if (els.verifiedCount) els.verifiedCount.textContent = String(stats.verifiedCount || 0);
  if (els.pendingCount) els.pendingCount.textContent = String(stats.pendingCount || 0);
  if (els.returnCount) els.returnCount.textContent = String(stats.returnCount || 0);
  if (els.noRecordCount) els.noRecordCount.textContent = String(stats.noRecordCount || 0);
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
  const hasAnyRecord = slots.some((slot) => {
    const record = state.records.get(slot.id);
    return record?.pendingFile || record?.file || record;
  });
  els.applyAllButton.disabled = !hasAnyRecord;
}

function updateGenerateButton() {
  if (!els.generateButton) return;
  const sources = getGenerateSourceRecords();
  const hasRequiredSources = Boolean(sources.wdt?.file && sources.operation?.file && sources.yile?.file);
  els.generateButton.disabled = state.isGenerating || !hasRequiredSources;
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

function deleteLibraryDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("文件库正被其他页面占用，请关闭其他对账页面后重试。"));
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
