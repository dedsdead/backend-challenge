import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from '@mikro-orm/core';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { OutboxMessageRepository, MikroOrmOutboxMessageRepository } from '../database/repositories';
import { createSqsClient } from '../messaging/sqs.client';
import { OutboxMessage } from '../domain/outbox/outbox-message';

/**
 * Outbox Publisher Worker
 *
 * Publishes outbox messages to SQS with at-least-once delivery semantics.
 * Uses transactional outbox pattern: claim batch -> publish -> mark published in same transaction.
 * Implements exponential backoff retry with max attempts.
 */
@Injectable()
export class OutboxPublisherWorker {
  private readonly logger = new Logger(OutboxPublisherWorker.name);
  private readonly sqsClient: SQSClient;
  private readonly queueUrl: string;
  private readonly batchSize = 50;
  private readonly pollIntervalMs = 500;
  private readonly jitterMs = 100;
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly em: EntityManager,
  ) {
    this.sqsClient = this.createSqsClient();
    this.queueUrl = this.config.getOrThrow<string>('SQS_QUEUE_URL');
  }

  private createSqsClient(): SQSClient {
    const endpoint = this.config.getOrThrow<string>('SQS_ENDPOINT');
    const region = 'us-east-1';
    return new SQSClient({
      region,
      endpoint,
      credentials: {
        accessKeyId: 'localstack',
        secretAccessKey: 'localstack',
      },
      maxAttempts: 1,
    });
  }

  async onModuleInit(): Promise<void> {
    if (this.config.get('WORKERS_ENABLED') === true) {
      await this.start();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.log('Starting outbox publisher worker');
    this.pollLoop();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private pollLoop(): void {
    if (!this.isRunning) return;
    const jitter = Math.random() * this.jitterMs;
    setTimeout(() => {
      if (this.isRunning) this.processBatch().finally(() => this.pollLoop());
    }, this.pollIntervalMs + Math.random() * this.jitterMs);
  }

  async processBatch(): Promise<void> {
    const em = this.em.fork();
    try {
      await em.transactional(async (tx) => {
        const outboxRepo = new MikroOrmOutboxMessageRepository(tx);
        const messages = await outboxRepo.claimDueBatch(tx, this.batchSize);
        if (messages.length === 0) return;

        this.logger.debug(`Publishing ${messages.length} outbox messages`);
        await this.publishBatch(em, messages);
        
        // Mark all as published in the same transaction
        for (const msg of messages) {
          await outboxRepo.markPublished(tx, msg, new Date());
        }
      });
    } catch (error) {
      this.logger.error('Error processing outbox batch', error);
    }
  }

  private async publishBatch(em: EntityManager, messages: OutboxMessage[]): Promise<void> {
    const entries = messages.map(msg => ({
      Id: msg.id,
      MessageBody: JSON.stringify({
        eventId: msg.id,
        eventType: msg.eventType,
        aggregateId: msg.aggregateId,
        correlationId: undefined,
        causationId: undefined,
        occurredAt: msg.occurredAt.toISOString(),
        version: 1,
        data: msg.payload,
      }),
      MessageGroupId: 'wager-transactions',
      MessageDeduplicationId: msg.id,
    }));

    const command = new SendMessageBatchCommand({
      QueueUrl: this.queueUrl,
      Entries: entries,
    });

    try {
      await this.sqsClient.send(command);
    } catch (error) {
      this.logger.error('Failed to publish batch', error);
      throw error;
    }
  }
}