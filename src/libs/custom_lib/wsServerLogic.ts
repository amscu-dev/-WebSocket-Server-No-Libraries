import net from "node:net";

import * as CONSTANTS from "@/libs/custom_lib/constants/constants";

// define loop engine variables
const GET_INFO = 1;
// const GET_LENGTH = 2;
// const GET_MASK_KEY = 3;
// const GET_PAYLOAD = 4;
// const SEND_ECHO = 5;

class WebSocketReceiver {
  private _socket: net.Socket;
  // array containing the chunk of data received
  private _buffersArray: Buffer[] = [];
  // total bytes in our custom buffer after each chunk of data is received
  private _bufferedBytesLength: number = 0;

  private _taskLoop: boolean = false;

  private _task: number = GET_INFO;

  constructor(socket: net.Socket) {
    this._socket = socket;
  }

  public processBuffer(chunk: Buffer) {
    this._buffersArray.push(chunk);
    this._bufferedBytesLength += chunk.length;
    // start processing & parsing bytes

    this._startTaskLoop();
  }

  private _startTaskLoop() {
    // set _taskLoop to false when we are done processing data
    this._taskLoop = true;

    do {
      switch (this._task) {
        case GET_INFO:
          this._getInfo(); // first info get info about ws frame data received ( ws binary frame format )
          break;
      }
    } while (this._taskLoop);
  } // end task loop management function

  private _getInfo() {
    // consume/extract 2 first mandatory bytes
    const infoBuffer = this._consumeHeaders(
      CONSTANTS.WS_DATA_FRAME_RULES.MIN_FRAME_SIZE,
    );
    if (!infoBuffer) {
      throw Error(
        "You cannot extract more data from a ws frame than the actual size.",
      );
    }
    // parse first 2 bytes
    // const firstByte = infoBuffer[0];
    // const secondByte = infoBuffer[1];
  }

  private _consumeHeaders(n: number): Buffer | undefined {
    // reduce our bufferedBytesLength by how many bytes we will consume
    this._bufferedBytesLength -= n; // goal is to have this get to 0
    // if our extraction is the same size as actual buffer, return the entire buffer (ex ping/pong frame)
    if (n === this._buffersArray[0].length) {
      return this._buffersArray.shift();
    }

    if (n < this._buffersArray[0].length) {
      // create a temporary info buffer from the _buffersArray
      const consumed = this._buffersArray[0].subarray(0, n);
      // remove consumed bytes from our _bufferArray
      this._buffersArray[0] = this._buffersArray[0].subarray(n);

      return consumed;
    }

    // invalid data frame, contains less than 2 mandatory bytes
    if (n > this._buffersArray[0].length) {
      return undefined;
    }
  }
}

// WEBSOCKET SERVER LOGIC
// code below will relate to our custom websocket server
export default function startWebSocketConnection(socket: net.Socket) {
  console.log(
    `[ WS ] WebSocket Connection established. Client port: ${socket.remotePort}. Client IP: ${socket.remoteAddress}`,
  );

  const receiver = new WebSocketReceiver(socket);
  // socket = TCP Communication Socket ( we can both read and write to it - its a full duplex )
  socket.on("data", (chunk: Buffer) => {
    receiver.processBuffer(chunk);
  });
  socket.on("end", () => {
    console.log("there will be no more data. The WS connection is closed.");
  });
}
