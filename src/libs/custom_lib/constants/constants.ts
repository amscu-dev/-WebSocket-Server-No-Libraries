export const CUSTOM_ERRORS: string[] = [
  "uncaughtException",
  "SIGINT",
  "unhandledRejection",
];
export interface UpgradeConfig {
  allowedOrigins: string[];
  upgradeHeader: string;
  connectionHeader: string;
  method: string;
}
// upgrade checks
export const upgradeConfig: UpgradeConfig = {
  upgradeHeader: "websocket",
  connectionHeader: "upgrade",
  method: "GET",
  allowedOrigins: ["http://127.0.0.1:5500", "http://localhost:5500"],
};
