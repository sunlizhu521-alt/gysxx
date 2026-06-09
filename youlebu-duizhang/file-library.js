const DB_NAME = "youlebu-reconciliation-library";
const DB_VERSION = 1;
const STORE_NAME = "file-slots";

const slots = [
  { id: "file-1", label: "运营登记表" },
  { id: "file-2", label: "优乐步对账表" },
  { id: "file-3", label: "对账文件3" },
  { id: "file-4", label: "优乐步对账 4" },
];

const generateSlotIds = {
  wdt: "file-1",
  operation: "file-2",
  yile: "file-3",
};

const OPERATION_SLOT_ID = generateSlotIds.operation;
const DEFAULT_SLOT_ACCEPT = ".xlsx,.xls,.csv,.txt,.pdf";
const OPERATION_SLOT_ACCEPT = ".xlsx,.xlsm";
const OPERATION_FORMAT_MESSAGE = "优乐步对账表需要上传 .xlsx 或 .xlsm 格式，才能保留原表格式；如果是 .xls，请先在 Excel 中另存为 .xlsx 后再上传。";
const NAME_COLUMN_INDEX = 12;
const TRACKING_COLUMN_INDEX = 13;
const CHECK_COLUMN_INDEX = 16;
const REMARK_COLUMN_INDEX = 17;
const OUTPUT_LAST_COLUMN_INDEX = REMARK_COLUMN_INDEX;
const OUTPUT_START_ROW_INDEX = 2;
const PROTECTED_LAST_COLUMN_INDEX = TRACKING_COLUMN_INDEX;
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
    if (input) {
      await savePendingFile(input.dataset.upload, input.files[0]);
      input.value = "";
      return;
    }

    const sheetSelect = event.target.closest("[data-sheet-select]");
    if (sheetSelect) {
      await saveSelectedSheet(sheetSelect.dataset.sheetSelect, sheetSelect.value);
    }
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
  await ensureOperationSheetOptions();
  render();
}

async function savePendingFile(slotId, file) {
  if (!file) return;
  const invalidMessage = getInvalidSlotFileMessage(slotId, file);
  if (invalidMessage) {
    els.libraryState.textContent = invalidMessage;
    window.alert(invalidMessage);
    return;
  }

  const now = new Date().toISOString();
  const existing = state.records.get(slotId) || { id: slotId };
  const pendingSheetFields = slotId === OPERATION_SLOT_ID ? await buildPendingSheetFields(file, existing) : {};
  const record = {
    ...existing,
    id: slotId,
    pendingFile: file,
    pendingName: file.name,
    pendingSize: file.size,
    pendingTypeLabel: getFileTypeLabel(file),
    pendingRefreshMonth: getRefreshMonth(file.name, now),
    pendingSavedAt: now,
    ...pendingSheetFields,
  };
  const db = await openDb();
  await putRecord(db, record);
  db.close();
  await refresh();
}

function getInvalidSlotFileMessage(slotId, file) {
  if (slotId === OPERATION_SLOT_ID && !isOpenXmlWorkbook(file?.name)) {
    return OPERATION_FORMAT_MESSAGE;
  }
  return "";
}

async function buildPendingSheetFields(file, existingRecord) {
  const sheetNames = await getWorkbookSheetNames(file);
  const selectedSheetName = pickSelectableSheetName(
    sheetNames,
    existingRecord?.selectedSheetName || existingRecord?.pendingSelectedSheetName
  );
  return {
    pendingSheetNames: sheetNames,
    pendingSelectedSheetName: selectedSheetName,
  };
}

async function ensureOperationSheetOptions() {
  const record = state.records.get(OPERATION_SLOT_ID);
  if (!record) return;

  const hasPending = Boolean(record.pendingFile);
  const file = hasPending ? record.pendingFile : record.file;
  const currentSheetNames = hasPending ? record.pendingSheetNames : record.sheetNames;
  if (!file || (Array.isArray(currentSheetNames) && currentSheetNames.length)) return;

  const sheetNames = await getWorkbookSheetNames(file);
  if (!sheetNames.length) return;

  const selectedSheetName = pickSelectableSheetName(
    sheetNames,
    hasPending ? record.pendingSelectedSheetName || record.selectedSheetName : record.selectedSheetName
  );
  const updatedRecord = hasPending
    ? { ...record, pendingSheetNames: sheetNames, pendingSelectedSheetName: selectedSheetName }
    : { ...record, sheetNames, selectedSheetName };

  state.records.set(OPERATION_SLOT_ID, updatedRecord);
  const db = await openDb();
  await putRecord(db, updatedRecord);
  db.close();
}

