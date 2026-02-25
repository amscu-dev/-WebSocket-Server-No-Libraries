import "module-alias/register";

import http from "node:http";
import { performance } from "node:perf_hooks";

import chalk from "chalk";

import CONFIG from "@/config/app.config";
import * as CONSTANTS from "@/libs/custom_lib/constants/constants";

import sendUpgradeErrorResponse from "./libs/custom_lib/sendUpgradeErrorResponse";
import UpgradeValidatorFactory from "./libs/custom_lib/validateHttpHandshake";
import handleProcessErrors from "./utils/handleProcessErrors";

console.log(
  chalk.green.bold("[ NODE ] Finished loading all files in index.ts"),
);

const upgradeValidator = UpgradeValidatorFactory.createValidator(
  CONSTANTS.upgradeConfig,
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
httpServer.on("upgrade", (request, socket, _head) => {
  // Parsing required client request headers in conformity with https://www.rfc-editor.org/rfc/rfc6455.html#section-4.1
  const validationResult = upgradeValidator.validate(request);
  // https://www.rfc-editor.org/rfc/rfc6455.html#section-4.2.1
  if (!validationResult.isValid) {
    sendUpgradeErrorResponse(
      socket,
      400,
      "The HTTP headers do not comply with the RFC6455 spec.",
    );
    return;
  }
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
