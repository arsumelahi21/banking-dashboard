import { describe, expect, it } from "vitest";
import { csvCents, csvRow, csvText } from "./csv";

describe("csvText", () => {
  it.each([
    ["=HYPERLINK(\"http://evil\")"],
    ["+1+1"],
    ["-2+3"],
    ["@SUM(A1)"],
    ["\t=1+1"],
    ["\r=1+1"],
    ["  =1+1"],
  ])("neutralizes the formula %j", (input) => {
    const output = csvText(input);
    const unquoted = output.startsWith('"') ? output.slice(1) : output;
    expect(unquoted.startsWith("'")).toBe(true);
  });

  it("leaves ordinary text alone", () => {
    expect(csvText("Figma subscription")).toBe("Figma subscription");
    expect(csvText("")).toBe("");
    expect(csvText(null)).toBe("");
  });

  it("quotes commas, quotes and line breaks so columns can't shift", () => {
    expect(csvText("Smith, Jones")).toBe('"Smith, Jones"');
    expect(csvText('say "hi"')).toBe('"say ""hi"""');
    expect(csvText("line one\nline two")).toBe('"line one\nline two"');
  });
});

describe("csvCents", () => {
  it("formats exactly, with no floating point error", () => {
    expect(csvCents(123456)).toBe("1234.56");
    expect(csvCents(5)).toBe("0.05");
    expect(csvCents(0)).toBe("0.00");
    expect(csvCents(-2550)).toBe("-25.50");
    expect(csvCents(-5)).toBe("-0.05");
    expect(csvCents(1999)).toBe("19.99");
  });

  it("rejects values that aren't whole cents", () => {
    expect(() => csvCents(1.5)).toThrow(RangeError);
  });
});

describe("csvRow", () => {
  it("joins cells", () => {
    expect(csvRow(["a", '"b,c"', "1.00"])).toBe('a,"b,c",1.00');
  });
});
