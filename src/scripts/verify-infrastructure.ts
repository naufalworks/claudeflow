#!/usr/bin/env node
/**
 * Infrastructure Verification Script
 * Tests connections to Qdrant, Redis, Voyage AI, and Anthropic API
 */

import { config as dotenvConfig } from 'dotenv';
import { QdrantClient } from '@qdrant/js-client-rest';
import Redis from 'ioredis';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';

dotenvConfig();

interface VerificationResult {
  service: string;
  status: 'success' | 'failed';
  message: string;
  details?: unknown;
}

async function verifyQdrant(): Promise<VerificationResult> {
  try {
    const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
    const client = new QdrantClient({ url: qdrantUrl });
    
    // Test connection by getting collections
    const collections = await client.getCollections();
    
    return {
      service: 'Qdrant',
      status: 'success',
      message: `Connected to Qdrant at ${qdrantUrl}`,
      details: { collectionsCount: collections.collections.length },
    };
  } catch (error) {
    return {
      service: 'Qdrant',
      status: 'failed',
      message: 'Failed to connect to Qdrant',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

async function verifyRedis(): Promise<VerificationResult> {
  try {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const client = new Redis(redisUrl);
    
    // Test connection with PING
    const pong = await client.ping();
    
    // Get info
    const info = await client.info('server');
    const version = info.match(/redis_version:([^\r\n]+)/)?.[1] || 'unknown';
    
    await client.disconnect();
    
    return {
      service: 'Redis',
      status: 'success',
      message: `Connected to Redis at ${redisUrl}`,
      details: { ping: pong, version },
    };
  } catch (error) {
    return {
      service: 'Redis',
      status: 'failed',
      message: 'Failed to connect to Redis',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

async function verifyVoyageAI(): Promise<VerificationResult> {
  try {
    const apiKey = process.env.VOYAGE_API_KEY;
    
    if (!apiKey) {
      return {
        service: 'Voyage AI',
        status: 'failed',
        message: 'VOYAGE_API_KEY not set in environment',
      };
    }
    
    // Test with a simple embedding request
    const response = await axios.post(
      'https://api.voyageai.com/v1/embeddings',
      {
        input: ['test'],
        model: 'voyage-2',
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    return {
      service: 'Voyage AI',
      status: 'success',
      message: 'Connected to Voyage AI API',
      details: { 
        model: response.data.model,
        embeddingDimension: response.data.data[0].embedding.length,
      },
    };
  } catch (error) {
    return {
      service: 'Voyage AI',
      status: 'failed',
      message: 'Failed to connect to Voyage AI',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

async function verifyAnthropic(): Promise<VerificationResult> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY_1;
    
    if (!apiKey) {
      return {
        service: 'Anthropic',
        status: 'failed',
        message: 'ANTHROPIC_API_KEY_1 not set in environment',
      };
    }
    
    const client = new Anthropic({ apiKey });
    
    // Test with a simple message request
    const message = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 10,
      messages: [
        {
          role: 'user',
          content: 'Say "test"',
        },
      ],
    });
    
    return {
      service: 'Anthropic',
      status: 'success',
      message: 'Connected to Anthropic API',
      details: {
        model: message.model,
        usage: message.usage,
      },
    };
  } catch (error) {
    return {
      service: 'Anthropic',
      status: 'failed',
      message: 'Failed to connect to Anthropic API',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  console.log('🔍 Verifying Infrastructure Connections...\n');
  
  const results: VerificationResult[] = [];
  
  // Run all verifications
  console.log('Testing Qdrant...');
  results.push(await verifyQdrant());
  
  console.log('Testing Redis...');
  results.push(await verifyRedis());
  
  console.log('Testing Voyage AI...');
  results.push(await verifyVoyageAI());
  
  console.log('Testing Anthropic...');
  results.push(await verifyAnthropic());
  
  // Print results
  console.log('\n' + '='.repeat(60));
  console.log('VERIFICATION RESULTS');
  console.log('='.repeat(60) + '\n');
  
  let allPassed = true;
  
  for (const result of results) {
    const icon = result.status === 'success' ? '✅' : '❌';
    console.log(`${icon} ${result.service}: ${result.message}`);
    
    if (result.details) {
      console.log(`   Details: ${JSON.stringify(result.details, null, 2)}`);
    }
    
    if (result.status === 'failed') {
      allPassed = false;
    }
    
    console.log('');
  }
  
  console.log('='.repeat(60));
  
  if (allPassed) {
    console.log('✅ All infrastructure services verified successfully!');
    process.exit(0);
  } else {
    console.log('❌ Some infrastructure services failed verification.');
    console.log('Please check the error messages above and fix the issues.');
    process.exit(1);
  }
}

main();
