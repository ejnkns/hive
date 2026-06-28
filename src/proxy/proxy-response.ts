import { PassThrough, Readable } from "node:stream";
import { normalizeError, type NormalizedError } from "./error-normalizer";

const MAX_ERROR_BODY = 10_000;

export class ProxyResponse {
  readonly status: number;
  private readonly body: Readable;
  private bodyConsumed = false;
  private cachedBody: string | null = null;
  private cachedNormalizedError: NormalizedError | null = null;

  constructor(status: number, body: Readable) {
    this.status = status;
    this.body = body;
  }

  static ok(status: number, stream: PassThrough): ProxyResponse {
    return new ProxyResponse(status, stream);
  }

  static error(status: number, errorBody: string): ProxyResponse {
    const truncated =
      errorBody.length > MAX_ERROR_BODY
        ? errorBody.slice(0, MAX_ERROR_BODY)
        : errorBody;
    const stream = new Readable({
      read() {
        this.push(truncated);
        this.push(null);
      },
    });
    const response = new ProxyResponse(status, stream);
    response.cachedBody = truncated;
    response.cachedNormalizedError = normalizeError(status, truncated);
    return response;
  }

  isOk(): boolean {
    return this.status >= 200 && this.status < 400;
  }

  async getBodyAsString(): Promise<string> {
    if (this.cachedBody !== null) return this.cachedBody;
    if (this.bodyConsumed) {
      throw new Error("Body stream already consumed");
    }
    this.bodyConsumed = true;
    const chunks: Buffer[] = [];
    for await (const chunk of this.body) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    this.cachedBody = Buffer.concat(chunks).toString("utf-8");
    return this.cachedBody;
  }

  getStream(): Readable {
    if (this.bodyConsumed) {
      throw new Error("Body stream already consumed");
    }
    this.bodyConsumed = true;
    return this.body;
  }

  async getNormalizedError(): Promise<NormalizedError> {
    if (this.cachedNormalizedError !== null) return this.cachedNormalizedError;
    if (this.cachedBody !== null) {
      this.cachedNormalizedError = normalizeError(this.status, this.cachedBody);
      return this.cachedNormalizedError;
    }
    const body = await this.getBodyAsString();
    this.cachedNormalizedError = normalizeError(this.status, body);
    return this.cachedNormalizedError;
  }

  getNormalizedErrorSync(): NormalizedError | null {
    return this.cachedNormalizedError;
  }
}