async function saveSelectedSheet(slotId, sheetName) {
  if (slotId !== OPERATION_SLOT_ID) return;
  const record = state.records.get(slotId);
  if (!record) return;

  const hasPending = Boolean(record.pendingFile);
  const sheetNames = hasPending ? record.pendingSheetNames : record.sheetNames;
  const selectedSheetName = pickSelectableSheetName(sheetNames, sheetName);
  const updatedRecord = hasPending
    ? { ...record, pendingSelectedSheetName: selectedSheetName }
    : { ...record, selectedSheetName };

  state.records.set(slotId, updatedRecord);
  const db = await openDb();
  await putRecord(db, updatedRecord);
  db.close();
  render();

  if (updatedRecord.applied && !updatedRecord.pendingFile) {
    await refreshReconciliationMetrics();
  }
}

async function applySlot(slotId, options = {}) {
  const record = state.records.get(slotId);
  if (!record) return;
  const invalidMessage = getInvalidAppliedSlotMessage(slotId, record);
  if (invalidMessage) {
    els.libraryState.textContent = invalidMessage;
    window.alert(invalidMessage);
    return false;
  }

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
        ...getAppliedSheetFields(slotId, record),
        applied: true,
        appliedAt,
      })
    : {
        ...record,
        ...getAppliedSheetFields(slotId, record),
        applied: true,
        appliedAt,
      };
  const db = await openDb();
  await putRecord(db, updatedRecord);
  db.close();
  if (!options.skipRefresh) await refresh();
  return true;
}

function getInvalidAppliedSlotMessage(slotId, record) {
  const targetFile = record?.pendingFile || record?.file;
  return targetFile ? getInvalidSlotFileMessage(slotId, targetFile) : "";
}

function getAppliedSheetFields(slotId, record) {
  if (slotId !== OPERATION_SLOT_ID) return {};
  const sheetNames = record?.pendingFile ? record.pendingSheetNames : record?.sheetNames;
  const selectedSheetName = pickSelectableSheetName(
    sheetNames,
    record?.pendingSelectedSheetName || record?.selectedSheetName
  );
  return {
    sheetNames: Array.isArray(sheetNames) ? sheetNames : [],
    selectedSheetName,
  };
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
      const applied = await applySlot(slotId, { skipRefresh: true });
      if (applied === false) throw new Error(OPERATION_FORMAT_MESSAGE);
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
  const confirmed = window.confirm("确认清除当前浏览器里的优乐步对账文件缓存吗？清除后需要重新上传并应用文件。");
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
    const { sources, reconciliationWorkbook, reconciliationSheetName, result } = await buildReconciliationWorkbookResult();
    updateReconciliationMetrics(result);
    const outputBlob = await buildPreservedReconciliationBlob(sources.operation.file, reconciliationSheetName, result);
    downloadBlob(outputBlob, buildGeneratedFileName(sources.operation.name));
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

  const [registrationWorkbook, reconciliationWorkbook] = await Promise.all([
    readWorkbook(sources.wdt.file),
    readWorkbook(sources.operation.file),
  ]);
  const registrationEntries = buildWorkbookSearchEntries(registrationWorkbook);
  const reconciliationSheetName = pickReconciliationSheetName(
    reconciliationWorkbook,
    sources.operation.selectedSheetName
  );
  const reconciliationSheet = reconciliationWorkbook.Sheets[reconciliationSheetName];
  if (!reconciliationSheet) throw new Error("优乐步对账表没有可读取的工作表。");

  const result = fillReconciliationSheet(reconciliationSheet, registrationEntries);
  return { sources, reconciliationWorkbook, reconciliationSheetName, result };
}

function getGenerateSourceRecords() {
  return {
    wdt: getAppliedFileRecord(generateSlotIds.wdt),
    operation: getAppliedFileRecord(generateSlotIds.operation),
  };
}

function getAppliedFileRecord(slotId) {
  const record = state.records.get(slotId);
  return record?.applied && record?.file ? record : null;
}

function getGenerateSourceLabel(key) {
  return {
    wdt: "运营登记表",
    operation: "优乐步对账表",
    yile: "对账文件3",
  }[key] || key;
}

