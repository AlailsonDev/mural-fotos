export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'error',
  ) {
    super(message);
  }
}

export const notFound = (what = 'Recurso') => new AppError(404, `${what} não encontrado.`, 'not_found');
export const conflict = (msg: string, code = 'conflict') => new AppError(409, msg, code);
export const badRequest = (msg: string, code = 'bad_request') => new AppError(400, msg, code);
