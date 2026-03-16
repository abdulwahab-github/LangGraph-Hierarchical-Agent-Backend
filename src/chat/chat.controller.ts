// src/chat/chat.controller.ts
import {
  Controller,
  Post,
  Body,
  Res,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';   // ✅ 'import type' fixes isolatedModules error
import { AgentService } from '../agents/agent.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly agentService: AgentService) {}

  /**
   * POST /chat
   *
   * - Accept: text/event-stream  → SSE streaming, yields chunks as nodes complete
   * - Accept: application/json   → waits for full result, returns JSON
   *
   * Chunk schema: { answer: string, data: object[] }
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async chat(
    @Body() body: { query: string },
    @Headers('accept') accept: string,
    @Res() res: Response,
  ): Promise<void> {
    const { query } = body;

    if (accept?.includes('text/event-stream')) {
      // ── Streaming mode (Server-Sent Events) ────────────────────────────────
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.flushHeaders();

      try {
        for await (const chunk of this.agentService.stream(query)) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        res.write('data: [DONE]\n\n');
      } catch (err) {
        res.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`);
      } finally {
        res.end();
      }
    } else {
      // ── Regular JSON response ───────────────────────────────────────────────
      try {
        const result = await this.agentService.runFull(query);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    }
  }
}