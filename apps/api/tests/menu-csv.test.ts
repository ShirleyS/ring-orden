import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMenuCSV } from "../../merchant-dashboard/menuCsv.ts";

test("imports named columns with sensible optional defaults", () => {
  const result = parseMenuCSV("name,price\nLatte,74\nCroissant,65");
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.items, [
    {
      name: "Latte",
      price: 74,
      category: "Other",
      description: "",
      available: true,
    },
    {
      name: "Croissant",
      price: 65,
      category: "Other",
      description: "",
      available: true,
    },
  ]);
});
test("handles BOM, case insensitive headers and CRLF", () => {
  const result = parseMenuCSV(
    "\uFEFFName,Price,Category,Description,Available\r\nIced Latte,78,Coffee,Over ice,true\r\n",
  );
  assert.equal(result.errors.length, 0);
  assert.equal(result.items[0].name, "Iced Latte");
  assert.equal(result.items[0].category, "Coffee");
});
test("quoted commas, escaped quotes and embedded newlines stay in cells", () => {
  const result = parseMenuCSV(
    'name,price,description\n"Latte, large",90,"House \"\"blend\"\"\nserved with milk"',
  );
  assert.equal(result.errors.length, 0);
  assert.equal(result.items[0].name, "Latte, large");
  assert.equal(result.items[0].description, 'House "blend"\nserved with milk');
});
test("quoted CRLF is preserved in field contents", () => {
  const result = parseMenuCSV(
    'name,price,description\r\nLatte,74,"First line\r\nSecond line"\r\n',
  );
  assert.equal(result.errors.length, 0);
  assert.equal(result.items[0].description, "First line\r\nSecond line");
});
test("ignores empty rows, including CRLF blank lines", () => {
  const result = parseMenuCSV("name,price\r\n\r\nLatte,74\r\n,,\r\n\r\n");
  assert.equal(result.errors.length, 0);
  assert.equal(result.items.length, 1);
});
test("header may be in any order", () => {
  const result = parseMenuCSV(
    "available,category,price,name,description\nno,Bakery,80,Ube Croissant,Purple cream",
  );
  assert.equal(result.errors.length, 0);
  assert.equal(result.items[0].available, false);
  assert.equal(result.items[0].price, 80);
});
for (const value of ["true", "yes", "1", "available", "TRUE"])
  test(`availability ${value} means available`, () =>
    assert.equal(
      parseMenuCSV(`name,price,available\nLatte,74,${value}`).items[0]
        .available,
      true,
    ));
for (const value of ["false", "no", "0", "sold out", "FALSE"])
  test(`availability ${value} means sold out`, () =>
    assert.equal(
      parseMenuCSV(`name,price,available\nLatte,74,${value}`).items[0]
        .available,
      false,
    ));
for (const value of ["0", "0.00", "0.50", "10000", "10000.00", ".50"])
  test(`valid MXN amount ${value}`, () =>
    assert.equal(parseMenuCSV(`name,price\nLatte,${value}`).errors.length, 0));
for (const value of [
  "-1",
  "10000.01",
  "NaN",
  "Infinity",
  "1e3",
  "78.001",
  "",
  "$78",
  "seventy",
])
  test(`rejects invalid price ${value}`, () => {
    const result = parseMenuCSV(`name,price\nLatte,${value}`);
    assert.equal(result.items.length, 0);
    assert.match(result.errors[0], /row 2.*price/i);
  });
test("missing required headers explain what is needed", () => {
  assert.match(
    parseMenuCSV("name,category\nLatte,Coffee").errors.join(" "),
    /price/i,
  );
  assert.match(
    parseMenuCSV("price,category\n74,Coffee").errors.join(" "),
    /name/i,
  );
});
test("duplicate headers are rejected", () =>
  assert.match(
    parseMenuCSV("name,price,Name\nLatte,74,Other").errors.join(" "),
    /duplicate.*name/i,
  ));
test("unknown headers are rejected rather than silently discarded", () =>
  assert.match(
    parseMenuCSV("name,price,modifiers\nLatte,74,oat").errors.join(" "),
    /unsupported.*modifiers/i,
  ));
test("blank product name has an actionable row error", () =>
  assert.match(
    parseMenuCSV("name,price\n,74").errors.join(" "),
    /row 2.*name/i,
  ));
test("duplicate item names reject case and whitespace variants", () => {
  const result = parseMenuCSV("name,price\nIced Latte,78\n  ICED   latte ,80");
  assert.match(result.errors.join(" "), /row 3.*duplicate/i);
});
test("rows with the wrong column count are rejected", () =>
  assert.match(
    parseMenuCSV("name,price\nLatte,74,extra").errors.join(" "),
    /row 2.*columns/i,
  ));
test("invalid availability is not silently converted", () =>
  assert.match(
    parseMenuCSV("name,price,available\nLatte,74,perhaps").errors.join(" "),
    /row 2.*available/i,
  ));
test("unclosed quoted cells are rejected", () =>
  assert.match(
    parseMenuCSV('name,price\n"Latte,74').errors.join(" "),
    /row 2.*quote/i,
  ));
test("quotes inside an unquoted cell are rejected", () =>
  assert.match(
    parseMenuCSV('name,price\nLat"te,74').errors.join(" "),
    /row 2.*quote/i,
  ));
test("characters after closing quote are rejected", () =>
  assert.match(
    parseMenuCSV('name,price\n"Latte"oops,74').errors.join(" "),
    /row 2.*quote/i,
  ));
test("spaces after closing quote are permitted", () =>
  assert.equal(parseMenuCSV('name,price\n"Latte"  ,74').errors.length, 0));
test("physical row numbers account for multiline cells", () => {
  const result = parseMenuCSV(
    'name,price,description\nLatte,74,"a\nb"\nBad,-1,No',
  );
  assert.match(result.errors.join(" "), /row 4.*price/i);
});
test("limits import to 100 menu items", () => {
  const valid =
    "name,price\n" +
    Array.from({ length: 100 }, (_, i) => `Item ${i},1`).join("\n");
  assert.equal(parseMenuCSV(valid).errors.length, 0);
  assert.match(parseMenuCSV(valid + "\nExtra,1").errors.join(" "), /100/);
});
test("empty and header-only input need menu data", () => {
  assert.match(parseMenuCSV("").errors.join(" "), /CSV|empty/i);
  assert.match(parseMenuCSV("name,price\n").errors.join(" "), /item|row/i);
});
test("bounded fields match the merchant menu contract", () => {
  assert.match(
    parseMenuCSV("name,price\n" + "x".repeat(121) + ",1").errors.join(" "),
    /name.*120/i,
  );
  assert.match(
    parseMenuCSV("name,price,category\nLatte,74," + "x".repeat(81)).errors.join(
      " ",
    ),
    /category.*80/i,
  );
  assert.match(
    parseMenuCSV(
      "name,price,description\nLatte,74," + "x".repeat(2001),
    ).errors.join(" "),
    /description.*2000/i,
  );
});
test("oversized source is rejected before parsing", () =>
  assert.match(
    parseMenuCSV("x".repeat(1_000_001)).errors.join(" "),
    /large|1 MB/i,
  ));
