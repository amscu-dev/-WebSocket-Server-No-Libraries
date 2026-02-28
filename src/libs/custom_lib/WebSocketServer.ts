import { EventEmitter } from "node:events";
import net from "node:net";

import * as CONSTANTS from "@/libs/custom_lib/constants/constants";

// define loop engine variables
const GET_INFO = 1;
const GET_LENGTH = 2;
const GET_MASK_KEY = 3;
const GET_PAYLOAD = 4;
const EMMIT_DATA = 5;

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
export default class WebSocketServer extends EventEmitter {
  /** TCP socket reference to the connected WebSocket client */
  private _socket: net.Socket;

  /**
   * Array of Buffer chunks received from TCP socket.
   * Each element represents a separate chunk from socket.on("data") event.
   * Chunks are consumed sequentially by _consume() method.
   * Example: [Buffer(50), Buffer(30), Buffer(20)] = 100 bytes total
   */
  private _buffersArray: Buffer[] = [];

  /**
   * Cumulative byte count of all buffers in _buffersArray.
   * Used to quickly check if we have enough bytes without iterating array.
   * Decremented after each _consume() call.
   * Invariant: should always equal sum of all buffer lengths
   */
  private _bufferedBytesLength: number = 0;

  /**
   * Control flag for the state machine loop iteration.
   * - true: continue executing current task in loop
   * - false: exit loop and wait for next TCP chunk via socket.on("data")
   * Set to true in _startTaskLoop(), set to false when insufficient data
   */
  private _taskLoop: boolean = false;

  /**
   * Current state in the frame parsing state machine.
   * Determines which parsing method executes in the switch statement.
   * Possible values:
   * - GET_INFO: Parse first 2 bytes (FIN, opcode, mask, length indicator)
   * - GET_LENGTH: Parse variable-length payload size field
   * - GET_MASK_KEY: Parse 4-byte XOR mask key
   * - GET_PAYLOAD: Extract and unmask actual frame payload
   * - EMMIT_DATA: Message complete, ready to send to client
   */
  private _task: number = GET_INFO;

  /**
   * FIN bit (Frame Final flag) extracted from RFC 6455 first byte (bit 0).
   * - true: this frame is the final fragment of the WebSocket message
   * - false: more fragmented frames expected for this message
   * Used to determine if we need to parse additional continuation frames
   */
  private _fin: boolean = false;

  /**
   * Opcode field extracted from RFC 6455 first byte (bits 4-7).
   * Indicates the type of frame data:
   * - 0x0: Continuation frame (follows previous fragmented frame)
   * - 0x1: Text frame (UTF-8 encoded text data)
   * - 0x2: Binary frame (raw binary data)
   * - 0x8: Connection close frame
   * - 0x9: Ping frame (keepalive request)
   * - 0xA: Pong frame (keepalive response)
   */
  private _opcode: null | number = null;

  /**
   * MASK bit extracted from RFC 6455 second byte (bit 0).
   * - true: payload is XOR-masked (required for client-to-server per spec)
   * - false: payload is unmasked (server-to-client, not allowed for clients)
   * Server must reject frames where _masked === false
   */
  private _masked: boolean = false;

  /**
   * Payload length indicator from RFC 6455 second byte (bits 1-7).
   * Variable-length encoding:
   * - 0-125: Direct length value (no extra bytes needed)
   * - 126: Next 2 bytes contain actual length as uint16 (65KB max)
   * - 127: Next 8 bytes contain actual length as uint64 (huge payloads)
   * @see RFC 6455 section 5.2 for specification details
   */
  private _initialPayloadSizeIndicator: number = 0;

  /**
   * Decoded payload length in bytes for current frame.
   * Calculated from _initialPayloadSizeIndicator:
   * - If indicator <= 125: _framePayloadLength = indicator
   * - If indicator === 126: read 2 bytes, interpret as uint16BE
   * - If indicator === 127: read 8 bytes, interpret as uint64BE
   * Used in GET_PAYLOAD state to know how many bytes to extract
   */
  private _framePayloadLength: number = 0;

