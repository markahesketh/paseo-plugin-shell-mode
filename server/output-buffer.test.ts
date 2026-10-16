import { describe, expect, it } from "vitest";
import { createOutputBuffer } from "./output-buffer";

describe("createOutputBuffer", () => {
  it("keeps output in arrival order and is not truncated under the cap", () => {
    const buffer = createOutputBuffer(100);
    buffer.append("one\n");
    buffer.append("two\r\n");
    expect(buffer.snapshot()).toEqual({ output: "one\ntwo\n", truncated: false });
  });

  it("strips colors, hyperlinks, and title sequences", () => {
    const buffer = createOutputBuffer(1000);
    buffer.append("\x1b[1;31mred\x1b[0m \x1b]8;;https://x.test\x07link\x1b]8;;\x07 \x1b]0;title\x1b\\ok\x1b(B");
    expect(buffer.snapshot().output).toBe("red link ok");
  });

  it("strips an escape sequence split across chunks", () => {
    const buffer = createOutputBuffer(1000);
    buffer.append("a\x1b");
    buffer.append("[3");
    buffer.append("1mb\x1b]0;ti");
    buffer.append("tle\x07c");
    expect(buffer.snapshot().output).toBe("abc");
  });

  it("keeps the last bytes, flags truncation, and never splits a character", () => {
    const buffer = createOutputBuffer(5);
    buffer.append("aaaa");
    buffer.append("bbbb€€");
    expect(buffer.snapshot()).toEqual({ output: "€", truncated: true });
  });
});