async function buildPreservedReconciliationBlob(sourceFile, sheetName, result) {
  if (!window.JSZip) {
    throw new Error("Excel 保真导出组件未加载，请刷新页面后重试。");
  }
  if (!isOpenXmlWorkbook(sourceFile?.name)) {
    throw new Error(OPERATION_FORMAT_MESSAGE);
  }

  const zip = await window.JSZip.loadAsync(await sourceFile.arrayBuffer());
  const sheetPath = await getWorkbookSheetPath(zip, sheetName);
  const sheetFile = zip.file(sheetPath);
  if (!sheetFile) throw new Error("没有找到优乐步对账表对应的工作表文件。");

  const sheetXml = await sheetFile.async("string");
  const patchedSheetXml = patchWorksheetXml(sheetXml, result);
  zip.file(sheetPath, patchedSheetXml);
  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function isOpenXmlWorkbook(fileName) {
  return /\.(xlsx|xlsm)$/i.test(String(fileName || ""));
}

async function getWorkbookSheetPath(zip, sheetName) {
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!workbookXml || !relsXml) throw new Error("优乐步对账表文件结构不完整，无法保真导出。");

  const sheetTag = (workbookXml.match(/<sheet\b[^>]*\/?>/g) || []).find((tag) => {
    const attrs = parseXmlAttributes(tag);
    return attrs.name === sheetName;
  });
  if (!sheetTag) throw new Error(`没有找到工作表：${sheetName}`);

  const relationshipId = parseXmlAttributes(sheetTag)["r:id"];
  const relTag = (relsXml.match(/<Relationship\b[^>]*\/?>/g) || []).find((tag) => (
    parseXmlAttributes(tag).Id === relationshipId
  ));
  if (!relTag) throw new Error(`没有找到工作表关系：${sheetName}`);

  return resolveWorkbookRelationshipTarget(parseXmlAttributes(relTag).Target);
}

function resolveWorkbookRelationshipTarget(target) {
  const normalizedTarget = String(target || "");
  if (normalizedTarget.startsWith("/")) return normalizeZipPath(normalizedTarget.slice(1));
  return normalizeZipPath(`xl/${normalizedTarget}`);
}

function patchWorksheetXml(sheetXml, result) {
  let xml = sheetXml;
  for (const output of result.outputRows || []) {
    const rowNumber = output.rowIndex + 1;
    xml = setInlineStringCell(xml, rowNumber, CHECK_COLUMN_INDEX, output.status);
    xml = setInlineStringCell(xml, rowNumber, REMARK_COLUMN_INDEX, output.remark);
  }
  xml = patchWorksheetMerges(xml, result.outputMerges || []);
  xml = expandWorksheetDimension(xml, result);
  return xml;
}

function setInlineStringCell(sheetXml, rowNumber, columnIndex, value) {
  const cellRef = `${columnIndexToName(columnIndex)}${rowNumber}`;
  const rowRegex = new RegExp(`<row\\b(?=[^>]*\\br="${rowNumber}"\\b)[^>]*(?:>[\\s\\S]*?<\\/row>|\\s*\\/>)`);
  const rowMatch = sheetXml.match(rowRegex);
  if (rowMatch) {
    const patchedRow = upsertCellInRowXml(rowMatch[0], cellRef, columnIndex, value);
    return sheetXml.slice(0, rowMatch.index) + patchedRow + sheetXml.slice(rowMatch.index + rowMatch[0].length);
  }
  const rowXml = `<row r="${rowNumber}">${buildInlineStringCell(cellRef, value)}</row>`;
  return insertRowXml(sheetXml, rowNumber, rowXml);
}

function upsertCellInRowXml(rowXml, cellRef, columnIndex, value) {
  const cellRegex = new RegExp(`<c\\b(?=[^>]*\\br="${escapeRegExp(cellRef)}"\\b)[^>]*(?:>[\\s\\S]*?<\\/c>|\\s*\\/>)`);
  const cellMatch = rowXml.match(cellRegex);
  if (cellMatch) {
    const patchedCell = buildInlineStringCell(cellRef, value, cellMatch[0]);
    return rowXml.slice(0, cellMatch.index) + patchedCell + rowXml.slice(cellMatch.index + cellMatch[0].length);
  }

  const cellXml = buildInlineStringCell(cellRef, value);
  if (/\/>\s*$/.test(rowXml)) {
    return rowXml.replace(/\s*\/>\s*$/, `>${cellXml}</row>`);
  }

  const insertIndex = findCellInsertIndex(rowXml, columnIndex);
  return rowXml.slice(0, insertIndex) + cellXml + rowXml.slice(insertIndex);
}

