import { OUTPUT_TAIL_BYTES } from "../shared/shell-run";

const ESC = "\x1b";
const ANSI_SEQUENCE = new RegExp(
  [
    `${ESC}\\[[0-?]*[ -/]*[@-~]`, // CSI: colors, cursor movement
    `${ESC}\\][^\\x07${ESC}]*(?:\\x07|${ESC}\\\\)`, // OSC: titles, hyperlinks
    `${ESC}[()][ -~]`, // charset selection
    `${ESC}[@-Z\\\\-_]`, // two-character escapes
  ].join("|"),
  "g",
);
// An escape sequence cut off by the end of a chunk, held back until the next chunk completes it.
const INCOMPLETE_SEQUENCE = new RegExp(
  `${ESC}(?:\\[[0-?]*[ -/]*|\\][^\\x07${ESC}]*${ESC}?|[()])?$`,
);
const MAX_HELD_SEQUENCE = 256;

export interface OutputSnapshot {
  output: string;
  truncated: boolean;
}

export interface OutputBuffer {
  append(chunk: string): void;
  snapshot(): OutputSnapshot;
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_SEQUENCE, "");
}

// Keeps the last maxBytes of UTF-8 without splitting a character.
function lastBytes(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString("utf8");
}

export function createOutputBuffer(maxBytes: number = OUTPUT_TAIL_BYTES): OutputBuffer {
  let text = "";
  let size = 0;
  let truncated = false;
  let held = "";

  return {
    append(chunk) {
      let incoming = held + chunk;
      held = "";
      const cut = INCOMPLETE_SEQUENCE.exec(incoming);
      if (cut && cut[0].length <= MAX_HELD_SEQUENCE) {
        held = cut[0];
        incoming = incoming.slice(0, cut.index);
      }
      incoming = stripAnsi(incoming).replace(/\r\n/g, "\n");
      text += incoming;
      size += Buffer.byteLength(incoming);
      if (size > maxBytes) {
        text = lastBytes(text, maxBytes);
        size = Buffer.byteLength(text);
        truncated = true;
      }
    },
    snapshot: () => ({ output: text, truncated }),
  };
}
