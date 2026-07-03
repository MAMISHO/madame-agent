import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { AppModule } from './app.module';
import * as globalAgent from 'global-agent';
(globalAgent as any).bootstrap();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(json({ limit: '10mb' }));
  app.enableCors();
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
