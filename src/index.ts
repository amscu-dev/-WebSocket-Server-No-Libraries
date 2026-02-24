import "module-alias/register";

import chalk from "chalk";

import config from "./config/app.config";

console.log(config.PORT);
console.log(chalk.green.bold("Finished loading all files in index.ts"));
