import { OUTPUT_TAIL_BYTES } from "../shared/shell-run";

const ESC = "\x1b";
const CSI = `${ESC}\\[[0-?]*[ -/]*[@-~]`;
const OSC = `${ESC}\\][^\\x07${ESC}]*(?:\\x07|${ESC}\\\\)`;
const CHARSET_SELECTION = `${ESC}[()][ -~]`;
const TWO_CHAR_ESCAPE = `${ESC}[@-Z\\\\-_]`;
const ANSI_SEQUENCE = new RegExp([CSI, OSC, CHARSET_SELECTION, TWO_CHAR_ESCAPE].join("|"), "g");
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

const isUtf8ContinuationByte = (byte: number) => (byte & 0xc0) === 0x80;

function lastBytes(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  let start = bytes.length - maxBytes;
  while (start < bytes.length && isUtf8ContinuationByte(bytes[start]!)) start++;
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