function buildInlineStringCell(cellRef, value, existingCellXml = "") {
  const attrs = existingCellXml ? parseXmlAttributes(existingCellXml.match(/^<c\b[^>]*>/)?.[0] || "") : {};
  const styleAttr = attrs.s ? ` s="${escapeXmlAttribute(attrs.s)}"` : "";
  return `<c r="${cellRef}"${styleAttr} t="inlineStr"><is><t>${escapeXmlText(value)}</t></is></c>`;
}

function findCellInsertIndex(rowXml, columnIndex) {
  const cellRegex = /<c\b[^>]*\br="([A-Z]+)\d+"[^>]*(?:>[\s\S]*?<\/c>|\s*\/>)/g;
  let match;
  while ((match = cellRegex.exec(rowXml))) {
    if (columnNameToIndex(match[1]) > columnIndex) return match.index;
  }
  return rowXml.lastIndexOf("</row>");
}

function insertRowXml(sheetXml, rowNumber, rowXml) {
  if (/<sheetData\b[^>]*\/>/.test(sheetXml)) {
    return sheetXml.replace(/<sheetData\b([^>]*)\/>/, `<sheetData$1>${rowXml}</sheetData>`);
  }

  const rowRegex = /<row\b(?=[^>]*\br="(\d+)"\b)[^>]*(?:>[\s\S]*?<\/row>|\s*\/>)/g;
  let match;
  while ((match = rowRegex.exec(sheetXml))) {
    if (Number(match[1]) > rowNumber) {
      return sheetXml.slice(0, match.index) + rowXml + sheetXml.slice(match.index);
    }
  }
  const closeIndex = sheetXml.indexOf("</sheetData>");
  if (closeIndex === -1) throw new Error("工作表 XML 缺少 sheetData，无法写入结果。");
  return sheetXml.slice(0, closeIndex) + rowXml + sheetXml.slice(closeIndex);
}

function patchWorksheetMerges(sheetXml, outputMerges) {
  const outputRefs = outputMerges.map((merge) => window.XLSX.utils.encode_range(merge));
  const mergeBlockRegex = /<mergeCells\b[^>]*(?:>[\s\S]*?<\/mergeCells>|\s*\/>)/;
  const mergeBlockMatch = sheetXml.match(mergeBlockRegex);
  const existingRefs = mergeBlockMatch ? parseMergeRefs(mergeBlockMatch[0]) : [];
  const keptRefs = existingRefs.filter((ref) => !isOutputMergeRef(ref));
  const nextRefs = [...new Set([...keptRefs, ...outputRefs])];
  const nextBlock = buildMergeCellsBlock(nextRefs);

  if (mergeBlockMatch) {
    return sheetXml.slice(0, mergeBlockMatch.index) + nextBlock + sheetXml.slice(mergeBlockMatch.index + mergeBlockMatch[0].length);
  }
  if (!nextRefs.length) return sheetXml;

  const insertIndex = sheetXml.indexOf("</sheetData>");
  if (insertIndex === -1) throw new Error("工作表 XML 缺少 sheetData，无法写入合并单元格。");
  const afterSheetDataIndex = insertIndex + "</sheetData>".length;
  return sheetXml.slice(0, afterSheetDataIndex) + nextBlock + sheetXml.slice(afterSheetDataIndex);
}

function parseMergeRefs(mergeBlockXml) {
  return [...mergeBlockXml.matchAll(/<mergeCell\b[^>]*\bref="([^"]+)"[^>]*\/>/g)]
    .map((match) => xmlUnescape(match[1]));
}

function buildMergeCellsBlock(refs) {
  if (!refs.length) return "";
  return `<mergeCells count="${refs.length}">${refs.map((ref) => `<mergeCell ref="${escapeXmlAttribute(ref)}"/>`).join("")}</mergeCells>`;
}

function isOutputMergeRef(ref) {
  try {
    const range = window.XLSX.utils.decode_range(ref);
    return (
      range.s.r >= OUTPUT_START_ROW_INDEX &&
      range.s.c === range.e.c &&
      (range.s.c === CHECK_COLUMN_INDEX || range.s.c === REMARK_COLUMN_INDEX)
    );
  } catch {
    return false;
  }
}

