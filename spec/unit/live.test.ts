import { afterEach, describe, expect, it, vi } from "vitest";
import { Hub } from "../../src/live.ts";

class FakeStream {
  status = 0;
  headers: Record<string, string> = {};
  written: string[] = [];
  ended = false;
  private listeners: (() => void)[] = [];
  writeHead(status: number, headers: Record<string, string>) {
    this.status = status;
    this.headers = headers;
  }
  write(chunk: string) {
    this.written.push(chunk);
  }
  end() {
    this.ended = true;
  }
  on(_event: "close", listener: () => void) {
    this.listeners.push(listener);
  }
  disconnect() {
    for (const l of this.listeners) l();
  }
}

const hubs: Hub[] = [];
const hub = (ms?: number): Hub => {
  const h = new Hub(ms);
  hubs.push(h);
  return h;
};
afterEach(() => {
  while (hubs.length > 0) hubs.pop()!.closeAll();
  vi.useRealTimers();
});

describe("Hub", () => {
  it("opens an event stream and says so at once", () => {
    const s = new FakeStream();
    hub().open("ABC234", s);
    expect(s.status).toBe(200);
    expect(s.headers["content-type"]).toMatch(/^text\/event-stream/);
    expect(s.written).toEqual([": connected\n\n"]);
  });

  it("tells every stream in a house, and none in another", () => {
    const h = hub();
    const a1 = new FakeStream();
    const a2 = new FakeStream();
    const b = new FakeStream();
    h.open("AAAAAA", a1);
    h.open("AAAAAA", a2);
    h.open("BBBBBB", b);
    h.broadcast("AAAAAA");
    // An event with empty data is never delivered by EventSource, so data is non-empty.
    expect(a1.written.at(-1)).toBe("event: changed\ndata: 1\n\n");
    expect(a2.written.at(-1)).toBe("event: changed\ndata: 1\n\n");
    expect(b.written).toEqual([": connected\n\n"]);
  });

  it("forgets a stream once it closes", () => {
    const h = hub();
    const s = new FakeStream();
    h.open("AAAAAA", s);
    expect(h.count("AAAAAA")).toBe(1);
    s.disconnect();
    expect(h.count("AAAAAA")).toBe(0);
    h.broadcast("AAAAAA");
    expect(s.written).toEqual([": connected\n\n"]);
  });

  it("sends a heartbeat so an idle stream is not dropped", () => {
    vi.useFakeTimers();
    const h = hub(25_000);
    const s = new FakeStream();
    h.open("AAAAAA", s);
    vi.advanceTimersByTime(25_000);
    expect(s.written.at(-1)).toBe(": ping\n\n");
  });

  it("ends every stream on closeAll", () => {
    const h = hub();
    const s = new FakeStream();
    h.open("AAAAAA", s);
    h.closeAll();
    expect(s.ended).toBe(true);
    expect(h.count("AAAAAA")).toBe(0);
  });
});
