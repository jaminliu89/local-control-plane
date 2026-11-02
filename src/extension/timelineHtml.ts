/** 侧边栏时间线。文案写在这里，空状态说明真实行为，不放占位段。 */
export function timelineHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>时间线</title>
  <style nonce="${nonce}">
    body {
      margin: 0;
      padding: 12px;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size, 13px);
      line-height: 1.45;
    }
    h2 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
    p { margin: 0 0 8px; }
    .muted { color: var(--vscode-descriptionForeground); }
    .banner {
      margin-bottom: 10px;
      padding: 8px;
      border: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-panel-border));
    }
    .auth-strip {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin: 0 0 12px;
    }
    .auth-cell {
      padding: 8px 10px;
      border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, transparent));
      background: var(--vscode-editor-background);
      border-left: 3px solid var(--auth-tone, var(--vscode-panel-border));
    }
    .auth-cell strong {
      display: block;
      font-size: 12px;
      margin-bottom: 2px;
    }
    .auth-cell span {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .auth-ready { --auth-tone: #3f8f6b; }
    .auth-missing { --auth-tone: #c27366; }
    .auth-partial { --auth-tone: #a88b3d; }
    .auth-offline, .auth-placeholder { --auth-tone: var(--vscode-descriptionForeground); }
    .auth-line {
      margin: -4px 0 12px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .now {
      margin: 0 0 12px;
      padding: 10px 10px 10px 12px;
      border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, transparent));
      background: var(--vscode-editor-background);
      border-left: 3px solid var(--tone, var(--vscode-focusBorder));
    }
    .now h2 { margin-bottom: 6px; }
    .card {
      margin: 0 0 10px;
      padding: 8px 8px 8px 10px;
      border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, transparent));
      background: var(--vscode-editor-background);
      border-left: 3px solid var(--tone, var(--vscode-panel-border));
    }
    .tone-passed { --tone: #3f8f6b; }
    .tone-failed { --tone: #c27366; }
    .tone-rejected { --tone: #a88b3d; }
    .tone-running { --tone: #4f8fa3; }
    .tone-idle { --tone: var(--vscode-descriptionForeground); }
    .k {
      display: inline-block;
      min-width: 5.5em;
      color: var(--vscode-descriptionForeground);
    }
    .meta { color: var(--vscode-descriptionForeground); font-size: 12px; }
  </style>
</head>
<body>
  <div id="root">
    <div class="empty">
      <h2>时间线还是空的</h2>
      <p>这里列出本机控制面做过的每一步。扩展激活后只在 127.0.0.1 启动 broker。Cursor 或 Codex 通过 MCP 调用 observe、edit、terminal、verify，或用 trace 只记一条事件。</p>
      <p>每条都会写出入口、动词、改动摘要、压缩回执，以及这一步是模型轮次还是本地验收循环。顶部「正在做」与终端见证、将来的 Mac 小窗口读同一份事件。</p>
      <p class="muted">回执只有退出码、失败名或第一段错误、diff 统计和耗时。完整日志留在本机，不要把全量日志要回去。通过就停。</p>
      <p class="muted">如果一直是空的：确认这个窗口里扩展已激活，并且 MCP 的 CONTROLPLANE_WORKSPACE 就是当前文件夹。新仓库可先运行「初始化工作区命令」。</p>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const root = document.getElementById("root");

    function esc(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function receiptText(receipt) {
      if (!receipt) return "进行中，还没有回执";
      const parts = [receipt.status];
      if (receipt.exitCode !== null && receipt.exitCode !== undefined) parts.push("退出码 " + receipt.exitCode);
      if (receipt.failure) parts.push(receipt.failure);
      if (receipt.diff) {
        parts.push("diff +" + receipt.diff.additions + " -" + receipt.diff.deletions + "，文件 " + receipt.diff.files);
      }
      parts.push((receipt.durationMs == null ? 0 : receipt.durationMs) + " ms");
      if (receipt.rounds) parts.push(receipt.rounds + " 轮");
      return parts.join(" · ");
    }

    function authText(auth) {
      if (!auth) return "占位";
      return esc(auth.state) + "（屏幕录制 " + esc(auth.screenRecording) + "，辅助功能 " + esc(auth.accessibility) + "）";
    }

    function authClass(state) {
      if (state === "ready") return "auth-ready";
      if (state === "helper_offline") return "auth-offline";
      if (state === "placeholder") return "auth-placeholder";
      if (state === "missing_both") return "auth-missing";
      return "auth-partial";
    }

    function authStrip(auth) {
      if (!auth) return "";
      const klass = authClass(auth.state || "placeholder");
      return '<section class="auth-strip">'
        + '<div class="auth-cell ' + klass + '"><strong>屏幕录制</strong><span>' + esc(auth.screenRecording || "unknown") + '</span></div>'
        + '<div class="auth-cell ' + klass + '"><strong>辅助功能</strong><span>' + esc(auth.accessibility || "unknown") + '</span></div>'
        + '</section>'
        + '<p class="auth-line">授权态 ' + authText(auth) + '</p>';
    }

    function emptyState() {
      return '<div class="empty">'
        + '<h2>时间线还是空的</h2>'
        + '<p>这里列出本机控制面做过的每一步。扩展激活后只在 127.0.0.1 启动 broker。Cursor 或 Codex 通过 MCP 调用 observe、edit、terminal、verify，或用 trace 只记一条事件。</p>'
        + '<p>每条都会写出入口、动词、改动摘要、压缩回执，以及这一步是模型轮次还是本地验收循环。顶部「正在做」与终端见证、将来的 Mac 小窗口读同一份事件。</p>'
        + '<p class="muted">回执只有退出码、失败名或第一段错误、diff 统计和耗时。完整日志留在本机，不要把全量日志要回去。通过就停。</p>'
        + '<p class="muted">如果一直是空的：确认这个窗口里扩展已激活，并且 MCP 的 CONTROLPLANE_WORKSPACE 就是当前文件夹。新仓库可先运行「初始化工作区命令」。</p>'
        + '</div>';
    }

    function toneOf(receipt, phase) {
      if (receipt && receipt.status) return receipt.status;
      if (phase === "started") return "running";
      return "idle";
    }

    function nowPanel(now) {
      if (!now) return "";
      const tone = now.tone || "idle";
      return '<section class="now tone-' + esc(tone) + '">'
        + '<h2>正在做</h2>'
        + '<p><span class="k">谁</span>' + esc(now.actor) + '（' + esc(now.entry) + '）</p>'
        + '<p><span class="k">步骤</span>' + esc(now.currentStep) + '</p>'
        + '<p><span class="k">状态</span>' + esc(now.statusLine) + '</p>'
        + '<p class="meta">会话 ' + esc(now.sessionId) + ' · ' + esc(now.host) + ':' + esc(now.port) + '</p>'
        + '</section>';
    }

    function render(events, note, now, auth) {
      let html = "";
      if (note) html += '<p class="banner">' + esc(note) + '</p>';
      html += authStrip(auth || (now && now.auth) || null);
      html += nowPanel(now);
      if (!events || events.length === 0) {
        html += emptyState();
        root.innerHTML = html;
        return;
      }
      const ordered = events.slice().reverse();
      for (let index = 0; index < ordered.length; index += 1) {
        const event = ordered[index];
        const kind = event.stepKind === "local_loop" ? "本地循环" : "模型轮次";
        const tone = toneOf(event.receipt, event.phase);
        html += '<article class="card tone-' + esc(tone) + '">'
          + '<p><span class="k">入口</span>' + esc(event.entry) + '</p>'
          + '<p><span class="k">动词</span>' + esc(event.verb) + '</p>'
          + '<p><span class="k">改动摘要</span>' + esc(event.summary) + '</p>'
          + '<p><span class="k">回执</span>' + esc(receiptText(event.receipt)) + '</p>'
          + '<p><span class="k">这一步</span>' + kind + '</p>'
          + '<p><span class="k">显示</span>经扩展</p>'
          + '<p class="meta">谁在下任务：' + esc(event.actor) + ' · 步骤：' + esc(event.step) + '</p>'
          + '<p class="meta">授权：' + authText(event.auth) + '</p>'
          + '</article>';
      }
      root.innerHTML = html;
    }

    window.addEventListener("message", function (event) {
      const message = event.data;
      if (!message || message.type !== "timeline") return;
      if (Array.isArray(message.events)) render(message.events, message.note || "", message.now || null, message.auth || null);
      else if (message.note) {
        const banner = document.querySelector(".banner");
        if (!banner) root.insertAdjacentHTML("afterbegin", '<p class="banner">' + esc(message.note) + '</p>');
      }
    });

    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
}
