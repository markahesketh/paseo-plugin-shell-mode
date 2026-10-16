import { describe, expect, it } from "vitest";
import { createStartGate } from "./start-gate";

const MARKER = "start-marker-1";

describe("createStartGate", () => {
  it("drops rc noise up to the marker and passes the rest through", () => {
    const gate = createStartGate(MARKER);
    expect(gate.push(`noise\n\n${MARKER}\nfirst\n`)).toBe("first\n");
    expect(gate.push("second\n")).toBe("second\n");
    expect(gate.end()).toBe("");
  });

  it("finds a marker split across chunks", () => {
    const gate = createStartGate(MARKER);
    const out = [`noise\n\n${MARKER.slice(0, 5)}`, MARKER.slice(5, 9), `${MARKER.slice(9)}`, "\nout"].map(
      (chunk) => gate.push(chunk),
    );
    expect(out).toEqual(["", "", "", "out"]);
  });

  it("finds a marker split between its trailing newline and the output", () => {
    const gate = createStartGate(MARKER);
    expect(gate.push(`\n${MARKER}`)).toBe("");
    expect(gate.push("\nout")).toBe("out");
  });

  it("drops noise that has no trailing newline", () => {
    const gate = createStartGate(MARKER);
    expect(gate.push(`prompt$ \n${MARKER}\nout`)).toBe("out");
  });

  it("drops nothing when the marker comes first", () => {
    const gate = createStartGate(MARKER);
    expect(gate.push(`\n${MARKER}\nout`)).toBe("out");
  });

  it("does not look for the marker again once it has been seen", () => {
    const gate = createStartGate(MARKER);
    gate.push(`\n${MARKER}\n`);
    expect(gate.push(`\n${MARKER}\nagain`)).toBe(`\n${MARKER}\nagain`);
  });

  it("releases everything held when the stream closes without the marker", () => {
    const gate = createStartGate(MARKER);
    expect(gate.push("rc failed: ")).toBe("");
    expect(gate.push("boom\n")).toBe("");
    expect(gate.end()).toBe("rc failed: boom\n");
    expect(gate.end()).toBe("");
  });
});
