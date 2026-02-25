import "module-alias/register";

import http from "node:http";
import { performance } from "node:perf_hooks";

import chalk from "chalk";

import CONFIG from "@/config/app.config";
import * as CONSTANTS from "@/libs/custom_lib/websocket.constants";

import handleProcessErrors from "./utils/handleProcessErrors";

console.log(
  chalk.green.bold("[ NODE ] Finished loading all files in index.ts"),
);

// create a HTTP wev-server object
const httpServer = http.createServer((request, response) => {
  // for a request to ws:// , the followind code inside of here will NOT be executed, instead the request will be passed onto the upgrade event emitter
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
