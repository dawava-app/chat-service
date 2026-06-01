import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Request } from 'express';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './gateway/adapters/redis-io.adapter';

function normalizeForwardedPrefix(prefix: string | string[] | undefined): string {
  const rawPrefix = Array.isArray(prefix) ? prefix[0] : prefix;

  if (!rawPrefix) {
    return '/';
  }

  const normalizedPrefix = rawPrefix.split(',')[0].trim().replace(/^\/+|\/+$/g, '');
  return normalizedPrefix ? `/${normalizedPrefix}` : '/';
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const configService = app.get(ConfigService);
  const logger = app.get(Logger);

  const redisUrl = configService.getOrThrow<string>('redis.url');
  const wsAdapter = new RedisIoAdapter(app, redisUrl);
  await wsAdapter.connectToRedis();
  app.useWebSocketAdapter(wsAdapter);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Chat Service API')
    .setDescription('REST API for the chat microservice')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDocument, {
    patchDocumentOnRequest: (req, _res, document) => {
      const forwardedPrefix = (req as Request).headers['x-forwarded-prefix'];

      return {
        ...document,
        servers: [{ url: normalizeForwardedPrefix(forwardedPrefix) }],
      };
    },
  });

  // CORS Configuration
  const allowedOrigins = configService.get<string[]>('cors.origins') ?? [];
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const port = configService.get<number>('app.port') ?? 3000;
  const wsPort = configService.get<number>('app.wsPort') ?? 3001;
  await app.listen(port, '0.0.0.0');

  logger.log(`🚀 REST API running on: http://localhost:${port}`);
  logger.log(`📋 Health check: http://localhost:${port}/health`);
  logger.log(`🧩 WebSocket running on: ws://localhost:${wsPort}`);
  logger.log(`🔒 CORS enabled for: ${allowedOrigins.join(', ') || '*'}`);
}
void bootstrap();