  /**
   * Cumulative payload length across all frames in fragmented message.
   * Tracks total data received for multi-frame messages (FIN=0).
   * Incremented in _processLength() for each frame.
   * Used to enforce _maxPayload security limit across entire message
   */
  private _totalPayloadLength: number = 0;

  /**
   * Maximum allowed payload size in bytes (1 MiB = 1,048,576 bytes).
   * Security limit to prevent memory exhaustion and DoS attacks.
   * If _totalPayloadLength exceeds this, throw error and close connection.
   * Can be configured per instance if needed
   */
  private _maxPayload: number = 1024 * 1024;

  /**
   * 4-byte XOR mask key sent by client in every WebSocket frame.
   * Used to unmask payload data via bitwise XOR in _unmaskDataPayload().
   * Client generates random key per frame for security purposes.
   * Server must use exact same key to correctly unmask payload
   */
  private _mask: Buffer = Buffer.alloc(
    CONSTANTS.WS_DATA_FRAME_RULES.MASK_KEY_LENGTH,
  );

  /**
   * Counter of frames received and successfully parsed.
   * Incremented each time a complete frame payload is extracted.
   * Can be used for debugging, metrics, or protocol validation
   */
  private _framesReceived: number = 0;

  /**
   * Array of unmasked payload buffers from all frames in current message.
   * Stores fragments when FIN=0 (more frames coming).
   * When FIN=1, concatenate all fragments and send complete message to client.
   * Cleared after sending message to prepare for next multi-frame sequence
   */
  private _fragments: Buffer[] = [];

  /**
   * Initializes WebSocketReceiver with TCP socket reference.
   *
   * @param socket - TCP socket connected to WebSocket client.
   *                 Socket is maintained in closure and persists for
   *                 entire connection lifetime.
   */
  constructor(socket: net.Socket) {
    super();
    this._socket = socket;

    // socket = TCP Communication Socket ( we can both read and write to it - its a full duplex )
    // The Flow:
    // 1. upgradeHttpConnection() - sends HTTP 101 response
    // 2. startWebSocketConnection(socket) - attaches event listeners
    // 3. startWebSocketConnection() TERMINATES
    // 4. Socket remains in memory - Node.js maintains internal reference
    // 5. When data arrives - callback executes automatically
    this._socket.on("data", (chunk: Buffer) => {
      console.log(
        "Read another chunk of data from socket. TCP chunk length:",
        chunk.length,
      );
      this._processBuffer(chunk);
    });

    this._socket.on("end", () => {
      console.log("there will be no more data. The WS connection is closed.");
    });

    this._socket.on("error", (err) => {
      console.error("socket error:", err);
    });

    this._socket.on("close", () => {
      console.log("socket fully closed");
    });
  }

  /**
   * Processes incoming TCP chunk and initiates frame parsing state machine.
   *
   * Called by socket.on("data") event listener whenever client sends bytes.
   * Appends chunk to _buffersArray and attempts to parse available data.
   *
   * @param chunk - Buffer containing bytes received from TCP layer.
   *                May be partial frame due to TCP fragmentation.
   *
   * @example
   * socket.on("data", (chunk) => {
   *   receiver.processBuffer(chunk);
   * });
   */
  private _processBuffer(chunk: Buffer) {
    // Accumulate incoming bytes
    this._buffersArray.push(chunk);
    this._bufferedBytesLength += chunk.length;

    // Start processing & parsing bytes
    this._startTaskLoop();
  }

