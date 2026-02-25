import crypto from "node:crypto";
import http from "node:http";
import { Duplex } from "node:stream";

import * as CONSTANTS from "@/libs/custom_lib/constants/constants";

class UpgradeHeadersBuilder {
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

class HttpResponseBuilder {
  private statusCode: number = 101;
  private statusText: string = "Switching Protocols";
  private headers: Record<string, string>;

  constructor(headers: Record<string, string>) {
    this.headers = headers;
  }

  setStatus(code: number, text: string): this {
    this.statusCode = code;
    this.statusText = text;
    return this;
  }

  addHeader(name: string, value: string): this {
    this.headers[name] = value;
    return this;
  }

  build(): string {
    const statusLine = `HTTP/1.1 ${this.statusCode} ${this.statusText}\r\n`;
    const headerLines = Object.entries(this.headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\r\n");

    return statusLine + headerLines + "\r\n\r\n";
  }
}

function startWebSocketConnection(socket: Duplex) {
  console.log(socket);
}

export function upgradeHttpConnection(
  request: http.IncomingMessage,
  socket: Duplex,
): void {
  const headers = new UpgradeHeadersBuilder(request).build();

  const response = new HttpResponseBuilder(headers)
    .setStatus(101, "Switching Protocols")
    .build();

  socket.write(response);

  startWebSocketConnection(socket);
}
