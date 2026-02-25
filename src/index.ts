import "module-alias/register";

import http from "node:http";

import chalk from "chalk";

import CONFIG from "@/config/app.config";

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
});
