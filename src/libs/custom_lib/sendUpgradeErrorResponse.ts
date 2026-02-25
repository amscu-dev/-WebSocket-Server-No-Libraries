import { Duplex } from "node:stream";

function sendUpgradeErrorResponse(
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

export default sendUpgradeErrorResponse;
