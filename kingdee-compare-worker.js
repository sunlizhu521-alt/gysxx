// kingdee-compare-worker.js - Web Worker for Excel/CSV parsing
self.window = self;
importScripts("./vendor/xlsx.full.min.js", "./xlsx-repair.js");

const MAX_ROWS = 120000;
const MAX_COLS = 80;

const kingdeeAliases = {
  documentNumber: ["单据编号", "单据号", "采购订单号", "采购订单编号", "订单编号", "采购单号"],
  materialCode: ["物料编码", "品号", "物料代码", "商品编码", "存货编码", "产品编码"],
  sku: ["SKU", "sku", "领星SKU", "商品SKU", "物料SKU"],
  itemName: ["物料名称", "商品名称", "物品名称", "存货名称", "产品名称", "金蝶名称", "品名"],
  supplier: ["供应商", "供应商名称", "供方", "厂家", "厂商"],
  creator: ["创建人", "采购订单下单人", "下单人", "制单人"],
  businessUnit: ["事业部", "部门", "业务部门"],
  purchaseQty: ["采购数量", "数量", "订单数量"],
  remainingInboundQty: ["剩余入库数量", "未入库数量", "剩余数量"],
};

const deliveryAliases = {
  documentNumber: ["单据编号", "单据号", "采购订单号", "行号"],
  materialCode: ["品号", "物料编码", "商品编码", "存货编码", "产品编码"],
  sku: ["SKU", "sku", "领星SKU"],
  itemName: ["物品名称", "物料名称", "商品名称", "存货名称", "产品名称", "金蝶名称", "品名"],
  supplier: ["供应商", "供应商名称", "供方", "厂家", "厂商"],
  orderedQty: ["下单数量-备货需求-OA申请为准"],
  remainingQty: ["未发货数量"],
};

const categoryAliases = {
  materialCode: ["物料编码", "品号", "商品编码", "存货编码", "产品编码"],
  sku: ["SKU", "sku", "领星SKU"],
  itemName: ["金蝶名称", "物料名称", "物品名称", "商品名称", "品名"],
  salesLine: ["销售产品线"],
  salesSeries: ["销售系列"],
};

const purchaseAssignmentAliases = {
  materialCode: ["物料编码", "品号", "商品编码", "存货编码", "产品编码"],
  supplier: ["供应商", "供应商名称", "厂家", "厂商", "供方"],
  supplierShort: ["供应商简称", "简称", "供应商简名"],
  orderUser: ["采购下单人"],
};

function normalizeHeader(value) {
  return String(value || "").trim().replace(/\s+/g, "").replace(/[()（）]/g, "").toLowerCase();
}

function normalizeMaterialCode(value) {
  return String(value || "").trim().replace(/\.0$/, "").toLowerCase();
}

function normalizeTextKey(value) {
  return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
}

function normalizeBusinessUnit(value) {
  const text = String(value || "").trim().split("*")[0].trim().replace(/[（(].*?[）)]/g, "").trim();
  if (!text) return "未匹配";
  if (text === "全球招商事业部") return "全球招商部";
  return text;
}

function getRowValue(row, index) {
  return index === undefined ? "" : String(row[index] ?? "").trim();
}

function parseNumber(value) {
  const numberValue = Number(String(value || "").replace(/,/g, "").trim());
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function getBusinessUnitFromSheetName(name) {
  const text = String(name || "").trim();
  return normalizeBusinessUnit(text.replace(/[（(].*?[）)]/g, "").trim() || text || "未匹配");
}

function hasKnownHeader(value, aliases) {
  const header = normalizeHeader(value);
  return Object.values(aliases).some((aliasList) => aliasList.some((alias) => normalizeHeader(alias) === header));
}

function createAliasHeaderMap(headers, aliases) {
  return Object.fromEntries(
    Object.entries(aliases)
      .map(([key, aliasList]) => {
        const index = headers.findIndex((header) => aliasList.some((alias) => normalizeHeader(header) === normalizeHeader(alias)));
        return [key, index >= 0 ? index : undefined];
      })
      .filter(([, index]) => index !== undefined)
  );
}

function createHeaderMap(headers, dataRows, aliases) {
  const map = createAliasHeaderMap(headers, aliases);
  if (map.materialCode === undefined) {
    const used = new Set(Object.values(map));
    const candidates = headers.map((_, index) => index).filter((index) => !used.has(index));
    let best = undefined;
    let bestScore = 0;
    candidates.forEach((column) => {
      const score = dataRows.slice(0, 60).reduce((sum, row) => sum + scoreCell(row[column]), 0);
      if (score > bestScore) {
        best = column;
        bestScore = score;
      }
    });
    if (bestScore >= 3) map.materialCode = best;
  }
  return map;
}

function scoreCell(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const normalized = normalizeMaterialCode(raw);
  if (normalized.length < 4 || /[\u4e00-\u9fff]/.test(normalized)) return 0;
  let score = 1;
  if (/\d/.test(normalized)) score += 2;
  if (/^[a-z0-9._-]+$/i.test(normalized)) score += 1;
  return score;
}

function csvToRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function isAllocationError(error) {
  return /allocation|array buffer|out of memory|memory/i.test(String(error?.message || error || ""));
}

function getSafeSheetRange(sheet) {
  const raw = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
  return {
    s: raw.s,
    e: {
      r: Math.min(raw.e.r, raw.s.r + MAX_ROWS - 1),
      c: Math.min(raw.e.c, raw.s.c + MAX_COLS - 1),
    },
  };
}

function sheetToRows(sheet) {
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
    range: getSafeSheetRange(sheet),
  });
}

