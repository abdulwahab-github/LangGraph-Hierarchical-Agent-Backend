// src/main.ts
import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config(); // ✅ Must be FIRST — loads GEMINI_API_KEY before any class is instantiated

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  await app.listen(process.env.PORT ?? 3000);
  console.log(`🚀 Server running on http://localhost:${process.env.PORT ?? 3000}`);
}
bootstrap();