// src/chat/chat.module.ts
import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { AgentService } from '../agents/agent.service';

@Module({
  controllers: [ChatController],
  providers: [AgentService],   // ✅ Properly registered as NestJS provider
  exports: [AgentService],
})
export class ChatModule {}