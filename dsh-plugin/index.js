/**
 * DeepSeek Harness 从这里加载插件。
 * 实现编译在仓库 dist/dsh；安装时请先在仓库根目录 npm run compile。
 */
export { name, inject, apply, buildControlPlaneTools } from "../dist/dsh/plugin.js";
