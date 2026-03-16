// src/agents/agent.service.ts
import { Injectable } from '@nestjs/common';
import { DelegatingAgent, StreamChunk } from './delegating.agent';

@Injectable()
export class AgentService {
  private readonly agent = new DelegatingAgent();

  /**
   * Returns an async generator that yields StreamChunk objects.
   * Used by the controller to pipe chunks to the HTTP response.
   */
  stream(query: string): AsyncGenerator<StreamChunk> {
    return this.agent.run(query);
  }

  /**
   * Collects all chunks and returns the final result.
   * Convenient for clients that don't need streaming.
   */
  async runFull(query: string): Promise<StreamChunk> {
    return this.agent.runFull(query);
  }
}