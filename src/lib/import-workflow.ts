import type { ImportError, ImportRow } from "./sheets";

export type SkippedImportRow = {
  sourceRow: number;
  row: ImportRow;
  reasons: ImportError[];
};

export function classifyImportRows(
  rows: ImportRow[],
  sourceRows: number[],
  errors: ImportError[],
) {
  const reasons = new Map<number, ImportError[]>();
  for (const error of errors) {
    const current = reasons.get(error.row) ?? [];
    current.push(error);
    reasons.set(error.row, current);
  }
  const allowed: ImportRow[] = [];
  const allowedSourceRows: number[] = [];
  const skipped: SkippedImportRow[] = [];
  rows.forEach((row, index) => {
    const sourceRow = sourceRows[index] ?? index + 1;
    const rowReasons = reasons.get(sourceRow) ?? [];
    if (rowReasons.length) skipped.push({ sourceRow, row, reasons: rowReasons });
    else {
      allowed.push(row);
      allowedSourceRows.push(sourceRow);
    }
  });
  return { allowed, allowedSourceRows, skipped };
}

function csvCell(value: string) {
  const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function skippedRowsCsv(rows: SkippedImportRow[]) {
  const header = ["Row", "Company", "Role", "Job URL", "Job site", "Work arrangement", "Job status", "Reasons"];
  const body = rows.map(({ sourceRow, row, reasons }) => [
    String(sourceRow), row.company, row.role_name, row.url, row.source,
    row.arrangement, row.job_status,
    reasons.map((reason) => `${reason.field}: ${reason.message}`).join("; "),
  ]);
  return [header, ...body].map((line) => line.map(csvCell).join(",")).join("\r\n");
}
