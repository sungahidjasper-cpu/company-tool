/**
 * Hand-rolled CSV read/write — no dependency, matching this codebase's
 * existing minimalism (see Phase 8's Reports feature, the original home
 * of toCsv/escapeCsvField before Phase 10's SEO Workspace also needed
 * CSV import and this moved to a shared home). Handles the common case
 * (quoted fields containing commas/quotes/newlines) — not a full RFC 4180
 * parser for pathological edge cases.
 */

export function escapeCsvField(value: string | number) {
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export function toCsv(columns: string[], rows: (string | number)[][]) {
  const lines = [columns, ...rows].map((line) =>
    line.map(escapeCsvField).join(",")
  );
  return lines.join("\n");
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Parses CSV text into an array of objects keyed by the header row. Blank
 * lines are skipped. Does not handle quoted fields that themselves contain
 * a literal newline (the common single-line-per-record case is covered).
 */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = (fields[index] ?? "").trim();
    });
    return row;
  });
}
