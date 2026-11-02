import type { WitnessFrame } from "./render.js";

/**
 * Prism 指挥台式小窗口。
 * 一块「正在做」主区 + 最近步骤轨；状态用左边线，不靠花哨卡片堆。
 * Mac 原生窗口按同一构图实现，见 mac-helper/UI.md。
 */
export function panelDocument(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>本机控制面 · 见证</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@450;560;680&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #12151a;
      --bg-elevated: rgba(255, 255, 255, 0.045);
      --bg-hero: rgba(255, 255, 255, 0.06);
      --stroke: rgba(255, 255, 255, 0.08);
      --text: #e8eaed;
      --text-dim: #9aa3af;
      --text-faint: #6b7380;
      --accent: #7eb8c9;
      --tone-idle: #6b7380;
      --tone-running: #7eb8c9;
      --tone-passed: #6fbf8b;
      --tone-failed: #d9897a;
      --tone-rejected: #c4a35a;
      --radius: 14px;
      --font: "Plus Jakarta Sans", "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      min-height: 100%;
      background: radial-gradient(1200px 600px at 10% -10%, #1a222c 0%, var(--bg) 55%);
      color: var(--text);
      font-family: var(--font);
      font-size: 13px;
      line-height: 1.45;
      -webkit-font-smoothing: antialiased;
    }
    .shell {
      width: min(380px, 100%);
      margin: 0 auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    header.brand {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      padding: 2px 2px 0;
    }
    .brand-name {
      font-size: 15px;
      font-weight: 680;
      letter-spacing: -0.02em;
    }
    .brand-sub {
      color: var(--text-faint);
      font-size: 11px;
      font-weight: 450;
    }
    .hero {
      position: relative;
      padding: 14px 14px 14px 16px;
      border-radius: var(--radius);
      background: var(--bg-hero);
      border: 1px solid var(--stroke);
      backdrop-filter: blur(18px);
      overflow: hidden;
    }
    .hero::before {
      content: "";
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 3px;
      background: var(--tone);
    }
    .kicker {
      color: var(--text-dim);
      font-size: 11px;
      font-weight: 560;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .hero-title {
      font-size: 16px;
      font-weight: 680;
      letter-spacing: -0.02em;
      margin: 0 0 8px;
    }
    .meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 10px;
      color: var(--text-dim);
      font-size: 12px;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      border-radius: 999px;
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--stroke);
      color: var(--text-dim);
      font-size: 11px;
      font-weight: 560;
    }
    .chip .dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--tone);
    }
    .rail {
      border-radius: var(--radius);
      border: 1px solid var(--stroke);
      background: var(--bg-elevated);
      backdrop-filter: blur(14px);
      padding: 10px 8px;
    }
    .rail h2 {
      margin: 0 8px 8px;
      font-size: 11px;
      font-weight: 560;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .item {
      position: relative;
      margin: 0 0 6px;
      padding: 8px 10px 8px 12px;
      border-radius: 10px;
      background: rgba(0,0,0,0.18);
      border: 1px solid transparent;
    }
    .item::before {
      content: "";
      position: absolute;
      left: 0; top: 8px; bottom: 8px;
      width: 2px;
      border-radius: 2px;
      background: var(--tone);
    }
    .item:last-child { margin-bottom: 0; }
    .item-top {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 2px;
    }
    .item-verb {
      font-weight: 560;
      letter-spacing: -0.01em;
    }
    .item-kind {
      color: var(--text-faint);
      font-size: 11px;
    }
    .item-step {
      color: var(--text-dim);
      font-size: 12px;
    }
    .empty {
      padding: 18px 14px;
      color: var(--text-dim);
      text-align: left;
    }
    .empty strong {
      display: block;
      color: var(--text);
      font-size: 14px;
      margin-bottom: 6px;
    }
    footer {
      color: var(--text-faint);
      font-size: 11px;
      padding: 0 2px 4px;
    }
    .tone-idle { --tone: var(--tone-idle); }
    .tone-running { --tone: var(--tone-running); }
    .tone-passed { --tone: var(--tone-passed); }
    .tone-failed { --tone: var(--tone-failed); }
    .tone-rejected { --tone: var(--tone-rejected); }
    .auth {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .auth-card {
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--stroke);
      background: rgba(255,255,255,0.035);
    }
    .auth-card strong {
      display: block;
      font-size: 12px;
      font-weight: 560;
      margin-bottom: 4px;
    }
    .auth-card span {
      color: var(--text-dim);
      font-size: 11px;
    }
    .auth-ready strong { color: var(--tone-passed); }
    .auth-missing strong { color: var(--tone-failed); }
    .auth-partial strong { color: var(--tone-rejected); }
    .auth-offline strong, .auth-placeholder strong { color: var(--text-dim); }
  </style>
</head>
<body>
  <div class="shell">
    <header class="brand">
      <div class="brand-name">本机控制面</div>
      <div class="brand-sub">见证 · Prism 构图</div>
    </header>
    <div id="root">
      <div class="empty"><strong>在等第一步</strong>先让扩展把 broker 拉起来，再由 Cursor / Codex / DeepSeek 下任务。</div>
    </div>
    <footer>画面与长日志留在本机。Mac 小窗口不抢焦点，订阅同一条时间线。</footer>
  </div>
  <script>
    function esc(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function render(frame) {
      const root = document.getElementById("root");
      if (!frame) {
        root.innerHTML = '<div class="empty"><strong>读不到会话</strong>确认 broker 在 127.0.0.1，且 CONTROLPLANE_WORKSPACE 指向当前工作区。</div>';
        return;
      }
      const tone = frame.tone || "idle";
      let html = '';
      html += '<section class="hero tone-' + esc(tone) + '">';
      html += '<div class="kicker">正在做</div>';
      html += '<p class="hero-title">' + esc(frame.currentStep) + '</p>';
      html += '<div class="meta-row">';
      html += '<span class="chip"><span class="dot"></span>' + esc(frame.actor) + ' · ' + esc(frame.entry) + '</span>';
      html += '<span class="chip">' + esc(frame.statusLine) + '</span>';
      html += '</div>';
      html += '</section>';

      const auth = frame.auth || {};
      const authState = auth.state || "placeholder";
      const authClass =
        authState === "ready" ? "auth-ready" :
        authState === "helper_offline" || authState === "placeholder" ? "auth-" + (authState === "helper_offline" ? "offline" : "placeholder") :
        authState === "missing_both" ? "auth-missing" : "auth-partial";
      html += '<section class="auth">';
      html += '<div class="auth-card ' + authClass + '"><strong>屏幕录制</strong><span>' + esc(auth.screenRecording || "unknown") + '</span></div>';
      html += '<div class="auth-card ' + authClass + '"><strong>辅助功能</strong><span>' + esc(auth.accessibility || "unknown") + '</span></div>';
      html += '</section>';
      html += '<p class="meta-row">' + esc(frame.authLine) + '</p>';

      html += '<section class="rail"><h2>最近</h2>';
      const items = Array.isArray(frame.recentItems) ? frame.recentItems : [];
      if (items.length === 0) {
        html += '<div class="empty" style="padding:8px 10px">还没有完成的步骤。</div>';
      } else {
        for (const item of items) {
          html += '<article class="item tone-' + esc(item.tone || "idle") + '">';
          html += '<div class="item-top"><span class="item-verb">' + esc(item.verb) + '</span><span class="item-kind">' + esc(item.stepKind) + '</span></div>';
          html += '<div class="item-step">' + esc(item.step) + ' · ' + esc(item.status) + '</div>';
          html += '</article>';
        }
      }
      html += '</section>';
      root.innerHTML = html;
      document.title = frame.currentStep + ' · 本机控制面';
    }

    async function tick() {
      try {
        const response = await fetch("/frame", { cache: "no-store" });
        if (!response.ok) throw new Error("frame " + response.status);
        render(await response.json());
      } catch (error) {
        render(null);
      }
    }

    tick();
    setInterval(tick, 1000);
  </script>
</body>
</html>`;
}

export function assertPanelAesthetic(html: string): void {
  if (!html.includes("正在做")) throw new Error("缺少主区");
  if (!html.includes("Plus Jakarta Sans")) throw new Error("缺少专用字体");
  if (!html.includes("tone-passed")) throw new Error("缺少状态色");
  if (/\bInter\b|\bRoboto\b|\bArial\b|\blorem\b/i.test(html)) {
    throw new Error("审美偏离：出现默认栈或模板腔");
  }
}

export function framePayload(frame: WitnessFrame): WitnessFrame {
  return frame;
}