function readFileText(file) {
  return new TextDecoder().decode(file);
}

function readWorkbook(file, fileName, options = {}) {
  const common = {
    type: "array",
    cellNF: false,
    cellHTML: false,
    cellStyles: false,
    cellFormula: false,
    WTF: false,
    ...options,
  };
  try {
    return XLSX.read(file, common);
  } catch (error) {
    if (!isAllocationError(error)) throw error;
    const bytes = new Uint8Array(file);
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize));
    }
    return XLSX.read(binary, { ...common, type: "binary" });
  }
}

function readWorkbookSheetRows(file, fileName, preferredSheetName) {
  const extension = String(fileName || "").split(".").pop()?.toLowerCase();
  if (extension === "csv") return csvToRows(readFileText(file));
  const workbook = readWorkbook(file, fileName, { bookSheets: true });
  const target = workbook.SheetNames.find((name) => preferredSheetName && name.includes(preferredSheetName)) || workbook.SheetNames[0];
  if (!target) return [];
  const workbookWithSheet = readWorkbook(file, fileName, { sheets: target, sheetRows: MAX_ROWS });
  return sheetToRows(workbookWithSheet.Sheets[target]);
}

function readAllWorkbookSheets(file, fileName) {
  const extension = String(fileName || "").split(".").pop()?.toLowerCase();
  if (extension === "csv") {
    return [{ sheetName: fileName || "CSV", rows: csvToRows(readFileText(file)) }];
  }
  const workbook = readWorkbook(file, fileName, {});
  return workbook.SheetNames.map((sheetName) => ({ sheetName, rows: sheetToRows(workbook.Sheets[sheetName]) }));
}

function parseKingdeeSheet(rows) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => hasKnownHeader(cell, kingdeeAliases)));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((cell) => String(cell || "").trim());
  const dataRows = rows.slice(headerIndex + 1);
  const headerMap = createHeaderMap(headers, dataRows, kingdeeAliases);
  if (headerMap.purchaseQty === undefined && headerMap.remainingInboundQty === undefined) return [];
  return dataRows
    .map((row, index) => {
      const materialCode = getRowValue(row, headerMap.materialCode);
      const sku = getRowValue(row, headerMap.sku);
      const supplier = getRowValue(row, headerMap.supplier);
      return {
        id: `kingdee-${index}-${materialCode}-${sku}-${supplier}`,
        documentNumber: getRowValue(row, headerMap.documentNumber),
        materialCode,
        sku,
        itemName: getRowValue(row, headerMap.itemName),
        supplier,
        creator: getRowValue(row, headerMap.creator),
        businessUnit: normalizeBusinessUnit(getRowValue(row, headerMap.businessUnit)),
        purchaseQty: parseNumber(getRowValue(row, headerMap.purchaseQty)),
        remainingInboundQty: parseNumber(getRowValue(row, headerMap.remainingInboundQty)),
      };
    })
    .filter((row) => row.materialCode || row.sku || row.itemName || row.supplier);
}

function parseDeliverySheet(rows, businessUnit) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => hasKnownHeader(cell, deliveryAliases)));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((cell) => String(cell || "").trim());
  const dataRows = rows.slice(headerIndex + 1);
  const headerMap = createHeaderMap(headers, dataRows, deliveryAliases);
  if (headerMap.orderedQty === undefined && headerMap.remainingQty === undefined) return [];
  return dataRows
    .map((row, index) => {
      const materialCode = getRowValue(row, headerMap.materialCode);
      const sku = getRowValue(row, headerMap.sku);
      const supplier = getRowValue(row, headerMap.supplier);
      return {
        id: `delivery-${businessUnit}-${index}-${materialCode}-${sku}-${supplier}`,
        businessUnit: normalizeBusinessUnit(businessUnit),
        documentNumber: getRowValue(row, headerMap.documentNumber),
        materialCode,
        sku,
        itemName: getRowValue(row, headerMap.itemName),
        supplier,
        orderedQty: parseNumber(getRowValue(row, headerMap.orderedQty)),
        remainingQty: parseNumber(getRowValue(row, headerMap.remainingQty)),
      };
    })
    .filter((row) => row.materialCode || row.sku || row.itemName || row.supplier);
}

