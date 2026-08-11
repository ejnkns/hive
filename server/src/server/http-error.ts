// An error carrying an HTTP status code, thrown by the flow registry so routes
// map failures to status codes without re-parsing message text.
export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
}
