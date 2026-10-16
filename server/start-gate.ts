export interface StartGate {
  push(text: string): string;
  end(): string;
}

export const markerLine = (marker: string) => `\n${marker}\n`;

export function createStartGate(marker: string): StartGate {
  const needle = markerLine(marker);
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
