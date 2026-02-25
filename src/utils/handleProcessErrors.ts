import chalk from "chalk";

const handleProcessErrors = (err: unknown, errorEvent: string): void => {
  console.error("\n");
  console.error(chalk.bgRed.white.bold("[ NODE ]  ERROR "));
  console.error(chalk.red.bold(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
  console.error(chalk.yellow(`Event: ${errorEvent}`));

  if (err instanceof Error) {
    console.error(chalk.red(`Message: ${err.message}`));
    console.error(chalk.red.bold("\n Stack trace:"));
    console.error(chalk.dim(err.stack)); // Stack pe linii separate
  } else {
    console.error(chalk.red(`Error: ${JSON.stringify(err, null, 2)}`));
  }

  console.error(chalk.red.bold(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`));
  process.exit(1);
};

export default handleProcessErrors;
