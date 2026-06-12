// Quote-aware CSV helpers. A naive `line.split(',')` mangles real-world files where a
// single cell legitimately contains a comma (e.g. "Smith, John" or "$1,200"). These helpers
// respect double-quoted fields and escaped quotes ("").

export const MAX_CSV_BYTES = 50 * 1024 * 1024; // 50 MB upload cap

const BOM = /^﻿/;

/** Parse one CSV line into fields, respecting double-quoted values and "" escapes. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  out.push(field);
  return out;
}

/** Split CSV text into non-empty rows, stripping a leading UTF-8 BOM. */
export function splitCsvRows(text: string): string[] {
  return text.replace(BOM, '').split(/\r?\n/).filter((l) => l.trim().length > 0);
}

/** First non-empty line -> trimmed header names (quote-aware, BOM-stripped). */
export function parseCsvHeader(text: string): string[] {
  const rows = splitCsvRows(text);
  if (rows.length === 0) return [];
  return parseCsvLine(rows[0]).map((h) => h.trim());
}

/** Validate the File before reading it: extension, non-empty, and size limit. */
export function validateCsvFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.csv')) return 'Please upload a .csv file.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_CSV_BYTES) {
    return `File is too large (${(file.size / 1024 / 1024).toFixed(0)} MB). The limit is ${MAX_CSV_BYTES / 1024 / 1024} MB.`;
  }
  return null;
}

/** Validate already-read CSV text: needs a header row plus at least one data row. */
export function validateCsvContent(text: string): string | null {
  const rows = splitCsvRows(text);
  if (rows.length === 0) return 'The file appears to be empty.';
  if (rows.length < 2) return 'The file has a header row but no data rows.';
  if (parseCsvHeader(text).length < 2) return 'Could not detect columns — is this a comma-separated CSV?';
  return null;
}
