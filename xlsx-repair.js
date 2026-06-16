(function () {
  const worksheetPathPattern = /^xl\/worksheets\/sheet\d+\.xml$/;
  const dimensionPattern = /<dimension\b[^>]*\bref="([^"]+)"[^>]*\/>/;
  const cellRefPattern = /<c\b[^>]*\br="([A-Z]{1,4})(\d+)"/g;

  async function repairXlsxDimensionA1(source) {
    if (!window.JSZip) {
      return { arrayBuffer: source, repaired: false, summary: [] };
    }

    const zip = await window.JSZip.loadAsync(source);
    const summary = [];
    const worksheetPaths = Object.keys(zip.files).filter((path) => worksheetPathPattern.test(path));

    for (const path of worksheetPaths) {
      const entry = zip.file(path);
      if (!entry) continue;

      const xml = await entry.async("string");
      const bounds = getWorksheetBounds(xml);
      if (!bounds || (bounds.maxRow <= 1 && bounds.maxCol <= 1)) continue;

      const dimensionMatch = xml.match(dimensionPattern);
      const currentRef = dimensionMatch?.[1] || "";
      const fixedRef = `A1:${numberToColumn(bounds.maxCol)}${bounds.maxRow}`;

      if (!shouldFixDimension(currentRef, bounds)) continue;

      const fixedXml = dimensionMatch
        ? xml.replace(dimensionPattern, `<dimension ref="${fixedRef}"/>`)
        : xml.replace(/<worksheet\b([^>]*)>/, `<worksheet$1><dimension ref="${fixedRef}"/>`);

      zip.file(path, fixedXml);
      summary.push({ path, from: currentRef || "(missing)", to: fixedRef });
    }

    if (!summary.length) {
      return { arrayBuffer: source, repaired: false, summary: [] };
    }

    return {
      arrayBuffer: await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" }),
      repaired: true,
      summary,
    };
  }

  function getWorksheetBounds(xml) {
    let maxRow = 0;
    let maxCol = 0;
    let match;
    cellRefPattern.lastIndex = 0;
    while ((match = cellRefPattern.exec(xml))) {
      maxCol = Math.max(maxCol, columnToNumber(match[1]));
      maxRow = Math.max(maxRow, Number(match[2]) || 0);
    }
    return maxRow && maxCol ? { maxRow, maxCol } : null;
  }

  function shouldFixDimension(ref, bounds) {
    if (!ref) return true;
    const parsed = parseDimensionRef(ref);
    if (!parsed) return true;
    return parsed.maxRow < bounds.maxRow || parsed.maxCol < bounds.maxCol;
  }

  function parseDimensionRef(ref) {
    const parts = String(ref || "").split(":");
    const endRef = parts[1] || parts[0];
    const match = /^([A-Z]{1,4})(\d+)$/i.exec(endRef);
    if (!match) return null;
    return {
      maxCol: columnToNumber(match[1].toUpperCase()),
      maxRow: Number(match[2]) || 0,
    };
  }

  function columnToNumber(column) {
    return String(column || "")
      .toUpperCase()
      .split("")
      .reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
  }

  function numberToColumn(number) {
    let value = Number(number) || 1;
    let column = "";
    while (value > 0) {
      const remainder = (value - 1) % 26;
      column = String.fromCharCode(65 + remainder) + column;
      value = Math.floor((value - 1) / 26);
    }
    return column;
  }

  window.repairXlsxDimensionA1 = repairXlsxDimensionA1;
})();
