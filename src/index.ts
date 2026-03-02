import "module-alias/register";

import http from "node:http";
import { performance } from "node:perf_hooks";

import chalk from "chalk";

import CONFIG from "@/config/app.config";
import * as CONSTANTS from "@/libs/custom_lib/constants/constants";

import WebSocketServer from "./libs/custom_lib/WebSocketServer";
import handleProcessErrors from "./utils/handleProcessErrors";

console.log(
  chalk.green.bold("[ NODE ] Finished loading all files in index.ts"),
);

// create a HTTP wev-server object
const httpServer = http.createServer((request, response) => {
  // this is equivalent with an event listent for 'request'
  // for a request to ws:// , the following code inside of here will NOT be executed, instead the request will be passed onto the upgrade event emitter
  // if no 'upgrade' event listener, an error will be thrown
  response.writeHead(200);
  response.end("OK");
});

// start HTTP server
httpServer.listen(CONFIG.PORT, CONFIG.HOST, () => {
  console.log(
    chalk.green.bold(
      `[ NODE ] Http server started on port ${CONFIG.PORT} and host ${CONFIG.HOST}`,
    ),
  );
  console.log(
    chalk.cyan(
      `[ PERF ] App became ready in ${performance.now().toFixed(2)} ms since process start`,
    ),
  );
});

// handle inital http handshake in order to establish a ws connection
// Docs: https://nodejs.org/docs/latest/api/http.html#event-upgrade_1

const ws = new WebSocketServer({ httpServer });

ws.on("connection", (connection) => {
  connection.on(
    "message",
    (message: {
      data: Buffer<ArrayBuffer>;
      length: number;
      timestamp: number;
    }) => {
      console.log(
        "📨 Message:",
        message.data.length > 20
          ? message.data.slice(0, 20) + "..."
          : message.data.toString(),
      );
      connection.send("Message received!");
    },
  );

  connection.on("close", (closureEvent: { code: number; reason: string }) => {
    console.log("=== Webconnection Connection Closed ===");
    console.log(closureEvent);
  });
});

// implement basic error handling
CONSTANTS.CUSTOM_ERRORS.forEach((errorEvent: string) => {
  process.on(errorEvent, (err: unknown) => {
    handleProcessErrors(err, errorEvent);
  });
});

// end of current top-level bootstrap
process.nextTick(() => {
  console.log(
    chalk.cyan(
      `[ PERF ] Synchronous bootstrap finished in ${performance.now().toFixed(2)} ms`,
    ),
  );
});

// setInterval(() => {
//   const used = process.memoryUsage();
//   const memory = used.heapUsed / 1024 / 1024;
//   console.log(`Heap: ${memory.toFixed(4)} MB`);
// }, 1000);
