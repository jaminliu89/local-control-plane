import http from "node:http";

export interface LoopbackTarget {
  host: string;
  port: number;
  token: string;
}

/** 只向 127.0.0.1 发请求。这是扩展和 MCP 找 broker 的内部通道。 */
export function brokerRequest(
  target: LoopbackTarget,
  method: "GET" | "POST",
  pathname: string,
  body?: unknown,
  timeoutMs = 180_000,
): Promise<unknown> {
  if (target.host !== "127.0.0.1") return Promise.reject(new Error("拒绝非回环地址"));
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: target.port,
        path: pathname,
        method,
        headers: {
          authorization: `Bearer ${target.token}`,
          ...(payload
            ? { "content-type": "application/json", "content-length": payload.length }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve(text.length === 0 ? {} : JSON.parse(text));
          } catch {
            reject(new Error("broker 返回的不是 JSON"));
          }
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("broker 超时"));
    });
    req.on("error", reject);
    if (payload) req.end(payload);
    else req.end();
  });
}
