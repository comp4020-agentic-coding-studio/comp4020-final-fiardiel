// Live updates. Each open house page holds one server-sent-events stream. After
// any change in a house, every stream in that house is told "changed" and the
// page fetches itself again; no other house hears about it.

export type Stream = {
  writeHead(status: number, headers: Record<string, string>): unknown;
  write(chunk: string): unknown;
  end(): unknown;
  on(event: "close", listener: () => void): unknown;
};

export class Hub {
  private houses = new Map<string, Set<Stream>>();
  private timer: ReturnType<typeof setInterval>;

  // Fly's proxy closes a connection that has been silent for a while, so a
  // comment line goes out on every stream at this interval.
  constructor(heartbeatMs = 25_000) {
    this.timer = setInterval(() => this.beat(), heartbeatMs);
    this.timer.unref();
  }

  open(code: string, stream: Stream): void {
    stream.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    // Sent at once so the browser (and a check) knows the stream is open.
    stream.write(": connected\n\n");
    const streams = this.houses.get(code) ?? new Set<Stream>();
    this.houses.set(code, streams);
    streams.add(stream);
    stream.on("close", () => {
      streams.delete(stream);
      if (streams.size === 0 && this.houses.get(code) === streams) this.houses.delete(code);
    });
  }

  // EventSource drops an event whose data is empty, so the data is "1".
  broadcast(code: string): void {
    for (const stream of this.houses.get(code) ?? []) stream.write("event: changed\ndata: 1\n\n");
  }

  count(code: string): number {
    return this.houses.get(code)?.size ?? 0;
  }

  private beat(): void {
    for (const streams of this.houses.values()) for (const stream of streams) stream.write(": ping\n\n");
  }

  // On shutdown: open streams would otherwise keep the server from closing.
  closeAll(): void {
    clearInterval(this.timer);
    for (const streams of this.houses.values()) for (const stream of streams) stream.end();
    this.houses.clear();
  }
}
