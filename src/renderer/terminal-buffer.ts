const ANSI_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const OSC_PATTERN = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g;

export function stripAnsi(value: string): string {
  return value.replace(OSC_PATTERN, '').replace(ANSI_PATTERN, '');
}

export class TerminalBuffer {
  private readonly maxLines: number;
  private lines: string[] = [];
  private currentLine = '';
  private cursor = 0;

  constructor(maxLines = 4_000) {
    this.maxLines = maxLines;
  }

  append(chunk: string): void {
    const clean = stripAnsi(chunk);
    for (const character of clean) {
      if (character === '\n') {
        this.lines.push(this.currentLine);
        this.currentLine = '';
        this.cursor = 0;
        this.trim();
        continue;
      }
      if (character === '\r') {
        this.cursor = 0;
        continue;
      }
      if (character === '\b' || character === '\u007f') {
        if (this.cursor > 0) {
          this.currentLine = `${this.currentLine.slice(0, this.cursor - 1)}${this.currentLine.slice(this.cursor)}`;
          this.cursor -= 1;
        }
        continue;
      }
      if (character < ' ' && character !== '\t') {
        continue;
      }

      if (this.cursor >= this.currentLine.length) {
        this.currentLine += character;
      } else {
        this.currentLine = `${this.currentLine.slice(0, this.cursor)}${character}${this.currentLine.slice(this.cursor + 1)}`;
      }
      this.cursor += 1;
    }
  }

  clear(): void {
    this.lines = [];
    this.currentLine = '';
    this.cursor = 0;
  }

  toString(): string {
    return [...this.lines, this.currentLine].join('\n');
  }

  private trim(): void {
    if (this.lines.length > this.maxLines) {
      this.lines.splice(0, this.lines.length - this.maxLines);
    }
  }
}