function expandWorksheetDimension(sheetXml, result) {
  const maxOutputRowIndex = Math.max(
    OUTPUT_START_ROW_INDEX,
    ...(result.outputRows || []).map((row) => row.rowIndex),
    ...(result.outputMerges || []).map((merge) => merge.e.r)
  );
  const dimensionRegex = /<dimension\b[^>]*\bref="([^"]+)"[^>]*\/>/;
  const dimensionMatch = sheetXml.match(dimensionRegex);
  if (!dimensionMatch) return sheetXml;
  try {
    const range = window.XLSX.utils.decode_range(xmlUnescape(dimensionMatch[1]));
    range.e.c = Math.max(range.e.c, OUTPUT_LAST_COLUMN_INDEX);
    range.e.r = Math.max(range.e.r, maxOutputRowIndex);
    const nextRef = window.XLSX.utils.encode_range(range);
    const nextDimension = dimensionMatch[0].replace(/\bref="[^"]+"/, `ref="${escapeXmlAttribute(nextRef)}"`);
    return sheetXml.slice(0, dimensionMatch.index) + nextDimension + sheetXml.slice(dimensionMatch.index + dimensionMatch[0].length);
  } catch {
    return sheetXml;
  }
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

async function getWorkbookSheetNames(file) {
  try {
    const workbook = await readWorkbook(file);
    return [...new Set((workbook.SheetNames || []).map((name) => String(name ?? "")).filter((name) => name.trim()))];
  } catch (error) {
    console.warn("read workbook sheet names failed", error);
    return [];
  }
}

