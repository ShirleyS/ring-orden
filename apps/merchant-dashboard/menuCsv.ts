export interface MenuCSVItem {
  name: string;
  price: number;
  category: string;
  description: string;
  available: boolean;
}
export interface MenuCSVResult {
  items: MenuCSVItem[];
  errors: string[];
}
interface CSVRow {
  cells: string[];
  line: number;
}
/** Parse quoted CSV without splitting embedded newlines or commas. */
function readCSV(text: string): { rows: CSVRow[]; errors: string[] } {
  const rows: CSVRow[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  let line = 1;
  let startLine = 1;
  const endField = () => {
    cells.push(field);
    field = "";
    closed = false;
  };
  const endRow = () => {
    endField();
    if (cells.some((value) => value.trim()))
      rows.push({ cells, line: startLine });
    cells = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else if (ch === "\r") {
        field += "\r";
        if (text[i + 1] === "\n") {
          field += "\n";
          i++;
        }
        line++;
      } else {
        field += ch;
        if (ch === "\n") line++;
      }
      continue;
    }
    if (ch === ",") {
      endField();
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      endRow();
      if (ch === "\r" && text[i + 1] === "\n") i++;
      line++;
      startLine = line;
      continue;
    }
    if (closed) {
      if (ch === " " || ch === "\t") continue;
      return {
        rows: [],
        errors: [`Row ${startLine}: unexpected text after a closing quote.`],
      };
    }
    if (ch === '"') {
      if (field.trim())
        return {
          rows: [],
          errors: [`Row ${startLine}: a quote must surround the whole cell.`],
        };
      field = "";
      quoted = true;
      continue;
    }
    field += ch;
  }
  if (quoted)
    return {
      rows: [],
      errors: [`Row ${startLine}: a quoted cell is missing its closing quote.`],
    };
  endRow();
  return { rows, errors: [] };
}
/** Returns validated candidates plus row errors. Import must be disabled while any error exists. */
export function parseMenuCSV(source: string): MenuCSVResult {
  if (source.length > 1_000_000)
    return {
      items: [],
      errors: ["The CSV is too large. Use a file smaller than 1 MB."],
    };
  const text = source.replace(/^\uFEFF/, "");
  if (!text.trim())
    return {
      items: [],
      errors: ["Choose or paste a CSV with name and price columns."],
    };
  const parsed = readCSV(text);
  if (parsed.errors.length) return { items: [], errors: parsed.errors };
  const [header, ...rows] = parsed.rows;
  if (!header)
    return {
      items: [],
      errors: ["The CSV is empty. Add a header and at least one menu item."],
    };
  const headers = header.cells.map((value) => value.trim().toLowerCase());
  const supported = ["name", "price", "category", "description", "available"];
  const errors: string[] = [];
  for (const required of ["name", "price"])
    if (!headers.includes(required))
      errors.push(`Missing required column: ${required}.`);
  const seenHeaders = new Set<string>();
  for (const name of headers) {
    if (seenHeaders.has(name))
      errors.push(`Duplicate column: ${name || "(blank)"}.`);
    seenHeaders.add(name);
    if (!supported.includes(name))
      errors.push(
        `Unsupported column: ${name || "(blank)"}. Use name, price, category, description and available.`,
      );
  }
  if (errors.length) return { items: [], errors };
  if (!rows.length)
    return {
      items: [],
      errors: ["Add at least one menu item below the header row."],
    };
  if (rows.length > 100)
    return {
      items: [],
      errors: [
        `This CSV has ${rows.length} items. Import at most 100 items at a time.`,
      ],
    };
  const items: MenuCSVItem[] = [];
  const names = new Map<string, number>();
  for (const row of rows) {
    if (row.cells.length !== headers.length) {
      errors.push(
        `Row ${row.line}: expected ${headers.length} columns, found ${row.cells.length}.`,
      );
      continue;
    }
    const values = Object.fromEntries(
      headers.map((name, index) => [name, row.cells[index].trim()]),
    );
    const name = values.name;
    const rawPrice = values.price;
    const category = values.category || "Other";
    const description = values.description || "";
    const normalizedName = name
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\s+/g, " ");
    const previous = names.get(normalizedName);
    const rowErrors: string[] = [];
    if (!name) rowErrors.push("name is required");
    else if (name.length > 120)
      rowErrors.push("name must be 120 characters or fewer");
    else if (previous !== undefined)
      rowErrors.push(`duplicate name “${name}” (already on row ${previous})`);
    if (name) names.set(normalizedName, previous ?? row.line);
    const price = Number(rawPrice);
    if (
      !/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(rawPrice) ||
      !Number.isFinite(price) ||
      price < 0 ||
      price > 10000
    )
      rowErrors.push(
        "price must be 0–10,000 MXN with at most two decimal places",
      );
    if (category.length > 80)
      rowErrors.push("category must be 80 characters or fewer");
    if (description.length > 2000)
      rowErrors.push("description must be 2000 characters or fewer");
    const availableText = (values.available ?? "").toLowerCase();
    const yes = ["", "true", "yes", "1", "available"];
    const no = ["false", "no", "0", "sold out"];
    if (!yes.includes(availableText) && !no.includes(availableText))
      rowErrors.push(
        "available must be true or false (yes/no and 1/0 also work)",
      );
    if (rowErrors.length) {
      errors.push(`Row ${row.line}: ${rowErrors.join("; ")}.`);
      continue;
    }
    items.push({
      name,
      price: Math.round(price * 100) / 100,
      category,
      description,
      available: yes.includes(availableText),
    });
  }
  return { items, errors };
}
