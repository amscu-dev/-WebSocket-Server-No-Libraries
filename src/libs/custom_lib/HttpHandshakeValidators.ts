import http from "node:http";

import { UpgradeConfig } from "./constants/constants";

interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface RequestValidator {
  validate(request: http.IncomingMessage): ValidationResult;
}

class UpgradeHeaderValidator implements RequestValidator {
  constructor(private expectedValue: string) {}

  validate(request: http.IncomingMessage): ValidationResult {
    const headerValue = request.headers["upgrade"]?.toLowerCase() || "";

    return {
      isValid: headerValue === this.expectedValue.toLowerCase(),
      errors:
        headerValue !== this.expectedValue.toLowerCase()
          ? [
              `Invalid "upgrade" header. Expected: ${this.expectedValue}, Got: ${headerValue}`,
            ]
          : [],
    };
  }
}

class ConnectionHeaderValidator implements RequestValidator {
  constructor(private expectedValue: string) {}

  validate(request: http.IncomingMessage): ValidationResult {
    const headerValue = request.headers["connection"]?.toLowerCase() || "";

    return {
      isValid: headerValue === this.expectedValue.toLowerCase(),
      errors:
        headerValue !== this.expectedValue.toLowerCase()
          ? [
              `Invalid "connection" header. Expected: ${this.expectedValue}, Got: ${headerValue}`,
            ]
          : [],
    };
  }
}

class MethodValidator implements RequestValidator {
  constructor(private expectedMethod: string) {}

  validate(request: http.IncomingMessage): ValidationResult {
    const isValid = request.method === this.expectedMethod;

    return {
      isValid,
      errors: !isValid
        ? [
            `Invalid HTTP method. Expected: ${this.expectedMethod}, Got: ${request.method}`,
          ]
        : [],
    };
  }
}

class OriginValidator implements RequestValidator {
  constructor(private allowedOrigins: string[]) {}

  validate(request: http.IncomingMessage): ValidationResult {
    const origin = request.headers["origin"] || "";
    const isValid = this.allowedOrigins.includes(origin);

    return {
      isValid,
      errors: !isValid ? [`Origin "${origin}" is not allowed`] : [],
    };
  }
}

class SecWebSocketKeyValidator implements RequestValidator {
  validate(request: http.IncomingMessage): ValidationResult {
    const secKey = request.headers["sec-websocket-key"];
    const isValid =
      secKey !== undefined &&
      secKey.length === 24 &&
      /^[A-Za-z0-9+/=]+$/.test(secKey);

    return {
      isValid,
      errors: !isValid ? [`Missing or invalid "Sec-WebSocket-Key" header`] : [],
    };
  }
}

class SecWebSocketVersionValidator implements RequestValidator {
  private supportedVersions: number[];

  constructor(supportedVersions: number[] = [13]) {
    this.supportedVersions = supportedVersions;
  }

  validate(request: http.IncomingMessage): ValidationResult {
    const version = request.headers["sec-websocket-version"];
    const isValid =
      version !== undefined &&
      this.supportedVersions.includes(parseInt(version as string, 10));

    return {
      isValid,
      errors: !isValid
        ? [
            `Unsupported WebSocket version. Required: ${this.supportedVersions.join(", ")}, Got: ${version}`,
          ]
        : [],
    };
  }
}

class CompositeRequestValidator implements RequestValidator {
  private validators: RequestValidator[] = [];

  addValidator(validator: RequestValidator): this {
    this.validators.push(validator);
    return this;
  }

  validate(request: http.IncomingMessage): ValidationResult {
    const allErrors: string[] = [];

    for (const validator of this.validators) {
      const result = validator.validate(request);
      if (!result.isValid) {
        allErrors.push(...result.errors);
      }
    }

    return {
      isValid: allErrors.length === 0,
      errors: allErrors,
    };
  }
}

export class UpgradeValidatorFactory {
  static createValidator(config: UpgradeConfig): RequestValidator {
    const validator = new CompositeRequestValidator();

    validator
      .addValidator(new UpgradeHeaderValidator(config.upgradeHeader))
      .addValidator(new ConnectionHeaderValidator(config.connectionHeader))
      .addValidator(new MethodValidator(config.method))
      .addValidator(new OriginValidator(config.allowedOrigins))
      .addValidator(new SecWebSocketKeyValidator())
      .addValidator(new SecWebSocketVersionValidator([13]));

    return validator;
  }
}