  /**
   * Main state machine loop for WebSocket frame parsing.
   *
   * Executes current task (_task) repeatedly until loop flag is cleared.
   * Allows incremental parsing: parse what's available, then yield control
   * back to event loop when more data needed. When next chunk arrives,
   * loop resumes from same task state.
   *
   * Flow: GET_INFO → GET_LENGTH → GET_MASK_KEY → GET_PAYLOAD → (repeat or EMMIT_DATA)
   *
   * @private
   */
  private _startTaskLoop() {
    // Set _taskLoop to false when we are done processing data;
    this._taskLoop = true;
    console.log(
      `Start TaskLoop. Current task is ${this._task} for processing current ws message.`,
    );
    do {
      switch (this._task) {
        case GET_INFO:
          this._getInfo();
          break;
        case GET_LENGTH:
          this._getLength();
          break;
        case GET_MASK_KEY:
          this._getMaskKey();
          break;
        case GET_PAYLOAD:
          this._getPayload();
          break;
        case EMMIT_DATA:
          this._emmitDataEvent();
          break;
      }
    } while (this._taskLoop);
    console.log(
      `Processed all available chunks: ${this._bufferedBytesLength} : ${this._buffersArray.length}`,
    );
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
   * Validation: ensures client sent mask bit (server requirement).
   * Transition: advances to GET_LENGTH state after successful parse.
   *
   * @private
   */
  private _getInfo() {
    // Attempt to extract 2-byte frame info header
    const infoBuffer = this._consume(
      CONSTANTS.WS_DATA_FRAME_RULES.MIN_FRAME_SIZE,
    );

    if (!infoBuffer) {
      // End current execution of the loop & wait 'data' to be fired again and load data another chunk of data into _arrayBuffer
      this._taskLoop = false; // When taskLoop will be fired again it will start directly from this step because we did not change current task;
      console.log(
        `TaskLoop is currently at task: ${this._task}. Aditional buffers need to parse data.`,
      );
      return;
    }

    const firstByte = infoBuffer[0];
    const secondByte = infoBuffer[1];

    // Extract frame metadata from header bytes
    this._fin = (firstByte & 0b10000000) === 0b10000000;
    this._opcode = firstByte & 0b00001111;
    this._masked = (secondByte & 0b10000000) === 0b10000000;
    this._initialPayloadSizeIndicator = secondByte & 0b01111111;

    // Validate: RFC 6455 requires client frames to be masked
    if (!this._masked) {
      throw new Error("Mask is not set by the client");
    }

    // Proceed to parse variable-length payload size field
    this._task = GET_LENGTH;
  }

  /**
   * Parses payload length field from WebSocket frame header.
   *
   * Uses variable-length encoding to handle payloads of any size:
   * - If indicator < 126: length is stored directly in indicator
   * - If indicator = 126: read next 2 bytes as uint16BE for length
   * - If indicator = 127: read next 8 bytes as uint64BE for length
   *
   * Gracefully handles TCP fragmentation: if required bytes unavailable,
   * stops and waits for next chunk.
   *
   * Transition: advances to GET_MASK_KEY state after parsing length.
   *
   * @private
   */
  private _getLength() {
    switch (this._initialPayloadSizeIndicator) {
      case CONSTANTS.WS_DATA_FRAME_RULES.MEDIUM_SIZE_DATA_FLAG: {
        // Payload size in range 126-65535 (encoded in next 2 bytes)
        const mediumPayloadLengthBuffer = this._consume(
          CONSTANTS.WS_DATA_FRAME_RULES.MEDIUM_SIZE_CONSUMPTION_BYTES,
        );

        // Insufficient bytes, wait for next chunk
        if (!mediumPayloadLengthBuffer) {
          this._taskLoop = false; // Exit loop, keep _task at GET_LENGTH
          console.log(
            `TaskLoop is currently at task: ${this._task}. Aditional buffers need to parse data.`,
          );
          return;
        }

        // Decode 2-byte big-endian length
        this._framePayloadLength = mediumPayloadLengthBuffer.readUInt16BE();

        // Validate against max payload limit
        this._processLength();
        break;
      }

      case CONSTANTS.WS_DATA_FRAME_RULES.LARGE_SIZE_DATA_FLAG: {
        // Payload size > 65535 (encoded in next 8 bytes)
        const largePayloadLengthBuffer = this._consume(
          CONSTANTS.WS_DATA_FRAME_RULES.LARGE_SIZE_CONSUMPTION_BYTES,
        );

        // Insufficient bytes, wait for next chunk
        if (!largePayloadLengthBuffer) {
          this._taskLoop = false; // Exit loop, keep _task at GET_LENGTH
          console.log(
            `TaskLoop is currently at task: ${this._task}. Aditional buffers need to parse data.`,
          );
          return;
        }

        // Decode 8-byte big-endian length (as bigint, then convert to number)
        this._framePayloadLength = Number(
          largePayloadLengthBuffer.readBigUInt64BE(),
        );

        // Validate against max payload limit
        this._processLength();
        break;
      }

      default: {
        // Payload size <= 125 bytes (length is already in indicator)
        this._framePayloadLength = this._initialPayloadSizeIndicator;

        // Validate against max payload limit
        this._processLength();
        break;
      }
    }
  }

  /**
   * Validates cumulative payload length and transitions to mask key parsing.
   *
   * For fragmented messages (FIN=0), accumulates length across frames.
   * Enforces security limit: rejects messages exceeding _maxPayload.
   * Throws error if limit exceeded (closes connection).
   *
   * Transition: advances to GET_MASK_KEY state.
   *
   * @private
   */
  private _processLength() {
    // For multi-frame messages, track total payload across all frames
    this._totalPayloadLength += this._framePayloadLength;

    // Security check: prevent memory exhaustion via oversized payloads
    if (this._totalPayloadLength > this._maxPayload) {
      throw new Error("Data its too large!");
    }

    // Proceed to extract 4-byte mask key
    this._task = GET_MASK_KEY;
  }

  /**
   * Parses 4-byte XOR mask key from WebSocket frame header.
   *
   * Client sends unique random mask key with every frame for security.
   * Key is used to unmask payload bytes via bitwise XOR operation.
   * Must be extracted before attempting to unmask payload data.
   *
   * Validation: throws if insufficient bytes available.
   * Transition: advances to GET_PAYLOAD state.
   *
   * @private
   */
  private _getMaskKey() {
    // Extract 4-byte mask key from header
    const maskeyHeader = this._consume(
      CONSTANTS.WS_DATA_FRAME_RULES.MASK_KEY_LENGTH,
    );

    // Insufficient bytes, wait for next chunk
    if (!maskeyHeader) {
      this._taskLoop = false; // Exit loop, keep _task at GET_MASK_KEY
      console.log(
        `TaskLoop is currently at task: ${this._task}. Aditional buffers need to parse data.`,
      );
      return;
    }

    // Store mask key for use in unmasking payload
    this._mask = maskeyHeader;

    // Proceed to extract and unmask payload data
    this._task = GET_PAYLOAD;
  }

  /**
   * Extracts masked payload data and handles frame fragmentation.
   *
   * Processes frame payload in sequence:
   * 1. Wait until full payload received (handles TCP fragmentation)
   * 2. Extract payload bytes from buffer array
   * 3. XOR-unmask payload using client's mask key
   * 4. Handle frame type (close, binary, text)
   * 5. Check FIN bit to determine next action:
   *    - FIN=0 (continuation): append to fragments, loop for next frame
   *    - FIN=1 (final): complete message, send to client
   *
   * Transition: either back to GET_INFO (FIN=0) or to EMMIT_DATA (FIN=1).
   *
   * @private
   */
  private _getPayload() {
    // Increment frame counter
    this._framesReceived++;

    // Attempt to extract payload bytes
    const frameMaskedPayloadBuffer = this._consume(this._framePayloadLength);

    // Insufficient bytes yet, wait for next chunk
    if (!frameMaskedPayloadBuffer) {
      this._taskLoop = false; // Exit loop, keep _task at GET_PAYLOAD
      console.log(
        `TaskLoop is currently at task: ${this._task}. Aditional buffers need to parse data.`,
      );
      return;
    }

    // Unmask payload using XOR with client's mask key
    const frameUnmaskedPayloadBuffer = this._unmaskDataPayload(
      frameMaskedPayloadBuffer,
      this._mask,
    );

    // *** Handle CLOSE frame
    if (this._opcode === CONSTANTS.WS_DATA_FRAME_RULES.OPCODE_CLOSE) {
      // TODO: Implement close connection logic
      return;
    }

    // *** Handle BINARY frame
    if (this._opcode === CONSTANTS.WS_DATA_FRAME_RULES.OPCODE_BINARY) {
      // TODO: Implement binary data handling
      return;
    }

    // *** Handle TEXT frame (or continuation)
    if (frameUnmaskedPayloadBuffer.length) {
      this._fragments.push(frameUnmaskedPayloadBuffer);
    }

    // Check FIN bit to determine if message is complete
    if (!this._fin) {
      // FIN=0: More frames coming, loop back to parse next frame header
      this._task = GET_INFO;
    } else {
      // FIN=1: Message complete, send all accumulated fragments to client

      this._task = EMMIT_DATA;
    }
  }

  private _emmitDataEvent() {
    const fullMessageBuffer = Buffer.concat(this._fragments);

    const payloadLength = fullMessageBuffer.length;

    this.emit("message", {
      data: fullMessageBuffer,
      length: payloadLength,
      timestamp: Date.now(),
    });

    console.log(
      "WS Message succesfully parsed (all fragments received). Echo message back to the client.",
    );
    // reset task loop as we finish to parse a full ws message
    this._reset();
  }

  public send(message: string) {
    const fullMessageBuffer = Buffer.from(message, "utf-8");

    const payloadLength = fullMessageBuffer.length;

    let additionalPayloadSizeIndicator = null;

    switch (true) {
      case payloadLength <= CONSTANTS.WS_DATA_FRAME_RULES.SMALL_DATA_SIZE:
        additionalPayloadSizeIndicator = 0;
        break;
      case payloadLength > CONSTANTS.WS_DATA_FRAME_RULES.SMALL_DATA_SIZE &&
        payloadLength <= CONSTANTS.WS_DATA_FRAME_RULES.MEDIUM_DATA_SIZE:
        additionalPayloadSizeIndicator =
          CONSTANTS.WS_DATA_FRAME_RULES.MEDIUM_SIZE_CONSUMPTION_BYTES;
        break;
      default:
        additionalPayloadSizeIndicator =
          CONSTANTS.WS_DATA_FRAME_RULES.LARGE_SIZE_CONSUMPTION_BYTES;
        break;
    }

    const frame = Buffer.alloc(
      CONSTANTS.WS_DATA_FRAME_RULES.MIN_FRAME_SIZE +
        additionalPayloadSizeIndicator +
        payloadLength,
    );

    // Construct First Byte
    const fin = 0b1; // sau 0b00000001
    const rsv1 = 0b0; // sau 0b00000000
    const rsv2 = 0x00;
    const rsv3 = 0x00;
    const opcode = CONSTANTS.WS_DATA_FRAME_RULES.OPCODE_TEXT;
    const firstByte =
      (fin << 7) | (rsv1 << 6) | (rsv2 << 5) | (rsv3 << 4) | opcode;
    frame[0] = firstByte;

    // Construct Payload Bytes Info
    // mask bit 0 for server side
    const maskBit = 0x00;

    if (payloadLength <= CONSTANTS.WS_DATA_FRAME_RULES.SMALL_DATA_SIZE) {
      // JavaScript converts numbers to binary
      // Then performs the OR operation: 0b10000000 | 0b00110010 = 0b1011001
      frame[1] = maskBit | payloadLength;
    } else if (
      payloadLength <= CONSTANTS.WS_DATA_FRAME_RULES.MEDIUM_DATA_SIZE
    ) {
      frame[1] = maskBit | CONSTANTS.WS_DATA_FRAME_RULES.MEDIUM_SIZE_DATA_FLAG;
      frame.writeUInt16BE(payloadLength, 2);
    } else {
      frame[1] = maskBit | CONSTANTS.WS_DATA_FRAME_RULES.LARGE_SIZE_DATA_FLAG;
      frame.writeBigUInt64BE(BigInt(payloadLength), 2);
    }

    // copy message into frame buffer
    const messageStartOffset =
      CONSTANTS.WS_DATA_FRAME_RULES.MIN_FRAME_SIZE +
      additionalPayloadSizeIndicator;
    fullMessageBuffer.copy(frame, messageStartOffset);

    this._socket.write(frame);
  }
  /**
   * Resets parser state after completing one WebSocket message.
   *
   * IMPORTANT: Only resets frame/message-specific state, NOT the buffer array.
   * This allows the parser to continue processing subsequent messages that may
   * have arrived in the same TCP chunk.
   *
   * Why we DON'T reset _buffersArray and _bufferedBytesLength:
   * If multiple WebSocket messages arrive in a single TCP chunk, the parser
   * consumes them one at a time using _consume(). When one message completes,
   * remaining data for the next message is still in _buffersArray. Resetting
   * these would lose that data permanently.
   *
   * Example:
   * TCP Chunk arrives: [Complete Message 1] + [Partial Message 2]
   * - Parse Message 1: _consume() extracts it from _buffersArray
   * - _buffersArray now contains only Message 2's data
   * - _reset() prepares for next message WITHOUT clearing the buffer
   * - Parser continues and processes Message 2 from remaining data
   *
   * @private
   */
  private _reset() {
    // Reset current frame/message state
    this._task = GET_INFO;
    this._fin = false;
    this._opcode = null;
    this._masked = false;
    this._initialPayloadSizeIndicator = 0;
    this._framePayloadLength = 0;
    this._totalPayloadLength = 0;
    this._framesReceived = 0;
    this._fragments = [];

    // Don`t !!!
    // this._bufferedBytesLength = 0;
    // this._buffersArray = [];
    // this._taskLoop = false;
    // DO NOT reset these - they contain data for the next message:
    // - _buffersArray (may contain partial data from next message)
    // - _bufferedBytesLength (must reflect actual buffered data)
  }

  /**
   * Extracts and removes first N bytes from accumulated buffer array.
   *
   * Handles three cases:
   * 1. Sufficient total bytes: extracts N bytes, updates bookkeeping
   * 2. Insufficient total bytes: returns undefined, waits for more data
   * 3. Buffer boundaries: correctly handles spans across multiple buffers
   *
   * When extracting:
   * - Combines partial buffers as needed
   * - Removes fully consumed buffers from array
   * - Updates _bufferedBytesLength counter
   *
   * This is the core mechanism enabling incremental parsing of fragmented
   * TCP chunks into logical WebSocket frame components.
   *
   * @param n - Number of bytes to extract
   * @returns Concatenated buffer of N bytes, or undefined if insufficient data
   *
   * @private
   */
  private _consume(n: number): Buffer | undefined {
    // Quick check: do we have enough total bytes accumulated?
    if (this._bufferedBytesLength < n) {
      return undefined; // Not enough data yet, wait for next chunk
    }

    // Allocate output buffer of exact size needed
    const payloadBuffer = Buffer.alloc(n);
    let totalBytesRead = 0;

    // Extract N bytes, possibly spanning multiple buffers in array
    while (totalBytesRead < n) {
      const buf = this._buffersArray[0];
      const bytesToRead = Math.min(n - totalBytesRead, buf.length);

      // Copy bytes from current buffer into output
      buf.copy(payloadBuffer, totalBytesRead, 0, bytesToRead);

      // Update current buffer: remove consumed bytes
      if (bytesToRead < buf.length) {
        // Partial consumption: keep remainder in array
        this._buffersArray[0] = buf.subarray(bytesToRead);
      } else {
        // Full consumption: remove buffer from array
        this._buffersArray.shift();
      }

      totalBytesRead += bytesToRead;
    }

    // Update byte counter to reflect extraction
    this._bufferedBytesLength -= n;

    return payloadBuffer;
  }

  /**
   * Unmasks frame payload using XOR with client's 4-byte mask key.
   *
   * RFC 6455 masking algorithm:
   * - Client sends mask key (4 bytes)
   * - Each payload byte at index i is XORed with mask[i mod 4]
   * - Server unmasks by XORing again (XOR is self-inverse)
   * - Result is original unmasked data
   *
   * Modifies payloadBuffer in-place (does not allocate new buffer).
   *
   * @param payloadBuffer - Masked payload bytes from WebSocket frame
   * @param maskKey - 4-byte XOR mask key from frame header
   * @returns Same buffer object, now containing unmasked data
   *
   * @private
   */
  private _unmaskDataPayload(payloadBuffer: Buffer, maskKey: Buffer) {
    // XOR each payload byte with corresponding mask byte (cycling through 4-byte key)
    for (let index = 0; index < payloadBuffer.length; index++) {
      payloadBuffer[index] =
        payloadBuffer[index] ^
        maskKey[index % CONSTANTS.WS_DATA_FRAME_RULES.MASK_KEY_LENGTH];
    }

    return payloadBuffer;
  }
}
