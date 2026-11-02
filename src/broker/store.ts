import fs from "node:fs";
import path from "node:path";
import type { TimelineEvent } from "../contract/timeline.js";

export interface TimelineStore {
  append(event: TimelineEvent): void;
  list(): TimelineEvent[];
}

export class MemoryTimelineStore implements TimelineStore {
  private events: TimelineEvent[] = [];

  append(event: TimelineEvent): void {
    this.events.push(event);
  }

  list(): TimelineEvent[] {
    return this.events;
  }
}

/** 追加写入 JSONL。将来的小窗口订阅的就是这份序列。 */
export class FileTimelineStore implements TimelineStore {
  private events: TimelineEvent[] = [];

  constructor(private readonly file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (!fs.existsSync(file)) return;
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        this.events.push(JSON.parse(line) as TimelineEvent);
      } catch {
        // 坏行留在文件里，但不让它挡住后面的事件。
      }
    }
  }

  append(event: TimelineEvent): void {
    this.events.push(event);
    fs.appendFileSync(this.file, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  list(): TimelineEvent[] {
    return this.events.slice(-300);
  }
}
