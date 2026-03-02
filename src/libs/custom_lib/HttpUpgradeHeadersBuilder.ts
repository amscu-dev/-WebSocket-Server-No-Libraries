import crypto from "node:crypto";
import http from "node:http";

import * as CONSTANTS from "@/libs/custom_lib/constants/constants";

export default class UpgradeHeadersBuilder {
  private headers: Record<string, string> = {};

  constructor(request: http.IncomingMessage) {
    this.buildDefaultHeaders(request);
  }

  private buildDefaultHeaders(request: http.IncomingMessage): void {
    const secWebSocketKey = request.headers["sec-websocket-key"] || "";
    const data = secWebSocketKey + CONSTANTS.GUID;
    const hash = crypto.createHash("sha1").update(data).digest("base64");

    this.headers = {
      Upgrade: "websocket",
      Connection: "Upgrade",
      "Sec-WebSocket-Accept": hash,
    };
  }

  addHeader(name: string, value: string): this {
    this.headers[name] = value;
    return this;
  }

  build(): Record<string, string> {
    return this.headers;
  }
}
