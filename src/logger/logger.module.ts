import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppConfigModule } from '../config/config.module';

@Global()
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const nodeEnv = configService.get<string>('app.nodeEnv') ?? 'development';
        const isProduction = nodeEnv === 'production';
        const level = configService.get<string>('logger.level') ?? (isProduction ? 'info' : 'debug');

        return {
          pinoHttp: {
            level,
            transport: !isProduction
              ? {
                  target: 'pino-pretty',
                  options: {
                    colorize: true,
                    translateTime: 'HH:MM:ss.l',
                    ignore: 'pid,hostname',
                    singleLine: true,
                  },
                }
              : undefined,
            redact: {
              paths: ['req.headers.authorization', 'req.headers.x-service-token'],
              remove: true,
            },
            autoLogging: {
              ignore: (req: IncomingMessage) => req.url === '/health',
            },
            quietReqLogger: true,
            serializers: {
              req: (req: IncomingMessage & { id?: string | number }) => ({
                id: req.id,
                method: req.method,
                url: req.url,
              }),
              res: (res: ServerResponse) => ({
                statusCode: res.statusCode,
              }),
            },
            customSuccessMessage: (req: IncomingMessage, res: ServerResponse) =>
              `${req.method} ${req.url} ${res.statusCode}`,
            customErrorMessage: (req: IncomingMessage, res: ServerResponse) =>
              `${req.method} ${req.url} ${res.statusCode}`,
            customProps: () => ({
              context: 'HTTP',
            }),
          },
        };
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class AppLoggerModule {}
