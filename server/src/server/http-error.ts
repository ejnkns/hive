// An error carrying an HTTP status code, thrown by the flow registry so routes
// map failures to status codes without re-parsing message text.
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}
