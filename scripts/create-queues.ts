#!/usr/bin/env bun
/**
 * Queue Setup Script
 *
 * Creates the required SQS queues (wager-transactions.fifo and wager-transactions-dlq.fifo)
 * with the correct configuration for the wagering processor.
 *
 * This script is idempotent - running it multiple times is safe.
 *
 * Usage: bun run queue:setup
 */

import { SQSClient, CreateQueueCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import { createSqsClient } from '../src/messaging/sqs.client';
import 'reflect-metadata';

const MAIN_QUEUE = 'wager-transactions.fifo';
const DLQ_QUEUE = 'wager-transactions-dlq.fifo';
const MAX_RECEIVE_COUNT = 5;
const ACCOUNT_ID = '000000000000';

async function queueExists(client: SQSClient, queueName: string): Promise<boolean> {
  try {
    const endpoint = process.env.SQS_ENDPOINT ?? 'http://localhost:4566';
    const queueUrl = `${endpoint}/${ACCOUNT_ID}/${queueName}`;
    await client.send(new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ['QueueArn'],
    }));
    return true;
  } catch {
    return false;
  }
}

async function createQueue(
  client: SQSClient,
  queueName: string,
  isFifo: boolean = true,
  redrivePolicy?: { deadLetterTargetArn: string; maxReceiveCount: number },
): Promise<string> {
  const attributes: Record<string, string> = {};

  if (isFifo) {
    attributes.FifoQueue = 'true';
    attributes.ContentBasedDeduplication = 'false'; // We use explicit message deduplication IDs
  }

  if (redrivePolicy) {
    attributes.RedrivePolicy = JSON.stringify(redrivePolicy);
  }

  const command = new CreateQueueCommand({
    QueueName: queueName,
    Attributes: attributes,
  });

  const response = await client.send(command);
  return response.QueueUrl ?? '';
}

async function getQueueArn(client: SQSClient, queueName: string): Promise<string> {
  const endpoint = process.env.SQS_ENDPOINT ?? 'http://localhost:4566';
  const queueUrl = `${endpoint}/${ACCOUNT_ID}/${queueName}`;
  const response = await client.send(new GetQueueAttributesCommand({
    QueueUrl: queueUrl,
    AttributeNames: ['QueueArn'],
  }));
  return response.Attributes?.QueueArn ?? '';
}

async function main(): Promise<void> {
  // Load environment variables
  const config = new ConfigService();

  // Allow override via environment for local development
  const sqsEndpoint = process.env.SQS_ENDPOINT ?? config.get('SQS_ENDPOINT') ?? 'http://localhost:4566';

  console.log(`[queue:setup] Using SQS endpoint: ${sqsEndpoint}`);

  const client = new SQSClient({
    region: config.get('AWS_REGION') ?? 'us-east-1',
    endpoint: sqsEndpoint,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? config.get('AWS_ACCESS_KEY_ID') ?? 'localstack',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? config.get('AWS_SECRET_ACCESS_KEY') ?? 'localstack',
    },
    maxAttempts: 1,
  });

  try {
    // Create DLQ first (no redrive policy)
    const dlqExists = await queueExists(client, DLQ_QUEUE);
    if (!dlqExists) {
      console.log(`[queue:setup] Creating DLQ: ${DLQ_QUEUE}`);
      await createQueue(client, DLQ_QUEUE, true);
      console.log(`[queue:setup] Created DLQ: ${DLQ_QUEUE}`);
    } else {
      console.log(`[queue:setup] DLQ already exists: ${DLQ_QUEUE}`);
    }

    // Get DLQ ARN for redrive policy
    const dlqUrl = `${sqsEndpoint}/${ACCOUNT_ID}/${DLQ_QUEUE}`;
    const dlqArn = await getQueueArn(client, DLQ_QUEUE);

    // Create main queue with redrive policy to DLQ
    const mainExists = await queueExists(client, MAIN_QUEUE);
    if (!mainExists) {
      console.log(`[queue:setup] Creating main queue: ${MAIN_QUEUE}`);
      await createQueue(client, MAIN_QUEUE, true, {
        deadLetterTargetArn: dlqArn,
        maxReceiveCount: MAX_RECEIVE_COUNT,
      });
      console.log(`[queue:setup] Created main queue: ${MAIN_QUEUE} with redrive to DLQ (maxReceiveCount=${MAX_RECEIVE_COUNT})`);
    } else {
      console.log(`[queue:setup] Main queue already exists: ${MAIN_QUEUE}`);
    }

    console.log('[queue:setup] Queue setup completed successfully');
  } catch (error) {
    console.error('[queue:setup] Failed to set up queues:', error);
    process.exit(1);
  } finally {
    client.destroy();
  }
}

main();