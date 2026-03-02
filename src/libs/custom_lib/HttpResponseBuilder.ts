export default class HttpResponseBuilder {
  private statusCode: number = 101;
  private statusText: string = "Switching Protocols";
  private headers: Record<string, string>;

  constructor(headers: Record<string, string>) {
    this.headers = headers;
  }

  setStatus(code: number, text: string): this {
    this.statusCode = code;
    this.statusText = text;
    return this;
  }

  addHeader(name: string, value: string): this {
    this.headers[name] = value;
    return this;
  }

  build(): string {
    const statusLine = `HTTP/1.1 ${this.statusCode} ${this.statusText}\r\n`;
    const headerLines = Object.entries(this.headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\r\n");

    return statusLine + headerLines + "\r\n\r\n";
  }
}