function readCategoryDimension(file, fileName) {
  const rows = readWorkbookSheetRows(file, fileName, "Dim-YL医疗器械商品分类");
  const headerIndex = rows.findIndex((row) => row.some((cell) => hasKnownHeader(cell, categoryAliases)));
  const map = new Map();
  if (headerIndex >= 0) {
    const headerMap = createAliasHeaderMap(rows[headerIndex].map((cell) => String(cell || "").trim()), categoryAliases);
    rows.slice(headerIndex + 1).forEach((row) => {
      const materialCode = normalizeMaterialCode(getRowValue(row, headerMap.materialCode));
      if (!materialCode) return;
      map.set(materialCode, {
        materialCode,
        sku: getRowValue(row, headerMap.sku),
        itemName: getRowValue(row, headerMap.itemName),
        salesLine: getRowValue(row, headerMap.salesLine) || "未匹配",
        salesSeries: getRowValue(row, headerMap.salesSeries) || "未匹配",
      });
    });
    return { map, isMap: true };
  }
  rows.slice(1).forEach((row) => {
    const materialCode = normalizeMaterialCode(row[0]);
    if (!materialCode) return;
    map.set(materialCode, {
      materialCode,
      sku: String(row[2] ?? "").trim(),
      itemName: String(row[3] ?? "").trim(),
      salesLine: String(row[6] ?? "").trim() || "未匹配",
      salesSeries: String(row[7] ?? "").trim() || "未匹配",
    });
  });
  return { map, isMap: true };
}

function createEmptyAssignmentMaps() {
  return {
    byMaterial: new Map(),
    bySupplier: new Map(),
    bySupplierShort: new Map(),
    orderUsers: new Set(),
  };
}

function readPurchaseAssignment(file, fileName) {
  const rows = readWorkbookSheetRows(file, fileName, "产品线明细");
  const headerIndex = rows.findIndex((row) => row.some((cell) => hasKnownHeader(cell, purchaseAssignmentAliases)));
  const maps = createEmptyAssignmentMaps();
  if (headerIndex < 0) return { maps, isMaps: true };
  const headerMap = createAliasHeaderMap(rows[headerIndex].map((cell) => String(cell || "").trim()), purchaseAssignmentAliases);
  rows.slice(headerIndex + 1).forEach((row) => {
    const materialCode = normalizeMaterialCode(getRowValue(row, headerMap.materialCode));
    const supplier = getRowValue(row, headerMap.supplier);
    const supplierShort = getRowValue(row, headerMap.supplierShort) || supplier;
    const orderUser = getRowValue(row, headerMap.orderUser);
    if (materialCode) maps.byMaterial.set(materialCode, { supplier, supplierShort, orderUser });
    if (supplier) maps.bySupplier.set(normalizeTextKey(supplier), { supplier, supplierShort, orderUser });
    if (supplierShort) maps.bySupplierShort.set(normalizeTextKey(supplierShort), { supplier, supplierShort, orderUser });
    if (orderUser) maps.orderUsers.add(orderUser);
  });
  return { maps, isMaps: true };
}

self.onmessage = function handleMessage(event) {
  const { type, id, file, fileName } = event.data;
  try {
    let result;
    switch (type) {
      case "kingdee": {
        const rows = readWorkbookSheetRows(file, fileName, "Fac-采购订单列表");
        result = parseKingdeeSheet(rows);
        break;
      }
      case "delivery": {
        const sheets = readAllWorkbookSheets(file, fileName);
        result = sheets.flatMap((sheet) => parseDeliverySheet(sheet.rows, getBusinessUnitFromSheetName(sheet.sheetName)));
        break;
      }
      case "category": {
        const data = readCategoryDimension(file, fileName);
        result = { map: [...data.map], isMap: true };
        break;
      }
      case "assignment": {
        const data = readPurchaseAssignment(file, fileName);
        result = {
          maps: {
            byMaterial: [...data.maps.byMaterial],
            bySupplier: [...data.maps.bySupplier],
            bySupplierShort: [...data.maps.bySupplierShort],
            byMaterialEntries: [...data.maps.byMaterial],
            bySupplierEntries: [...data.maps.bySupplier],
            bySupplierShortEntries: [...data.maps.bySupplierShort],
            orderUsersEntries: [...data.maps.orderUsers],
          },
          isMaps: true,
        };
        break;
      }
      default:
        throw new Error(`Unknown type: ${type}`);
    }
    self.postMessage({ type: "result", id, rows: result });
  } catch (error) {
    self.postMessage({ type: "error", id, error: error.message || String(error) });
  }
};
