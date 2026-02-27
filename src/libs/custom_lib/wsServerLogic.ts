import net from "node:net";

import * as CONSTANTS from "@/libs/custom_lib/constants/constants";

// define loop engine variables
const GET_INFO = 1;
const GET_LENGTH = 2;
const GET_MASK_KEY = 3;
const GET_PAYLOAD = 4;
const SEND_ECHO = 5;

/**
 * WebSocketReceiver
 *
 * Handles parsing and processing of incoming WebSocket frames from client.
 * Accumulates fragmented TCP chunks and parses them according to RFC 6455.
 *
 * Uses a state machine (task loop) to parse frame components in sequence:
 * 1. Frame info (FIN bit, opcode, mask bit) - 2 bytes
 * 2. Payload length - variable
 * 3. Mask key (if masked) - 4 bytes
 * 4. Payload data - variable
 *
 * @note Receiver instance is kept alive via closure and persists for the
 *       entire connection lifetime, accumulating chunks as they arrive.
 */
class WebSocketReceiver {
  private _socket: net.Socket;
  /**
   * Array of Buffer chunks received from TCP socket.
   * Each element represents a separate chunk from socket.on("data").
   * Chunks are consumed sequentially by _consumeHeaders().
   */
  private _buffersArray: Buffer[] = [];

  /**
   * Total number of bytes accumulated in _buffersArray.
   * Decremented as bytes are consumed during frame parsing.
   * Goal: reduce to 0 when entire frame is processed.
   */
  private _bufferedBytesLength: number = 0;

  /**
   * Flag controlling the task loop iteration.
   * Set to true when entering loop, set to false to terminate parsing
   * and wait for next chunk batch.
   */
  private _taskLoop: boolean = false;

  /**
   * Current state in the frame parsing state machine.
   * Determines which parsing method to execute in switch statement.
   * States: GET_INFO → GET_LENGTH → GET_MASK_KEY → GET_PAYLOAD → SEND_ECHO
   */
  private _task: number = GET_INFO;

  /**
   * FIN bit (Frame Final flag) from RFC 6455.
   * If true: this is the final fragment of the message.
   * If false: more fragments expected.
   */
  private _fin: boolean = false;

  /**
   * Opcode field from first byte of WebSocket frame.
   * Indicates data type:
   * - 0x0: Continuation frame
   * - 0x1: Text frame
   * - 0x2: Binary frame
   * - 0x8: Close frame
   * - 0x9: Ping frame
   * - 0xA: Pong frame
   */
  private _opcode: null | number = null;

  /**
   * MASK bit from second byte of WebSocket frame.
   * If true: payload is masked (client-to-server, required per RFC 6455).
   * If false: payload is unmasked (server-to-client).
   */
  private _masked: boolean = false;

  /**
   * Payload length indicator from bits 1-7 of second byte.
   * If value < 126: payload length in bytes.
   * If value = 126: next 2 bytes contain actual length.
   * If value = 127: next 8 bytes contain actual length.
   */
  private _initialPayloadSizeIndicator: number = 0;

  private _framePayloadLength: number = 0;

  /**
   * Initializes WebSocketReceiver with TCP socket reference.
   *
   * @param socket - TCP socket connected to WebSocket client.
   *                 Socket is maintained in closure and persists for
   *                 entire connection lifetime.
   */
  constructor(socket: net.Socket) {
    this._socket = socket;
  }

  /**
   * Processes incoming TCP chunk and initiates frame parsing.
   *
   * Called by socket.on("data") event listener whenever client sends bytes.
   * Accumulates chunk in _buffersArray and triggers state machine parsing.
   *
   * @param chunk - Buffer containing bytes received from TCP layer.
   *                May be partial frame (data fragmentation).
   *
   * @example
   * socket.on("data", (chunk) => {
   *   receiver.processBuffer(chunk);
   * });
   */
  public processBuffer(chunk: Buffer) {
    this._buffersArray.push(chunk);
    this._bufferedBytesLength += chunk.length;
    // start processing & parsing bytes

    this._startTaskLoop();
  }

  /**
   * State machine loop for WebSocket frame parsing.
   * Repeatedly executes current task (_task) until loop flag is cleared.
   *
   * Allows incremental parsing: parse what's available, then wait for
   * next chunk if more data needed. When chunk arrives, loop resumes.
   *
   * @private
   */
  private _startTaskLoop() {
    // set _taskLoop to false when we are done processing data
    this._taskLoop = true;

    do {
      switch (this._task) {
        case GET_INFO:
          this._getInfo(); // first info get info about ws frame data received ( ws binary frame format )
          break;
        case GET_LENGTH:
          this._getLength();
          break;
      }
    } while (this._taskLoop);
  }

  /**
   * Parses first 2 bytes of WebSocket frame (RFC 6455 section 5.2).
   *
   * Byte 1 (firstByte):
   * - Bit 0: FIN flag (0x80)
   * - Bits 1-3: Reserved (0x70)
   * - Bits 4-7: Opcode (0x0F)
   *
   * Byte 2 (secondByte):
   * - Bit 0: MASK flag (0x80)
   * - Bits 1-7: Payload length indicator (0x7F)
   *
   * @private
   */
  private _getInfo() {
    const infoBuffer = this._consumeHeaders(
      CONSTANTS.WS_DATA_FRAME_RULES.MIN_FRAME_SIZE,
    );
    if (!infoBuffer) {
      throw Error(
        "You cannot extract more data from a ws frame than the actual size.",
      );
    }

    const firstByte = infoBuffer[0];
    const secondByte = infoBuffer[1];

    this._fin = (firstByte & 0b10000000) === 0b10000000;
    this._opcode = firstByte & 0b00001111;
    this._masked = (secondByte & 0b10000000) === 0b10000000;
    this._initialPayloadSizeIndicator = secondByte & 0b01111111;

    if (!this._masked) {
      // send a close frame back to the client
      throw new Error("Mask is not set by the client");
    }

    this._task = GET_LENGTH;
  }