function pickSelectableSheetName(sheetNames = [], preferredSheetName = "") {
  const names = Array.isArray(sheetNames) ? sheetNames.map((name) => String(name ?? "")).filter((name) => name.trim()) : [];
  if (!names.length) return "";

  const preferred = String(preferredSheetName ?? "");
  if (preferred) {
    const exact = names.find((name) => name === preferred);
    if (exact) return exact;
    const sameTrim = names.find((name) => name.trim() === preferred.trim());
    if (sameTrim) return sameTrim;
  }

  return (
    names.find((name) => name.trim() === "26.5") ||
    names.find((name) => name.includes("\u5bf9\u8d26")) ||
    names[0]
  );
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

function pickReconciliationSheetName(workbook, preferredSheetName = "") {
  return pickSelectableSheetName(workbook.SheetNames || [], preferredSheetName);
}

function fillReconciliationSheet(sheet, registrationEntries) {
  const protectedSnapshot = snapshotProtectedColumns(sheet, PROTECTED_LAST_COLUMN_INDEX);
  const range = window.XLSX.utils.decode_range(sheet["!ref"] || "A1:R1");
  const trackingMergeContext = buildColumnMergeContext(sheet, TRACKING_COLUMN_INDEX, OUTPUT_START_ROW_INDEX);
  const maxMergedRow = trackingMergeContext.sourceMerges.reduce((max, merge) => Math.max(max, merge.e.r), 0);
  const maxRow = Math.max(range.e.r, OUTPUT_START_ROW_INDEX, maxMergedRow);
  const originalDataMaxColumn = Math.min(Math.max(range.e.c, TRACKING_COLUMN_INDEX), CHECK_COLUMN_INDEX - 1);
  const stats = {
    checkedRows: 0,
    verifiedCount: 0,
    pendingCount: 0,
    returnCount: 0,
    noRecordCount: 0,
    outputRows: [],
    outputMerges: [],
  };

  stats.outputMerges = syncOutputMergesFromTrackingColumn(sheet, trackingMergeContext.sourceMerges);

  for (let rowIndex = OUTPUT_START_ROW_INDEX; rowIndex <= maxRow; rowIndex += 1) {
    if (trackingMergeContext.coveredRows.has(rowIndex)) continue;
    const merge = trackingMergeContext.startRows.get(rowIndex);
    const rowEnd = Math.min(merge?.e.r ?? rowIndex, maxRow);
    if (!rowGroupHasAnyValue(sheet, rowIndex, rowEnd, originalDataMaxColumn)) continue;
    const name = getFirstNonEmptyColumnValue(sheet, rowIndex, rowEnd, NAME_COLUMN_INDEX);
    const trackingNumber = getFirstNonEmptyColumnValue(sheet, rowIndex, rowEnd, TRACKING_COLUMN_INDEX);
    const result = getYoulebuRowReconciliationResult(name, trackingNumber, registrationEntries);
    writeTextCell(sheet, rowIndex, CHECK_COLUMN_INDEX, result.status);
    writeTextCell(sheet, rowIndex, REMARK_COLUMN_INDEX, result.remark);
    stats.outputRows.push({ rowIndex, status: result.status, remark: result.remark });
    for (let coveredRowIndex = rowIndex + 1; coveredRowIndex <= rowEnd; coveredRowIndex += 1) {
      stats.outputRows.push({ rowIndex: coveredRowIndex, status: "", remark: "" });
    }
    stats.checkedRows += 1;
    if (result.status === "已核实") stats.verifiedCount += 1;
    if (result.status === "待核实") stats.pendingCount += 1;
    if (result.status !== "无信息") stats.returnCount += 1;
    if (result.status === "无信息") stats.noRecordCount += 1;
  }

  range.e.c = Math.max(range.e.c, OUTPUT_LAST_COLUMN_INDEX);
  range.e.r = Math.max(range.e.r, maxRow);
  sheet["!ref"] = window.XLSX.utils.encode_range(range);
  restoreProtectedColumns(sheet, protectedSnapshot);
  return stats;
}

function snapshotProtectedColumns(sheet, lastColumnIndex) {
  const cells = new Map();
  Object.entries(sheet).forEach(([address, cell]) => {
    if (address.startsWith("!")) return;
    const decodedAddress = window.XLSX.utils.decode_cell(address);
    if (decodedAddress.c <= lastColumnIndex) {
      cells.set(address, clonePlain(cell));
    }
  });
  return {
    lastColumnIndex,
    cells,
    columns: clonePlain(sheet["!cols"]),
    rows: clonePlain(sheet["!rows"]),
    merges: clonePlain(sheet["!merges"]),
    autoFilter: clonePlain(sheet["!autofilter"]),
  };
}

function restoreProtectedColumns(sheet, snapshot) {
  Object.keys(sheet).forEach((address) => {
    if (address.startsWith("!")) return;
    const decodedAddress = window.XLSX.utils.decode_cell(address);
    if (decodedAddress.c <= snapshot.lastColumnIndex && !snapshot.cells.has(address)) {
      delete sheet[address];
    }
  });
  snapshot.cells.forEach((cell, address) => {
    sheet[address] = clonePlain(cell);
  });
  restoreProtectedColumnsMetadata(sheet, snapshot);
}

function restoreProtectedColumnsMetadata(sheet, snapshot) {
  restoreProtectedColumnWidths(sheet, snapshot.columns, snapshot.lastColumnIndex);
  restoreOptionalSheetProperty(sheet, "!rows", snapshot.rows);
  restoreProtectedMerges(sheet, snapshot.merges, snapshot.lastColumnIndex);
  restoreOptionalSheetProperty(sheet, "!autofilter", snapshot.autoFilter);
}

function restoreProtectedColumnWidths(sheet, snapshotColumns, lastColumnIndex) {
  const currentColumns = Array.isArray(sheet["!cols"]) ? [...sheet["!cols"]] : [];
  if (!Array.isArray(snapshotColumns)) {
    for (let columnIndex = 0; columnIndex <= lastColumnIndex; columnIndex += 1) {
      delete currentColumns[columnIndex];
    }
    if (currentColumns.some((column) => column !== undefined)) {
      sheet["!cols"] = currentColumns;
    } else {
      delete sheet["!cols"];
    }
    return;
  }
  for (let columnIndex = 0; columnIndex <= lastColumnIndex; columnIndex += 1) {
    currentColumns[columnIndex] = clonePlain(snapshotColumns[columnIndex]);
  }
  sheet["!cols"] = currentColumns;
}

function restoreProtectedMerges(sheet, snapshotMerges, lastColumnIndex) {
  const currentMerges = Array.isArray(sheet["!merges"]) ? sheet["!merges"] : [];
  const unprotectedMerges = currentMerges.filter((merge) => !mergeTouchesProtectedColumns(merge, lastColumnIndex));
  const protectedMerges = Array.isArray(snapshotMerges)
    ? snapshotMerges.filter((merge) => mergeTouchesProtectedColumns(merge, lastColumnIndex))
    : [];
  const merged = [...protectedMerges, ...unprotectedMerges];
  if (merged.length) {
    sheet["!merges"] = merged;
  } else {
    delete sheet["!merges"];
  }
}

function mergeTouchesProtectedColumns(merge, lastColumnIndex) {
  return Boolean(merge && merge.s && merge.e && merge.s.c <= lastColumnIndex && merge.e.c >= 0);
}

function restoreOptionalSheetProperty(sheet, propertyName, value) {
  if (value === undefined) {
    delete sheet[propertyName];
  } else {
    sheet[propertyName] = clonePlain(value);
  }
}

function clonePlain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function buildColumnMergeContext(sheet, columnIndex, startRowIndex) {
  const sourceMerges = (Array.isArray(sheet["!merges"]) ? sheet["!merges"] : [])
    .filter((merge) => (
      merge?.s?.c === columnIndex &&
      merge?.e?.c === columnIndex &&
      merge.s.r >= startRowIndex &&
      merge.e.r > merge.s.r
    ));
  const startRows = new Map();
  const coveredRows = new Set();
  for (const merge of sourceMerges) {
    startRows.set(merge.s.r, merge);
    for (let rowIndex = merge.s.r + 1; rowIndex <= merge.e.r; rowIndex += 1) {
      coveredRows.add(rowIndex);
    }
  }
  return { sourceMerges, startRows, coveredRows };
}

function syncOutputMergesFromTrackingColumn(sheet, sourceMerges) {
  const existingMerges = Array.isArray(sheet["!merges"]) ? sheet["!merges"] : [];
  const outputColumnIndexes = new Set([CHECK_COLUMN_INDEX, REMARK_COLUMN_INDEX]);
  const preservedMerges = existingMerges.filter((merge) => !(
    merge?.s?.r >= OUTPUT_START_ROW_INDEX &&
    merge?.s?.c === merge?.e?.c &&
    outputColumnIndexes.has(merge.s.c)
  ));
  const outputMerges = sourceMerges.flatMap((merge) => (
    [CHECK_COLUMN_INDEX, REMARK_COLUMN_INDEX].map((columnIndex) => ({
      s: { r: merge.s.r, c: columnIndex },
      e: { r: merge.e.r, c: columnIndex },
    }))
  ));
  sheet["!merges"] = [...preservedMerges, ...outputMerges];
  return outputMerges;
}

function rowGroupHasAnyValue(sheet, startRowIndex, endRowIndex, maxColumnIndex) {
  for (let rowIndex = startRowIndex; rowIndex <= endRowIndex; rowIndex += 1) {
    if (rowHasAnyValue(sheet, rowIndex, maxColumnIndex)) return true;
  }
  return false;
}

function getFirstNonEmptyColumnValue(sheet, startRowIndex, endRowIndex, columnIndex) {
  for (let rowIndex = startRowIndex; rowIndex <= endRowIndex; rowIndex += 1) {
    const value = getSheetCellText(sheet, rowIndex, columnIndex);
    if (value) return value;
  }
  return "";
}

function getYoulebuRowReconciliationResult(name, trackingNumber, registrationEntries) {
  const nameFound = searchEntries(name, registrationEntries).found;
  const trackingFound = searchEntries(trackingNumber, registrationEntries).found;

  if (nameFound && trackingFound) {
    return { status: "已核实", remark: "姓名/快递单号都有" };
  }
  if (nameFound) {
    return { status: "待核实", remark: "姓名命中" };
  }
  if (trackingFound) {
    return { status: "待核实", remark: "快递单号命中" };
  }
  return { status: "无信息", remark: "" };
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
  const address = window.XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
  const cell = {
    ...(sheet[address] || {}),
    t: "s",
    v: String(value ?? ""),
  };
  delete cell.w;
  sheet[address] = cell;
}

function ensureOutputColumnWidths(sheet) {
  const columns = sheet["!cols"] || [];
  columns[CHECK_COLUMN_INDEX] = { ...(columns[CHECK_COLUMN_INDEX] || {}), wch: 12 };
  columns[REMARK_COLUMN_INDEX] = { ...(columns[REMARK_COLUMN_INDEX] || {}), wch: 22 };
  sheet["!cols"] = columns;
}

function applyGeneratedTableStyle(sheet, headerRow, range) {
  const styledRange = {
    s: { r: headerRow, c: range.s.c },
    e: { r: range.e.r, c: Math.max(range.e.c, OUTPUT_LAST_COLUMN_INDEX) },
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
  const baseName = sanitizeFileNamePart(String(sourceName || "优乐步对账表").replace(/\.[^.]+$/, "")) || "优乐步对账表";
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

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parseXmlAttributes(tagXml) {
  const attrs = {};
  String(tagXml || "").replace(/([\w:.-]+)\s*=\s*"([^"]*)"/g, (_, name, value) => {
    attrs[name] = xmlUnescape(value);
    return "";
  });
  return attrs;
}

