export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retry?: number,
  ) {
    super(message);
  }
}
export function fail(
  status: number,
  code: string,
  text: string,
  retry?: number,
): never {
  throw new HttpError(status, code, text, retry);
}
