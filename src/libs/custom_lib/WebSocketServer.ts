import { EventEmitter } from "node:events";
import http from "node:http";
import net from "node:net";
import { Duplex } from "node:stream";

import * as CONSTANTS from "@/libs/custom_lib/constants/constants";

import {
  RequestValidator,
  UpgradeValidatorFactory,
} from "./HttpHandshakeValidators";
import HttpResponseBuilder from "./HttpResponseBuilder";
import UpgradeHeadersBuilder from "./HttpUpgradeHeadersBuilder";
import WebSocketParser from "./WebSocketParser";

type WebSocketServerOptions = {
  httpServer: http.Server;
  maxPayload?: number;
  headersMaxTimeout?: number;
  payloadMaxTimeout?: number;
};

type ServerEvents = {
  connection: [connection: WebSocketParser];
};

export default class WebSocketServer extends EventEmitter<ServerEvents> {
  /**
   * Maximum time (ms) allowed to receive complete WebSocket frame header
   * (FIN bit, opcode, mask bit, payload length indicator).
   * Prevents slow-read attacks where client sends header bytes very slowly.
   * If exceeded, close connection with error.
   */
  private _headersMaxTimeout: number;

  /**
   * Maximum time (ms) allowed to receive complete WebSocket frame payload data.
   * Prevents slow client from exhausting server resources by sending payload slowly.
   * If exceeded, close connection with error and free allocated buffers.
   */
  private _payloadMaxTimeout: number;
  /**
   * Maximum allowed payload size in bytes (1 MiB = 1,048,576 bytes).
   * Security limit to prevent memory exhaustion and DoS attacks.
   * If _totalPayloadLength exceeds this, throw error and close connection.
   * Can be configured per instance if needed
   */
  private _maxPayload: number;

  private _upgradeRequestValidator: RequestValidator;

  constructor({
    httpServer,
    maxPayload = 1024 * 1024,
    headersMaxTimeout = 30_000,
    payloadMaxTimeout = 60_000,
  }: WebSocketServerOptions) {
    super();
    this._maxPayload = maxPayload;
    this._headersMaxTimeout = headersMaxTimeout;
    this._payloadMaxTimeout = payloadMaxTimeout;

    this._upgradeRequestValidator = this._createHttpValidator();
    this._startWebSocketServer(httpServer);
  }

  private _startWebSocketServer(httpServer: http.Server) {
    httpServer.on("upgrade", (request, socket) => {
      const valid = this._validateHttpUpgradeRequest(request, socket);
      if (!valid) {
        return;
      }
      this._upgradeHttpConnection(request, socket);
    });
  }

  private _validateHttpUpgradeRequest(
    request: http.IncomingMessage,
    socket: Duplex,
  ) {
    // Parsing required client request headers in conformity with https://www.rfc-editor.org/rfc/rfc6455.html#section-4.1
    const validationResult = this._upgradeRequestValidator.validate(request);
    // https://www.rfc-editor.org/rfc/rfc6455.html#section-4.2.1
    if (!validationResult.isValid) {
      this._sendUpgradeErrorResponse(
        socket,
        400,
        "The HTTP headers do not comply with the RFC6455 spec.",
      );
      return false;
    }
    return true;
  }

  private _upgradeHttpConnection(
    request: http.IncomingMessage,
    socket: Duplex,
  ) {
    const netSocket = socket! as net.Socket;
    const headers = new UpgradeHeadersBuilder(request).build();

    const response = new HttpResponseBuilder(headers)
      .setStatus(101, "Switching Protocols")
      .build();

    // WEBSOCKET SERVER LOGIC
    // code below will relate to our custom websocket server
    console.log(
      `[ WS ] WebSocket Connection established. Client port: ${netSocket.remotePort}. Client IP: ${netSocket.remoteAddress}`,
    );

    // receiver its not garbage collected bcs of closure, and its must be the same unique receiver obj for an entire lifetime of an connection because of fragmentation of data
    const receiver = new WebSocketParser({
      socket: netSocket,
      maxPayload: this._maxPayload,
      headersMaxTimeout: this._headersMaxTimeout,
      payloadMaxTimeout: this._payloadMaxTimeout,
    });

    this.emit("connection", receiver);

    netSocket.write(response);
  }

  private _sendUpgradeErrorResponse(
    socket: Duplex,
    statusCode: number,
    message: string,
  ): void {
    const messageLength = message.length;
    const response =
      `HTTP/1.1 ${statusCode} Bad Request\r\n` +
      `Content-Type: text/plain\r\n` +
      `Content-Length: ${messageLength}\r\n` +
      `\r\n` +
      message;

    socket.write(response);
    socket.destroy();
  }

  private _createHttpValidator() {
    return UpgradeValidatorFactory.createValidator(CONSTANTS.upgradeConfig);
  }
}