function xmlUnescape(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeXmlAttribute(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXmlText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function columnIndexToName(columnIndex) {
  let index = columnIndex + 1;
  let name = "";
  while (index > 0) {
    const remainder = (index - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    index = Math.floor((index - 1) / 26);
  }
  return name;
}

function columnNameToIndex(columnName) {
  return String(columnName || "")
    .toUpperCase()
    .split("")
    .reduce((index, char) => index * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function normalizeZipPath(path) {
  const parts = [];
  String(path || "").split("/").forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") {
      parts.pop();
      return;
    }
    parts.push(part);
  });
  return parts.join("/");
}

function render() {
  els.slotCount.textContent = String(slots.length);
  els.uploadedCount.textContent = String(countUploadedRecords());
  els.appliedCount.textContent = String(countAppliedRecords());
  els.latestMonth.textContent = getLatestMonth();
  els.sourceNote.textContent = `本地文件库｜引用时间：${getLatestAppliedTime()}`;
  els.slotGrid.innerHTML = slots.map(renderSlot).join("");
  updateReconciliationMetrics();
  els.libraryState.textContent = getOperationFormatWarning() || "本地文件库";
  updateApplyAllButton();
  updateGenerateButton();
}

function getOperationFormatWarning() {
  const record = state.records.get(OPERATION_SLOT_ID);
  const display = getDisplayRecord(record);
  return display?.name && !isOpenXmlWorkbook(display.name) ? OPERATION_FORMAT_MESSAGE : "";
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
      ${renderSheetPicker(slot, record, display)}
      ${renderSlotFormatHint(slot)}
      <div class="slot-actions">
        <label class="upload-button">
          <input type="file" accept="${getSlotAccept(slot.id)}" data-upload="${slot.id}" />
          上传/替换
        </label>
        <button type="button" data-apply="${slot.id}" ${hasPending || (record && !record.applied) ? "" : "disabled"}>应用刷新</button>
        <button class="danger-button" type="button" data-delete="${slot.id}" ${record ? "" : "disabled"}>删除</button>
      </div>
    </article>
  `;
}

function getSlotAccept(slotId) {
  return slotId === OPERATION_SLOT_ID ? OPERATION_SLOT_ACCEPT : DEFAULT_SLOT_ACCEPT;
}

function renderSlotFormatHint(slot) {
  if (slot.id !== OPERATION_SLOT_ID) return "";
  return `<small class="slot-format-hint">优乐步对账表仅支持 .xlsx/.xlsm；.xls 请先另存为 .xlsx。</small>`;
}

function renderSheetPicker(slot, record, display) {
  if (slot.id !== OPERATION_SLOT_ID) return "";

  const hasPending = Boolean(record?.pendingFile);
  const sheetNames = hasPending ? record?.pendingSheetNames : record?.sheetNames;
  const selectedSheetName = pickSelectableSheetName(
    sheetNames,
    hasPending ? record?.pendingSelectedSheetName || record?.selectedSheetName : record?.selectedSheetName
  );
  const options = Array.isArray(sheetNames) && sheetNames.length ? sheetNames : selectedSheetName ? [selectedSheetName] : [];
  const disabled = !display || !options.length;
  const sheetHint = options.length
    ? `${hasPending ? "应用刷新后使用" : "当前用于生成"}：${escapeHtml(selectedSheetName || options[0])}`
    : "上传优乐步对账表后读取";

  return `
    <label class="sheet-picker">
      <span>应用 sheet</span>
      <select data-sheet-select="${slot.id}" ${disabled ? "disabled" : ""}>
        ${
          options.length
            ? options
                .map((name) => {
                  const safeName = escapeHtml(name);
                  return `<option value="${safeName}" ${name === selectedSheetName ? "selected" : ""}>${safeName}</option>`;
                })
                .join("")
            : `<option value="">上传后选择</option>`
        }
      </select>
      <small>${sheetHint}</small>
    </label>
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
  const hasRequiredSources = Boolean(
    sources.wdt?.file &&
    sources.operation?.file &&
    isOpenXmlWorkbook(sources.operation.name)
  );
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
  delete nextRecord.pendingSheetNames;
  delete nextRecord.pendingSelectedSheetName;
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
  if (extension === "xlsx" || extension === "xls" || extension === "xlsm") return "Excel 工作簿";
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
