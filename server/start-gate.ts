export interface StartGate {
  // Returns the text to pass on: nothing until the marker line has been seen, then everything.
  push(text: string): string;
  // Called when the stream closes. If the marker never arrived, the held text is released.
  end(): string;
}

// Drops everything a shell prints before its start marker line, including the newline printed
// ahead of the marker so output without a trailing newline goes with it.
export function createStartGate(marker: string): StartGate {
  const needle = `\n${marker}\n`;
  let held: string | null = "";

  return {
    push(text) {
      if (held === null) return text;
      const searchFrom = Math.max(0, held.length - needle.length + 1);
      held += text;
      const at = held.indexOf(needle, searchFrom);
      if (at === -1) return "";
      const rest = held.slice(at + needle.length);
      held = null;
      return rest;
    },
    end() {
      const rest = held ?? "";
      held = null;
      return rest;
    },
  };
}
