import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import { Duplex } from "node:stream";

import * as CONSTANTS from "@/libs/custom_lib/constants/constants";

import WebSocketServer from "./WebSocketServer";

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

export function upgradeHttpConnection(
  request: http.IncomingMessage,
  socket: Duplex,
): void {
  const netSocket = socket as net.Socket;
  const headers = new UpgradeHeadersBuilder(request).build();

  const response = new HttpResponseBuilder(headers)
    .setStatus(101, "Switching Protocols")
    .build();

  netSocket.write(response);

  // WEBSOCKET SERVER LOGIC
  // code below will relate to our custom websocket server
  console.log(
    `[ WS ] WebSocket Connection established. Client port: ${netSocket.remotePort}. Client IP: ${netSocket.remoteAddress}`,
  );
  // receiver its not garbage collected bcs of closure, and its must be the same unique receiver obj for an entire lifetime of an connection because of fragmentation of data
  const receiver = new WebSocketServer(netSocket);

  receiver.on("message", (message) => {
    console.log(
      "📨 Message:",
      message.data.length > 20
        ? message.data.slice(0, 20) + "..."
        : message.data.toString(),
    );
    receiver.send("Message received!");
  });

  receiver.on("close", (closureEvent) => {
    console.log("=== WebSocket Connection Closed ===");
    console.log(closureEvent);
  });
}
