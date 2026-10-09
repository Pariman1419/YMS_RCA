import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private logger = new Logger('ApiError');
  catch(error: unknown, host: ArgumentsHost) {
    const { id } = host.switchToHttp().getRequest();
    const response = host.switchToHttp().getResponse();
    let status = 500,
      message: unknown = 'Unexpected service error';
    if (error instanceof HttpException) {
      status = error.getStatus();
      message = error.getResponse();
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        status = 409;
        message = 'Record already exists';
      }
      if (error.code === 'P2025') {
        status = 404;
        message = 'Record not found';
      }
    }
    if (status === 500)
      this.logger.error(
        JSON.stringify({ requestId: id, error: error instanceof Error ? error.name : 'UnknownError' }),
      );
    response
      .status(status)
      .json(
        typeof message === 'object'
          ? { ...(message as object), requestId: id }
          : { statusCode: status, message, requestId: id },
      );
  }
}