  /**
   * Parses payload length field from WebSocket frame header.
   * Payload length uses variable-length encoding:
   * - If indicator < 126: length is in indicator (already parsed)
   * - If indicator = 126: next 2 bytes (uint16) contain length
   * - If indicator = 127: next 8 bytes (uint64) contain length
   *
   * Handles TCP fragmentation gracefully: if not enough bytes yet,
   * stops parsing and waits for next chunk to arrive.
   *
   * @private
   */
  private _getLength() {
    switch (this._initialPayloadSizeIndicator) {
      case CONSTANTS.WS_DATA_FRAME_RULES.MEDIUM_SIZE_DATA_FLAG: {
        const mediumPayloadLengthBuffer = this._consumeHeaders(
          CONSTANTS.WS_DATA_FRAME_RULES.MEDIUM_SIZE_CONSUMPTION_BYTES,
        );

        if (!mediumPayloadLengthBuffer) {
          throw new Error(
            "Incomplete frame header: expected 2-byte payload length, " +
              "but insufficient data received. " +
              "Client may have fragmented WebSocket frame header.",
          );
        }

        this._framePayloadLength = mediumPayloadLengthBuffer.readUInt16BE();

        // this.processLength();

        break;
      }
      case CONSTANTS.WS_DATA_FRAME_RULES.LARGE_SIZE_DATA_FLAG: {
        const largePayloadLengthBuffer = this._consumeHeaders(
          CONSTANTS.WS_DATA_FRAME_RULES.LARGE_SIZE_CONSUMPTION_BYTES,
        );

        if (!largePayloadLengthBuffer) {
          throw new Error(
            "Incomplete frame header: expected 8-byte payload length, " +
              "but insufficient data received. " +
              "Client may have fragmented WebSocket frame header.",
          );
        }

        this._framePayloadLength = Number(
          largePayloadLengthBuffer.readBigUInt64BE(),
        );

        // this.processLength();

        break;
      }
      // payload <= 125 bytes
      default: {
        this._framePayloadLength = this._initialPayloadSizeIndicator;

        // this.processLength();
        break;
      }
    }
  }
  /**
   * Extracts and removes first N bytes from accumulated buffer array.
   *
   * Handles three cases:
   * 1. Exact match: First buffer has exactly N bytes → return and remove
   * 2. Partial: First buffer has > N bytes → return N bytes, keep rest
   * 3. Insufficient: First buffer has < N bytes → return undefined
   *
   * This allows frame parsing to proceed incrementally as chunks arrive,
   * even when data is fragmented across multiple TCP packets.
   *
   * @param n - Number of bytes to extract
   * @returns Buffer containing requested bytes, or undefined if insufficient data
   *
   * @private
   */
  private _consumeHeaders(n: number): Buffer | undefined {
    // Case 1: First buffer has EXACTLY n bytes
    if (n === this._buffersArray[0].length) {
      // Remove and return entire buffer
      const buffer = this._buffersArray.shift();

      //  decrement (after we know we have enough)
      this._bufferedBytesLength -= n;

      return buffer;
    }

    // Case 2: First buffer has MORE than n bytes
    if (n < this._buffersArray[0].length) {
      // Extract first n bytes
      const consumed = this._buffersArray[0].subarray(0, n);

      // Keep remainder in array
      this._buffersArray[0] = this._buffersArray[0].subarray(n);

      //  decrement (we know we have enough)
      this._bufferedBytesLength -= n;

      return consumed;
    }

    // Case 3: First buffer has LESS than n bytes
    // n > this._buffersArray[0].length
    // DO NOT DECREMENT - we don't have enough bytes!
    // Just return undefined and wait for next chunk

    return undefined;
  }
}

// WEBSOCKET SERVER LOGIC
// code below will relate to our custom websocket server
export default function startWebSocketConnection(socket: net.Socket) {
  console.log(
    `[ WS ] WebSocket Connection established. Client port: ${socket.remotePort}. Client IP: ${socket.remoteAddress}`,
  );
  // receiver its not garbage collected bcs of closure, and its must be the same unique receiver obj for an entire lifetime of an connection because of fragmentation of data
  const receiver = new WebSocketReceiver(socket);
  // socket = TCP Communication Socket ( we can both read and write to it - its a full duplex )
  // The Flow:
  // 1. upgradeHttpConnection() - sends HTTP 101 response
  // 2. startWebSocketConnection(socket) - attaches event listeners
  // 3. startWebSocketConnection() TERMINATES
  // 4. Socket remains in memory - Node.js maintains internal reference
  // 5. When data arrives - callback executes automatically
  socket.on("data", (chunk: Buffer) => {
    receiver.processBuffer(chunk);
  });
  socket.on("end", () => {
    console.log("there will be no more data. The WS connection is closed.");
  });
}
