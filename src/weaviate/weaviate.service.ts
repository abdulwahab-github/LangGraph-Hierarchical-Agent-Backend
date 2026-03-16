// src/weaviate/weaviate.service.ts
import weaviate from 'weaviate-ts-client';
import * as dotenv from 'dotenv';
dotenv.config();



export const client = weaviate.client({
  scheme: process.env.WEAVIATE_SCHEME || 'http',
  host: process.env.WEAVIATE_HOST || 'localhost:8080',
});