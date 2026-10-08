import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, SendMessageCommand, Message } from '@aws-sdk/client-sqs';
import { SubmitTransactionUseCase, SubmitTransactionCommand } from '../modules/wagering/submit-transaction.use-case';
import { IdempotencyConflictError, ValidationError } from '../domain/errors';
import { WagerTransactionKind } from '../domain/enums';
import { createSqsClient } from './sqs.client';

interface SqsMessageEnvelope {
  messageId: string;
  type: string;
  occurredAt: string;
  data: {
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: string;
    money: { amount: string; currency: string };
    referenceExternalTransactionId?: string;
  };
}

/**
 * SQS Consumer for wager transaction messages.
 *
 * Implements the inbox pattern for exactly-once processing:
 * - Long-polls SQS for messages
 * - Validates message envelope
 * - Delegates to SubmitTransactionUseCase with SQS ingress context
 * - Only deletes message after successful commit (business REJECTED counts as commit)
 * - Permanent failures (invalid schema, OPENING kind) are deleted immediately → DLQ via redrive
 * - Transient errors are not deleted → visibility timeout redelivery
 */
@Injectable()
export class WagerTransactionConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WagerTransactionConsumer.name);
  private readonly consumerName = 'wager-transaction-consumer';
  private sqsClient!: SQSClient;
  private queueUrl!: string;
  private isRunning = false;
  private pollInterval?: NodeJS.Timeout;
  private readonly pollIntervalMs = 1000; // Check for shutdown every 1 second
  private inFlightCount = 0;
  private readonly maxInFlight = 10;

  constructor(
    private readonly config: ConfigService,
    private readonly useCase: SubmitTransactionUseCase,
  ) {}

  async onModuleInit(): Promise<void> {
    // SQS client will be created lazily when start() is called
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  /**
   * Starts the consumer polling loop.
   * Called by the messaging module onApplicationBootstrap.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Consumer already running');
      return;
    }

    this.sqsClient = createSqsClient(this.config);
    // Use the full queue URL from config (includes account ID for LocalStack)
    this.queueUrl = this.config.getOrThrow<string>('SQS_QUEUE_URL');

    this.isRunning = true;
    this.logger.log(`Starting SQS consumer on queue: ${this.queueUrl}`);
    this.pollLoop();
  }

  /**
   * Stops the consumer gracefully.
   * Waits for in-flight messages to complete (bounded by 25s).
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.log('Stopping SQS consumer...');
    this.isRunning = false;

    // Clear the polling interval
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }

    // Wait for in-flight messages to complete (max 25 seconds)
    const timeoutMs = 25_000;
    const startTime = Date.now();
    while (this.inFlightCount > 0 && Date.now() - startTime < timeoutMs) {
      this.logger.debug(`Waiting for ${this.inFlightCount} in-flight messages to complete...`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (this.inFlightCount > 0) {
      this.logger.warn(`${this.inFlightCount} messages still in-flight after shutdown timeout`);
    }

    this.sqsClient.destroy();
    this.logger.log('SQS consumer stopped');
  }

  /**
   * Main polling loop.
   * Uses long-polling (WaitTimeSeconds: 20) with MaxMessages: 10.
   */
  private pollLoop(): void {
    if (!this.isRunning) return;

    // Limit concurrency
    if (this.inFlightCount >= this.maxInFlight) {
      setTimeout(() => this.pollLoop(), this.pollIntervalMs);
      return;
    }

    this.receiveAndProcess()
      .catch((error) => {
        this.logger.error('Unexpected error in poll loop', error);
      })
      .finally(() => {
        if (this.isRunning) {
          setTimeout(() => this.pollLoop(), this.pollIntervalMs);
        }
      });
  }

  /**
   * Receives messages from SQS and processes them.
   */
  private async receiveAndProcess(): Promise<void> {
    this.inFlightCount++;

    try {
      const response = await this.sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20, // Long polling
          VisibilityTimeout: 30, // 30 seconds to process before redelivery
          MessageAttributeNames: ['All'],
        }),
      );

      const messages = response.Messages ?? [];
      if (messages.length === 0) {
        return;
      }

      this.logger.debug(`Received ${messages.length} message(s) from SQS`);

      // Process messages sequentially to maintain ordering per wallet
      for (const message of messages) {
        if (!this.isRunning) break;
        await this.processMessage(message);
      }
    } catch (error) {
      this.logger.error('Error receiving messages from SQS', error);
      // On transient SQS errors, don't delete messages - they'll be redelivered
    } finally {
      this.inFlightCount--;
    }
  }

  /**
   * Processes a single SQS message.
   * Implements the inbox pattern for exactly-once processing.
   */
  private async processMessage(message: Message): Promise<void> {
    const messageId = message.MessageId ?? 'unknown';
    const receiptHandle = message.ReceiptHandle;
    const correlationId = message.MessageAttributes?.correlationId?.StringValue;

    this.logger.debug(`Processing message ${messageId}`, { correlationId });

    try {
      // Parse and validate message envelope
      const envelope = this.parseAndValidateEnvelope(message);

      // Build submit command
      const command: SubmitTransactionCommand = {
        providerId: envelope.data.providerId,
        externalTransactionId: envelope.data.externalTransactionId,
        walletId: envelope.data.walletId,
        playerId: envelope.data.playerId,
        roundId: envelope.data.roundId,
        gameId: envelope.data.gameId,
        kind: envelope.data.kind as WagerTransactionKind,
        amount: envelope.data.money.amount,
        currency: envelope.data.money.currency,
        referenceExternalTransactionId: envelope.data.referenceExternalTransactionId,
        idempotencyKey: envelope.data.idempotencyKey,
        ingress: {
          kind: 'sqs',
          messageId,
          consumerName: this.consumerName,
        },
      };

      // Execute use case - this handles inbox deduplication and business logic
      const result = await this.useCase.execute(command);

      // Delete message ONLY after successful commit (including business REJECTED)
      if (receiptHandle) {
        await this.deleteMessage(receiptHandle);
      }
      this.logger.log(
        `Message ${messageId} processed: ${result.status} (replay=${result.idempotentReplay})`,
        { correlationId, transactionId: result.transactionId },
      );
    } catch (error) {
      await this.handleProcessingError(message, receiptHandle, error);
    }
  }

  /**
   * Parses and validates the SQS message envelope.
   * Throws ValidationError for permanent failures that should go to DLQ.
   */
  private parseAndValidateEnvelope(message: Message): SqsMessageEnvelope {
    const body = message.Body;
    if (!body) {
      throw new ValidationError('SQS message body is empty');
    }

    let envelope: SqsMessageEnvelope;
    try {
      envelope = JSON.parse(body);
    } catch {
      throw new ValidationError('SQS message body is not valid JSON');
    }

    // Validate required envelope fields
    if (!envelope.messageId || !envelope.type || !envelope.occurredAt || !envelope.data) {
      throw new ValidationError('SQS message envelope missing required fields');
    }

    if (envelope.type !== 'WagerTransactionRequested') {
      throw new ValidationError(`Unexpected message type: ${envelope.type}`);
    }

    // Validate data payload
    const data = envelope.data;
    const requiredFields = [
      'providerId',
      'externalTransactionId',
      'idempotencyKey',
      'playerId',
      'walletId',
      'roundId',
      'gameId',
      'kind',
      'money',
    ];

    for (const field of requiredFields) {
      if (!data[field as keyof typeof data]) {
        throw new ValidationError(`Missing required field: ${field}`);
      }
    }

    // Validate money object
    if (!data.money.amount || !data.money.currency) {
      throw new ValidationError('Money object missing amount or currency');
    }

    // Validate kind is valid (and not OPENING)
    const validKinds = Object.values(WagerTransactionKind);
    if (!validKinds.includes(data.kind as WagerTransactionKind)) {
      throw new ValidationError(`Invalid transaction kind: ${data.kind}`);
    }

    if (data.kind === WagerTransactionKind.Opening) {
      throw new ValidationError('OPENING kind is not allowed via SQS (AC-18)');
    }

    // Validate UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const field of ['playerId', 'walletId', 'roundId', 'gameId']) {
      const value = data[field as keyof typeof data];
      if (typeof value !== 'string' || !uuidRegex.test(value)) {
        throw new ValidationError(`Invalid UUID format for ${field}`);
      }
    }

    return envelope;
  }

  /**
   * Handles processing errors and decides whether to delete, send to DLQ, or redeliver.
   */
  private async handleProcessingError(
    message: Message,
    receiptHandle: string | undefined,
    error: unknown,
  ): Promise<void> {
    const messageId = message.MessageId ?? 'unknown';
    const correlationId = message.MessageAttributes?.correlationId?.StringValue;

    // Permanent failures: send to DLQ explicitly (not just delete)
    if (error instanceof ValidationError || error instanceof IdempotencyConflictError) {
      this.logger.warn(
        `Permanent failure for message ${messageId}: ${error.message}`,
        { correlationId },
      );
      if (receiptHandle) {
        await this.sendToDlq(message, receiptHandle);
      }
      return;
    }

    // Business rejections (REJECTED) are committed → ack the message
    // The use case throws domain errors for business rejections
    // but those are caught and returned as SubmitTransactionResult with status=REJECTED
    // So we should not reach here for business rejections

    // Transient errors: do NOT delete - let visibility timeout redeliver
    this.logger.error(
      `Transient error processing message ${messageId}, will redeliver`,
      error instanceof Error ? error.stack : error,
    );
    // Do NOT delete - message will become visible again after visibility timeout
  }

  /**
   * Sends a message to the DLQ and deletes it from the main queue.
   */
  private async sendToDlq(message: Message, receiptHandle: string): Promise<void> {
    const dlqUrl = this.config.getOrThrow<string>('SQS_DLQ_URL');
    try {
      // Send to DLQ with original message attributes
      await this.sqsClient.send(
        new SendMessageCommand({
          QueueUrl: dlqUrl,
          MessageBody: message.Body,
          MessageAttributes: message.MessageAttributes,
          MessageGroupId: message.Attributes?.MessageGroupId ?? 'wager-transactions',
          MessageDeduplicationId: message.MessageId ?? `dlq-${Date.now()}`,
        }),
      );
      // Delete from main queue after successful DLQ send
      await this.deleteMessage(receiptHandle);
      this.logger.log(`Message sent to DLQ: ${message.MessageId}`);
    } catch (error) {
      this.logger.error('Failed to send message to DLQ', error);
      // Don't delete from main queue if DLQ send failed - will redeliver
    }
  }

  /**
   * Deletes a message from the queue.
   */
  private async deleteMessage(receiptHandle: string): Promise<void> {
    try {
      await this.sqsClient.send(
        new DeleteMessageCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: receiptHandle,
        }),
      );
    } catch (error) {
      this.logger.error('Failed to delete message from SQS', error);
    }
  }
}