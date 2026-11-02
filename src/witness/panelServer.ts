import http from "node:http";
import { brokerRequest } from "../broker/client.js";
import { loadSession } from "../broker/session.js";
import type { TimelineEvent } from "../contract/timeline.js";
import { panelDocument } from "./panelHtml.js";
import { buildWitnessFrame } from "./render.js";

export interface PanelServer {
  host: "127.0.0.1";
  port: number;
  url: string;
  close: () => Promise<void>;
}

async function readFrame(workspace: string) {
  const session = loadSession(workspace);
  const [body, authBody] = await Promise.all([
    brokerRequest(session, "GET", "/v1/timeline", undefined, 5_000) as Promise<{ events?: TimelineEvent[] }>,
    brokerRequest(session, "GET", "/v1/auth", undefined, 5_000) as Promise<{
      auth?: { state: string; screenRecording: string; accessibility: string };
    }>,
  ]);
  const events = Array.isArray(body.events) ? body.events : [];
  const frame = buildWitnessFrame(events, {
    sessionId: session.id,
    host: "127.0.0.1",
    port: session.port,
  });
  if (authBody.auth && typeof authBody.auth.state === "string") {
    frame.auth = authBody.auth as typeof frame.auth;
    frame.authLine = `${frame.auth.state}（屏幕录制 ${frame.auth.screenRecording}，辅助功能 ${frame.auth.accessibility}）`;
  }
  return frame;
}

/** 只绑 127.0.0.1。这是 Mac 小窗口的 HTML 预览，不是公网页。 */
export function startPanelServer(workspace: string, port = 0): Promise<PanelServer> {
  const html = panelDocument();
  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
          res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(html);
          return;
        }
        if (req.method === "GET" && url.pathname === "/frame") {
          const frame = await readFrame(workspace);
          const body = JSON.stringify(frame);
          res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(body);
          return;
        }
        res.writeHead(404).end("not found");
      } catch (error) {
        const message = error instanceof Error ? error.message : "panel error";
        res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: message.slice(0, 180) }));
      }
    })();
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("panel 没有拿到端口"));
        return;
      }
      resolve({
        host: "127.0.0.1",
        port: address.port,
        url: `http://127.0.0.1:${address.port}/`,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
