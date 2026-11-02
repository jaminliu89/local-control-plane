/** 扩展写给本机 MCP 的握手。只描述 127.0.0.1 上的一个窗口。 */
export interface BrokerSession {
  id: string;
  host: "127.0.0.1";
  port: number;
  token: string;
  pid: number;
}
