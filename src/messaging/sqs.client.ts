import { SQSClient } from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';

/**
 * Creates an SQS client configured for the local environment (LocalStack)
 * or production AWS SQS.
 */
export function createSqsClient(config: ConfigService): SQSClient {
  const endpoint = config.getOrThrow<string>('SQS_ENDPOINT');
  const region = config.getOrThrow<string>('AWS_REGION') ?? 'us-east-1';

  return new SQSClient({
    region,
    endpoint,
    // LocalStack accepts any credentials; use dummy values for local development
    credentials: {
      accessKeyId: config.get('AWS_ACCESS_KEY_ID') ?? 'localstack',
      secretAccessKey: config.get('AWS_SECRET_ACCESS_KEY') ?? 'localstack',
    },
    // Disable retries for idempotent operations to avoid duplicate processing
    // The application handles retries at the business logic level
    maxAttempts: 1,
  });
}