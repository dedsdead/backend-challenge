---
name: bullmq
description: "Queue and messaging system with BullMQ: job processing, workers, queues, priorities, retries, delays, job groups, cancellation, monitoring, Redis integration, and advanced patterns like rate limiting, cron jobs, and backoff strategies. Use when implementing async job processing, background tasks, or event-driven architectures with BullMQ."
---

# BullMQ Usage

Comprehensive guide for implementing robust, scalable, and production-ready asynchronous job processing using BullMQ with Redis.

## Architecture Overview

```
┌─────────────────┐     Queue     ┌─────────────────┐     Worker    ┌─────────────────┐
│   Producer      │ ───────────► │     Queue       │ ───────────► │    Worker       │
│  (API/Service)  │              │  (Redis)         │              │  (Job Handler)  │
└─────────────────┘              └─────────────────┘              └─────────────────┘
                                                                   │
                                                                   ▼
                                                         ┌─────────────────┐
                                                         │   Result/Event  │
                                                         │   Processing    │
                                                         └─────────────────┘
```

**Key Concepts:**
- **Producer**: Creates and enqueues jobs
- **Queue**: Stores jobs in Redis (fallback to fallback store for high availability)
- **Worker**: Processes jobs sequentially or in parallel
- **Job**: Represents a task with metadata and data
- **Result**: Output after successful execution
- **Event**: Notification when job status changes

## Basic Queue Setup

### Installation

```typescript
import { Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';

// Basic queue setup
const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
};

const emailQueue = new Queue('email', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: {
      count: 100,
      age: 3600, // Remove after 1 hour
    },
    removeOnFail: {
      count: 1000,
      age: 24 * 3600, // Remove after 24 hours
    },
  },
});

// Check connection
(async () => {
  await emailQueue.add('test-job', { data: 'hello' });
  console.log('Queue connected!');
})();
```

## Producer: Creating Jobs

### Adding Jobs to Queue

```typescript
import { Queue, Job } from 'bullmq';

const emailQueue = new Queue('email', {
  connection: {
    host: 'localhost',
    port: 6379,
  },
});

// Basic job
await emailQueue.add(
  'send-welcome-email',
  {
    to: 'user@example.com',
    subject: 'Welcome to our platform!',
    body: 'Thank you for joining...',
  },
  {
    // Job options
    priority: 10, // Lower number = higher priority
    delay: 1000, // Delay execution by 1 second
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    jobId: 'unique-job-id', // Optional: ensure uniqueness
    timeout: 30000, // 30 second timeout
    removeOnComplete: true,
    removeOnFail: true,
  }
);

// Add multiple jobs
const jobs = [
  { id: '1', data: { name: 'User 1' } },
  { id: '2', data: { name: 'User 2' } },
];

await emailQueue.addBulk(jobs);

// Add job with advanced options
await emailQueue.add(
  'batch-email',
  {
    to: ['user1@example.com', 'user2@example.com'],
    template: 'welcome',
  },
  {
    // Group jobs for batch processing
    jobKey: 'batch-process', // All jobs with same jobKey will be processed together
    group: {
      id: 'batch-group-1',
      title: 'Batch Email Group',
    },
    // Rate limiting
    limit: 10,
    limitInterval: 1000, // 1 job per second
    // Priority queue
    priority: 5,
  }
);
```

## Workers: Processing Jobs

### Basic Worker Setup

```typescript
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';

const emailQueue = new Queue('email', {
  connection: {
    host: 'localhost',
    port: 6379,
  },
});

// Worker for processing email jobs
const emailWorker = new Worker(
  'email',
  async (job: Job) => {
    console.log(`Processing job ${job.id} with data:`, job.data);
    
    const { to, subject, body } = job.data;
    
    // Simulate email sending
    await sendEmail(to, subject, body);
    
    console.log(`Job ${job.id} completed successfully!`);
    return { success: true, email: to };
  },
  {
    connection: {
      host: 'localhost',
      port: 6379,
    },
    // Worker options
    concurrency: 5, // Process 5 jobs concurrently
    limiter: {
      max: 10, // Maximum number of jobs per time window
      duration: 1000, // Time window in milliseconds (1 second)
    },
    // Retry configuration
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    // Job completion tracking
    concurrencyPerJob: 1, // Number of concurrent runs per job
  }
);

// Handle job completion
emailWorker.on('completed', (job: Job) => {
  console.log(`Job ${job.id} completed successfully with result:`, job.returnvalue);
  // Cleanup or trigger post-completion actions
});

// Handle job failure
emailWorker.on('failed', (job: Job, error: Error) => {
  console.log(`Job ${job.id} failed with error:`, error.message);
  // Send notification, alert, or log to monitoring service
});

// Handle job progress
emailWorker.on('progress', (job: Job, progress: number) => {
  console.log(`Job ${job.id} progress: ${progress}%`);
});
```

### Worker with Advanced Features

```typescript
const emailWorker = new Worker(
  'email',
  async (job: Job) => {
    console.log(`[Job ${job.id}] Started processing:`, job.name);
    
    // Track progress
    await job.updateProgress(10);
    
    // Perform task
    const result = await processEmail(job.data);
    
    await job.updateProgress(100);
    
    console.log(`[Job ${job.id}] Completed! Result:`, result);
    return result;
  },
  {
    connection: {
      host: 'localhost',
      port: 6379,
    },
    // Job processing options
    concurrency: 3,
    limiter: {
      max: 100,
      duration: 1000, // 100 jobs per second
    },
    // Advanced retry
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000,
      maxDelay: 10000, // Maximum backoff delay
    },
    // Job cancellation support
    removeOnComplete: 1000, // Keep 1000 completed jobs
    removeOnFail: 10000, // Keep 10000 failed jobs
  }
);

// Listen to all worker events
emailWorker.on('completed', (job: Job) => {
  console.log(`✅ Job ${job.id} (${job.name}) completed successfully`);
  // Log to monitoring, notify Slack/Teams
});

emailWorker.on('failed', (job: Job, error: Error) => {
  console.error(`❌ Job ${job.id} (${job.name}) failed:`, error.message);
  // Send error alert
  // Notify team via Slack/Teams
  // Add to error tracking system (Sentry, DataDog)
});

emailWorker.on('stalled', (job: Job) => {
  console.warn(`⚠️ Job ${job.id} stalled - may need manual intervention`);
  // Check job, possibly retry or mark as failed
});

emailWorker.on('error', (error: Error) => {
  console.error('❌ Worker error:', error);
  // Critical errors - restart worker or alert
});
```

## Queue Events and Monitoring

### Listening to Queue Events

```typescript
import { QueueEvents } from 'bullmq';

// Create queue events listener
const emailQueueEvents = new QueueEvents('email', {
  connection: {
    host: 'localhost',
    port: 6379,
  },
});

// Listen to specific events
emailQueueEvents.on('waiting', ({ jobId }) => {
  console.log(`Job ${jobId} is waiting in queue`);
});

emailQueueEvents.on('active', ({ jobId, prev }) => {
  console.log(`Job ${jobId} is active (previous state: ${prev})`);
});

emailQueueEvents.on('progress', ({ jobId, progress }) => {
  console.log(`Job ${jobId} is ${progress}% complete`);
});

emailQueueEvents.on('completed', ({ jobId, returnvalue }) => {
  console.log(`Job ${jobId} completed! Result:`, returnvalue);
  // Send completion notification
});

emailQueueEvents.on('failed', ({ jobId, failedReason }) => {
  console.error(`Job ${jobId} failed: ${failedReason}`);
  // Send failure alert
});

emailQueueEvents.on('stalled', ({ jobId }) => {
  console.warn(`Job ${jobId} stalled`);
  // Handle stalled jobs
});

emailQueueEvents.on('delayed', ({ jobId }) => {
  console.log(`Job ${jobId} is delayed`);
});

// Listen to all events
emailQueueEvents.on('waiting', (data) => console.log('Event:', data));
emailQueueEvents.on('global:waiting', (data) => console.log('Global Event:', data));

// Clean up listeners
emailQueueEvents.close();
```

### Statistics and Monitoring

```typescript
import { Queue } from 'bullmq';

const emailQueue = new Queue('email', {
  connection: {
    host: 'localhost',
    port: 6379,
  },
});

// Get queue statistics
(async () => {
  const stats = await emailQueue.getJobCounts();

  console.log('Queue Statistics:', {
    waiting: stats.waiting,
    active: stats.active,
    completed: stats.completed,
    failed: stats.failed,
    delayed: stats.delayed,
    paused: stats.paused,
    'paused': stats.paused,
  });

  // Get queue stats with history
  const queueStats = await emailQueue.getJobCounts('completed');
  console.log('Completed Jobs:', queueStats.completed);
})();

// Get job details
const job = await emailQueue.getJob('job-id');
if (job) {
  console.log('Job Details:', {
    id: job.id,
    name: job.name,
    data: job.data,
    attemptsMade: job.attemptsMade,
    attemptsStarted: job.attemptsStarted,
    failedReason: job.failedReason,
    returnvalue: job.returnvalue,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    progress: job.progress,
  });

  // Get job history
  const history = await job.getHistory();
  console.log('Job History:', history);
}

// Get waiting jobs
const waitingJobs = await emailQueue.getWaiting();
console.log('Waiting Jobs:', waitingJobs.length);

// Get active jobs
const activeJobs = await emailQueue.getActive();
console.log('Active Jobs:', activeJobs.length);
```

## Job Priorities

### Setting Priorities

```typescript
// High priority: Immediate processing
await emailQueue.add(
  'urgent-email',
  {
    to: 'admin@example.com',
    subject: 'CRITICAL: System Alert',
    body: 'This is a critical alert...',
  },
  {
    priority: 1, // Highest priority
  }
);

// Medium priority: Normal processing
await emailQueue.add(
  'notification',
  {
    to: 'user@example.com',
    subject: 'New feature available!',
  },
  {
    priority: 10, // Medium priority
  }
);

// Low priority: Background processing
await emailQueue.add(
  'cleanup',
  {
    days: 30,
  },
  {
    priority: 100, // Lowest priority
  }
);

// Priority range: 1 (highest) to 100 (lowest)
// Jobs are processed in priority order
// Same priority: FIFO (First-In-First-Out)
```

## Job Retries and Failures

### Retry Configuration

```typescript
const emailQueue = new Queue('email', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

// Automatic retry on failure
await emailQueue.add(
  'send-email',
  { to: 'user@example.com', subject: 'Test' },
  {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000, // First retry after 2s, then 4s, then 8s
    },
  }
);

// Custom retry strategy
const emailQueue = new Queue('email', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'fixed',
      delay: 1000, // 1 second between retries
    },
  },
});

// Manual retry from worker
const emailWorker = new Worker('email', async (job) => {
  try {
    await sendEmail(job.data);
    return { success: true };
  } catch (error) {
    // Retry once after manual delay
    throw error; // BullMQ will automatically retry based on backoff
  }
});
```

### Handling Job Failures

```typescript
const emailWorker = new Worker('email', async (job) => {
  try {
    // Your job logic here
    await sendEmail(job.data);
    return { success: true };
  } catch (error) {
    // Log the error
    console.error(`Failed to send email: ${error.message}`);
    
    // Custom error handling
    if (error.message.includes('network_error')) {
      throw error; // Retry with backoff
    }
    
    // Fatal error - don't retry
    throw new Error('Fatal error: Cannot retry');
  }
});

// Worker error event
emailWorker.on('failed', (job, error) => {
  if (job) {
    console.error(`Job ${job.id} failed after ${job.attemptsMade} attempts`);
    console.error(`FailedReason: ${error.message}`);
    console.error(`Last error: ${error.stack}`);
  }
});

// In production, integrate with error tracking
import * as Sentry from '@sentry/node';

emailWorker.on('failed', (job, error) => {
  Sentry.captureException(error, {
    tags: {
      jobId: job?.id,
      queue: 'email',
    },
    extra: {
      attemptsMade: job?.attemptsMade,
      jobData: job?.data,
    },
  });
});
```

## Dead Letter Queue (DLQ)

### What is a Dead Letter Queue?

A **Dead Letter Queue** is a dedicated queue for jobs that have failed all their retries. Instead of permanently losing failed jobs or cluttering your main queue, DLQ provides a safe place to:

1. **Preserve failed jobs** for debugging and analysis
2. **Investigate root causes** by inspecting job data and errors
3. **Manually retry failed jobs** from DLQ when appropriate
4. **Create reports** about job failure patterns
5. **Trigger notifications** for critical failures

### Setup DLQ with BullMQ

```typescript
import { Queue, Worker, Job } from 'bullmq';

// Create a dedicated DLQ
const dlq = new Queue('dlq', {
  connection: redisConnection,
});

// Create main queue with DLQ configuration
const emailQueue = new Queue('email', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    // Configure how jobs move to DLQ
    removeOnFail: {
      count: 1000, // Keep 1000 failed jobs in main queue
      age: 86400, // Remove after 24 hours from main queue
    },
  },
});

// Configure worker to send failed jobs to DLQ
const emailWorker = new Worker(
  'email',
  async (job: Job) => {
    try {
      await sendEmail(job.data);
      return { success: true };
    } catch (error) {
      console.error(`Job ${job.id} failed:`, error.message);
      // Don't throw - move job to DLQ automatically
      throw error;
    }
  },
  {
    connection: redisConnection,
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    // Automatically send to DLQ when attempts exhausted
    removeOnFail: true, // Move to DLQ when all retries exhausted
    // Keep jobs in DLQ for longer period
    removeOnComplete: {
      count: 100,
      age: 86400, // 24 hours
    },
  }
);

// Monitor DLQ statistics
(async () => {
  const dlqStats = await dlq.getJobCounts();
  console.log('DLQ Statistics:', {
    waiting: dlqStats.waiting,
    active: dlqStats.active,
    completed: dlqStats.completed,
    failed: dlqStats.failed,
    delayed: dlqStats.delayed,
  });
})();
```

### Advanced DLQ Configuration

```typescript
const emailQueue = new Queue('email', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    // Configure DLQ handling
    attempts: 3,
    removeOnFail: true, // Move to DLQ after failed attempts
    // Only move to DLQ after max attempts
    failedHandler: async (job, err) => {
      console.error(`Job ${job.id} moved to DLQ after ${job.attemptsMade} failures`);
      
      // Send to DLQ
      await dlq.add('failed-email', {
        ...job.data,
        originalJobId: job.id,
        failureReason: err.message,
        attemptsMade: job.attemptsMade,
        failedAt: new Date().toISOString(),
      }, {
        // Keep metadata for DLQ
        jobId: `dlq-${job.id}`,
        // Don't retry in DLQ
        removeOnFail: true,
        removeOnComplete: false, // Keep in DLQ longer
      });
    },
  },
});
```

### Send Jobs to DLQ Manually

```typescript
// Send job directly to DLQ
await dlq.add(
  'manual-fail',
  {
    reason: 'Manual intervention required',
    data: 'Some critical data',
  },
  {
    jobId: 'manual-fail-123',
    // Don't apply default job options
  }
);

// Move a completed job to DLQ
const job = await emailQueue.getJob('job-id');
if (job && job.returnvalue) {
  await dlq.add(
    'duplicate-job',
    job.data,
    {
      jobId: `dlq-${job.id}`,
      removeOnComplete: false, // Keep in DLQ
    }
  );
  await job.remove(); // Remove from main queue
}

// Cancel job and send to DLQ
const job = await emailQueue.getJob('job-id');
if (job) {
  await dlq.add(
    'cancelled-job',
    job.data,
    {
      jobId: `dlq-${job.id}`,
      removeOnFail: true,
      removeOnComplete: false,
    }
  );
  await job.cancel();
}
```

### Worker Handling with DLQ

```typescript
// Configure worker to automatically send failed jobs to DLQ
const emailWorker = new Worker(
  'email',
  async (job: Job) => {
    try {
      // Your processing logic
      await sendEmail(job.data);
      return { success: true };
    } catch (error) {
      // Log and send to DLQ
      console.error(`Job ${job.id} failed:`, error.message);
      
      await dlq.add(
        'failed-email',
        {
          ...job.data,
          originalJobId: job.id,
          failureReason: error.message,
          stackTrace: error.stack,
          attemptsMade: job.attemptsMade,
        },
        {
          jobId: `dlq-${job.id}`,
          removeOnFail: true,
          removeOnComplete: false, // Keep in DLQ
          // Don't retry failed jobs
        }
      );
      
      // Don't throw - job moves to DLQ
    }
  },
  {
    connection: redisConnection,
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    // Send to DLQ after max attempts
    removeOnFail: true, // Moves to DLQ automatically
  }
);

// Listen to DLQ events
dlq.on('completed', ({ jobId, returnvalue }) => {
  console.log(`✅ DLQ Job ${jobId} completed:`, returnvalue);
});

dlq.on('failed', ({ jobId, failedReason }) => {
  console.error(`❌ DLQ Job ${jobId} failed:`, failedReason);
});
```

### Processing Jobs from DLQ

```typescript
// Worker to process failed jobs from DLQ
const dlqWorker = new Worker(
  'dlq',
  async (job: Job) => {
    console.log(`Processing failed job ${job.id} from DLQ`);
    console.log('Job data:', job.data);
    
    const { originalJobId, failureReason, data, attemptsMade } = job.data;
    
    // Log for investigation
    logger.error('Failed job from DLQ', {
      originalJobId,
      failureReason,
      attemptsMade,
      data,
    });
    
    // Manual retry logic
    try {
      // Attempt to process the original job
      await sendEmail(data);
      
      console.log(`Successfully retried job ${originalJobId}`);
      
      // Mark as complete
      return { status: 'retried' };
    } catch (error) {
      console.error(`Failed to retry job ${originalJobId}:`, error.message);
      
      // Move to secondary DLQ or mark as failed
      await dlq.add(
        'failed-email-secondary',
        {
          ...data,
          originalJobId,
          failureReason: error.message,
          attemptsMade,
          isFromSecondaryDLQ: true,
        },
        {
          jobId: `dlq-secondary-${job.id}`,
          removeOnFail: true,
          removeOnComplete: false,
        }
      );
      
      return { status: 'failed' };
    }
  },
  {
    connection: redisConnection,
    concurrency: 2,
  }
);

// Monitor DLQ worker
dlqWorker.on('completed', (job) => {
  console.log(`✅ DLQ Worker completed job ${job.id}`);
});

dlqWorker.on('failed', (job, error) => {
  console.error(`❌ DLQ Worker failed job ${job.id}:`, error.message);
});
```

### DLQ with Different Behavior for Failed Jobs

```typescript
const emailQueue = new Queue('email', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    // Configure attempts handler
    attempts: 5,
    attemptsHandler: async (job, err) => {
      // Check failure reason
      const isFatal = err.message.includes('fatal');
      
      if (isFatal) {
        // Send to DLQ immediately
        await dlq.add(
          'failed-fatal',
          {
            ...job.data,
            failureReason: err.message,
            isFatal: true,
            attemptsMade: job.attemptsMade,
          },
          {
            jobId: `dlq-${job.id}`,
            removeOnFail: true,
            removeOnComplete: false,
          }
        );
      } else {
        // Will retry automatically
        throw err;
      }
    },
  },
});

// Worker logic
const emailWorker = new Worker('email', async (job) => {
  try {
    await sendEmail(job.data);
    return { success: true };
  } catch (error) {
    // Fatal errors won't be retried
    if (error.message.includes('fatal')) {
      throw error; // Will send to DLQ via attemptsHandler
    }
    
    // Non-fatal errors will be retried
    console.log(`Job ${job.id} failed, will retry...`);
    throw error;
  }
});
```

### Integration with Monitoring and Alerts

```typescript
import winston from 'winston';
import * as Sentry from '@sentry/node';

const logger = winston.createLogger({
  level: 'error',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'dlq-errors.log' }),
  ],
});

// Worker with monitoring
const emailWorker = new Worker(
  'email',
  async (job) => {
    try {
      await sendEmail(job.data);
      return { success: true };
    } catch (error) {
      // Log to monitoring
      logger.error(`Job ${job.id} failed and moved to DLQ`, {
        error: error.message,
        stack: error.stack,
        data: job.data,
      });
      
      // Send to Sentry
      Sentry.captureException(error, {
        tags: {
          jobId: job.id,
          queue: 'email',
          dlq: true,
        },
        extra: {
          attemptsMade: job.attemptsMade,
          jobData: job.data,
        },
      });
      
      // Move to DLQ
      await dlq.add('failed-email', {
        ...job.data,
        originalJobId: job.id,
        failureReason: error.message,
        attemptsMade: job.attemptsMade,
      }, {
        jobId: `dlq-${job.id}`,
        removeOnFail: true,
        removeOnComplete: false,
      });
      
      throw error;
    }
  },
  {
    connection: redisConnection,
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnFail: true,
  }
);

// Monitor DLQ and send alerts
setInterval(async () => {
  const stats = await dlq.getJobCounts();
  const failedJobs = await dlq.getJobCounts('failed');
  
  if (stats.failed > 100) {
    logger.error('DLQ has many failed jobs!', {
      failed: stats.failed,
      waiting: stats.waiting,
    });
    
    // Send alert via Slack/Teams
    await sendAlertToSlack('DLQ Alert', `DLQ has ${stats.failed} failed jobs!`);
  }
}, 60000); // Every minute

// DLQ events
dlq.on('waiting', ({ jobId }) => {
  logger.info(`DLQ Job ${jobId} is waiting`);
});

dlq.on('failed', ({ jobId, failedReason }) => {
  logger.error(`DLQ Job ${jobId} failed:`, failedReason);
  // Send alert for critical failures
  if (failedReason.includes('CRITICAL')) {
    await sendAlertToSlack('Critical DLQ Failure', {
      jobId,
      reason: failedReason,
    });
  }
});
```

### Statistics and Monitoring of DLQ

```typescript
// Get DLQ statistics
(async () => {
  const dlqStats = await dlq.getJobCounts();
  
  console.log('DLQ Statistics:', {
    totalJobs: dlqStats.waiting + dlqStats.active + dlqStats.completed + dlqStats.failed,
    waiting: dlqStats.waiting,
    active: dlqStats.active,
    completed: dlqStats.completed,
    failed: dlqStats.failed,
    delayed: dlqStats.delayed,
  });
  
  // Get failed jobs from DLQ
  const failedJobs = await dlq.getJobCounts('failed');
  console.log('Failed Jobs:', failedJobs.failed);
  
  // Get failed jobs with details
  const allJobs = await dlq.getJobs(['failed']);
  console.log('Failed job details:', allJobs.length);
  
  // Analyze failed job patterns
  for (const job of allJobs) {
    if (job.data.failureReason) {
      // Count by failure reason
      // Store for analysis
    }
  }
})();

// Monitor DLQ size and take action
const monitorDLQ = async () => {
  const stats = await dlq.getJobCounts();
  const waiting = await dlq.getWaiting();
  const failed = await dlq.getJobs(['failed']);
  
  console.log(`DLQ Size: ${waiting.length} waiting, ${failed.length} failed`);
  
  // Send to secondary DLQ if DLQ is too large
  if (waiting.length > 1000) {
    console.log('DLQ is too large, sending to secondary storage');
    await backupDLQToSecondaryStorage();
  }
};

// Periodic monitoring
setInterval(monitorDLQ, 300000); // Every 5 minutes
```

### DLQ with Database Storage

```typescript
// Table for DLQ jobs in database
interface DlqJob {
  id: string;
  queue: string;
  jobId: string;
  data: any;
  failureReason: string;
  attemptsMade: number;
  movedToDlqAt: Date;
  status: 'waiting' | 'active' | 'completed' | 'failed';
}

// Save failed jobs to database
const emailWorker = new Worker(
  'email',
  async (job) => {
    try {
      await sendEmail(job.data);
      return { success: true };
    } catch (error) {
      // Save to database
      await dlqRepository.create({
        queue: 'email',
        jobId: job.id,
        data: job.data,
        failureReason: error.message,
        attemptsMade: job.attemptsMade,
        movedToDlqAt: new Date(),
        status: 'failed',
      });
      
      // Add to BullMQ DLQ
      await dlq.add('failed-email', {
        ...job.data,
        originalJobId: job.id,
        failureReason: error.message,
        attemptsMade: job.attemptsMade,
        movedToDlqAt: new Date(),
      }, {
        jobId: `dlq-${job.id}`,
        removeOnFail: true,
        removeOnComplete: false,
      });
      
      throw error;
    }
  },
  {
    connection: redisConnection,
    attempts: 5,
    removeOnFail: true,
  }
);

// Worker to process and reattempt DLQ jobs
const dlqWorker = new Worker(
  'dlq',
  async (job) => {
    const { originalJobId, data, failureReason } = job.data;
    
    // Log and investigate
    logger.error('Investigating failed job from DLQ', {
      originalJobId,
      failureReason,
      data,
    });
    
    // Check if we can retry
    const retryable = canRetryJob(failureReason);
    
    if (retryable) {
      // Add back to main queue
      await emailQueue.add('retried-email', data, {
        jobId: `retry-${originalJobId}`,
      });
      
      // Remove from DLQ
      await job.remove();
      
      logger.info(`Job ${originalJobId} moved back to queue`);
    } else {
      // Mark as failed permanently
      await dlqRepository.updateStatus(originalJobId, 'permanent_failure');
      
      // Send notification for critical failures
      if (failureReason.includes('CRITICAL')) {
        await sendAlertToSlack('Critical Failure in DLQ', {
          jobId: originalJobId,
          failureReason,
        });
      }
      
      await job.remove();
    }
    
    return { status: 'processed' };
  },
  {
    connection: redisConnection,
    concurrency: 1, // Process one at a time for investigation
  }
);
```

### DLQ Cleanup Strategies

```typescript
// Clean up old DLQ jobs
const cleanupOldDlqJobs = async () => {
  // Get all DLQ jobs
  const jobs = await dlq.getJobs(['failed', 'completed']);
  
  for (const job of jobs) {
    // Check age
    const age = Date.now() - job.finishedOn.getTime();
    const daysOld = age / (1000 * 60 * 60 * 24);
    
    // Remove jobs older than 7 days
    if (daysOld > 7) {
      console.log(`Removing old DLQ job ${job.id} (${daysOld.toFixed(1)} days old)`);
      await job.remove();
    }
  }
};

// Cleanup old DLQ jobs daily
setInterval(cleanupOldDlqJobs, 86400000); // Every 24 hours

// Remove only failed jobs, keep completed
const cleanupDlqJobs = async () => {
  const failedJobs = await dlq.getJobs(['failed']);
  
  for (const job of failedJobs) {
    // Keep critical failures for longer
    if (job.data.failureReason?.includes('CRITICAL')) {
      // Keep for 30 days
      const age = Date.now() - job.finishedOn.getTime();
      if (age > 30 * 24 * 60 * 60 * 1000) {
        await job.remove();
      }
    } else {
      // Remove other failures after 7 days
      const age = Date.now() - job.finishedOn.getTime();
      if (age > 7 * 24 * 60 * 60 * 1000) {
        await job.remove();
      }
    }
  }
};
```

### Best Practices for DLQ

#### ✅ DO

1. **Always use DLQ**: Never lose failed jobs without proper handling
2. **Keep failure context**: Save job data, error messages, and timestamps
3. **Monitor DLQ size**: Set alerts when DLQ grows too large
4. **Process systematically**: Use workers to investigate and retry DLQ jobs
5. **Classify failures**: Use different DLQ queues for different types of failures
6. **Log everything**: Comprehensive logging of all DLQ activity
7. **Set retention limits**: Automatically remove old DLQ jobs
8. **Investigate patterns**: Analyze failure reasons for systemic issues
9. **Human intervention**: Use monitoring to alert when manual intervention needed
10. **Document DLQ handling**: Document procedures for handling DLQ jobs

#### ❌ DON'T

1. **Never ignore failed jobs**: Always handle failures properly
2. **Don't keep unlimited jobs**: Set limits to prevent memory bloat
3. **Don't process DLQ blindly**: Investigate before retrying
4. **Don't lose critical jobs**: Backup important DLQ entries
5. **Don't forget to monitor**: Set up alerts and dashboards
6. **Don't ignore patterns**: Investigate repeated failure reasons
7. **Don't retry everything**: Some failures shouldn't be retried
8. **Don't block processing**: Keep main queue processing while handling DLQ
9. **Don't forget cleanup**: Old DLQ jobs consume resources
10. **Don't make it complex**: Keep DLQ simple and manageable

### Integration with Workflow Commands

When using with OpenCode plugin commands:

```typescript
// QueueModule with DLQ configuration
@Module({
  imports: [
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT),
      },
    }),
    BullModule.registerQueue({
      name: 'email',
    }),
    BullModule.registerQueue({
      name: 'dlq', // Dedicated DLQ queue
    }),
  ],
  providers: [
    EmailProcessor,
    DlqProcessor,
  ],
})
export class QueueModule {}
```

DLQ is an essential pattern for production systems, providing safety, observability, and recovery options for failed jobs. Configure it properly to maintain system reliability and debuggability.

## Job Delays

### Scheduling Jobs

```typescript
// Schedule job for later
const futureDate = new Date();
futureDate.setSeconds(futureDate.getSeconds() + 60); // In 60 seconds

await emailQueue.add(
  'delayed-email',
  {
    to: 'user@example.com',
    subject: 'Scheduled Email',
  },
  {
    delay: 60000, // Delay in milliseconds (60 seconds)
    jobId: 'delayed-email-123',
  }
);

// Schedule job at specific time
const scheduledTime = new Date('2024-01-01T10:00:00');

await emailQueue.add(
  'scheduled-report',
  {
    reportType: 'daily',
  },
  {
    delay: scheduledTime.getTime() - Date.now(), // Calculate delay
    jobId: 'daily-report-2024-01-01',
  }
);

// Delay in worker execution
const emailWorker = new Worker('email', async (job) => {
  if (job.data.delay) {
    // Process only after delay
    await new Promise((resolve) => setTimeout(resolve, job.data.delay));
  }
  
  await sendEmail(job.data);
  return { success: true };
});

// Add job with delay in worker data
await emailQueue.add(
  'delayed-email',
  {
    to: 'user@example.com',
    delay: 5000, // Worker will wait 5 seconds before processing
  },
  {}
);
```

## Job Groups

### Processing Jobs Together

```typescript
// Add jobs to the same group
await emailQueue.add(
  'batch-email-1',
  {
    to: 'user1@example.com',
    template: 'welcome',
  },
  {
    group: {
      id: 'batch-group',
      title: 'Welcome Email Batch',
    },
  }
);

await emailQueue.add(
  'batch-email-2',
  {
    to: 'user2@example.com',
    template: 'welcome',
  },
  {
    group: {
      id: 'batch-group',
      title: 'Welcome Email Batch',
    },
  }
);

await emailQueue.add(
  'batch-email-3',
  {
    to: 'user3@example.com',
    template: 'welcome',
  },
  {
    group: {
      id: 'batch-group',
      title: 'Welcome Email Batch',
    },
  }
);

// All jobs in the same group will be processed together
// They will be processed as a batch
// Only one job from the group is processed at a time
```

## Job Cancellation

### Canceling Jobs

```typescript
// Get job
const job = await emailQueue.getJob('job-id');

// Cancel a waiting job
await job?.cancel();

// Cancel all jobs with specific job key
await emailQueue.pause(); // Pause queue first
await emailQueue.removeByClean(1000, 'job-key'); // Clean waiting jobs with specific key
await emailQueue.resume(); // Resume queue

// Cancel delayed jobs
const delayedJobs = await emailQueue.getDelayed();
for (const job of delayedJobs) {
  if (job.data.type === 'temporary') {
    await job.cancel();
  }
}

// Cancel specific job by ID
const canceled = await emailQueue.cancelJob('job-id');
console.log('Job canceled:', canceled);

// Cancel all jobs with specific pattern
const jobs = await emailQueue.getJobs(['waiting', 'active']);
for (const job of jobs) {
  if (job.data.type === 'temporary') {
    await job.cancel();
  }
}
```

## Rate Limiting

### Limiting Job Execution

```typescript
// Rate limiting in worker
const emailWorker = new Worker(
  'email',
  async (job) => {
    // Process job
    await sendEmail(job.data);
    return { success: true };
  },
  {
    connection: {
      host: 'localhost',
      port: 6379,
    },
    // Global rate limiting
    limiter: {
      max: 100, // Maximum 100 jobs per time window
      duration: 1000, // 1 second time window
    },
    concurrency: 5, // 5 concurrent workers
  }
);

// Per-job rate limiting
await emailQueue.add(
  'bulk-email',
  {
    to: 'multiple@example.com',
  },
  {
    // Limit to 10 jobs per minute
    rateLimit: {
      max: 10,
      duration: 60,
    },
  }
);

// Per-key rate limiting
await emailQueue.add(
  'email',
  { to: 'user@example.com' },
  {
    rateLimit: {
      max: 5,
      duration: 60, // 5 emails per minute per recipient
    },
  }
);
```

## Job Timeout

### Timeouts for Long-Running Jobs

```typescript
const emailWorker = new Worker(
  'email',
  async (job) => {
    // Simulate long-running task
    await new Promise((resolve) => setTimeout(resolve, 30000));
    return { success: true };
  },
  {
    connection: {
      host: 'localhost',
      port: 6379,
    },
    // Timeout per job
    timeout: 10000, // 10 second timeout
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  }
);

// Worker handles timeout
emailWorker.on('failed', (job, error) => {
  if (error.message.includes('Timeout')) {
    console.error(`Job ${job.id} timed out after 10 seconds`);
    // Handle timeout: send notification, mark as failed, retry
  }
});
```

## Job Data Types

### Complex Data Structures

```typescript
// Array data
await emailQueue.add(
  'batch-processing',
  {
    users: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ],
    action: 'export',
  },
  {}
);

// Nested objects
await emailQueue.add(
  'notification',
  {
    user: {
      id: 123,
      email: 'user@example.com',
      preferences: {
        language: 'en',
        notifications: {
          email: true,
          sms: false,
        },
      },
    },
    type: 'promo',
    discount: {
      code: 'SUMMER2024',
      percent: 20,
    },
  },
  {}
);

// Date objects (convert to ISO string)
const jobData = {
  startDate: new Date('2024-01-01').toISOString(),
  endDate: new Date('2024-12-31').toISOString(),
};

await emailQueue.add('report-generation', jobData, {});

// JSON data
const complexData = {
  metadata: {
    version: '1.0',
    language: 'pt-BR',
    encoding: 'UTF-8',
  },
  items: [
    { id: 1, name: 'Item 1' },
    { id: 2, name: 'Item 2' },
  ],
  tags: ['important', 'urgent', 'priority'],
};

await emailQueue.add('process-data', complexData, {});
```

## Advanced Patterns

### Concurrent Job Processing

```typescript
const emailWorker = new Worker(
  'email',
  async (job) => {
    // Your processing logic
    return { success: true };
  },
  {
    connection: {
      host: 'localhost',
      port: 6379,
    },
    // Process jobs from the same job ID concurrently
    concurrencyPerJob: 2, // Two concurrent runs per job
    // Process multiple jobs concurrently
    concurrency: 10,
    // Rate limiting
    limiter: {
      max: 100,
      duration: 1000,
    },
  }
);

// Wait for all concurrent runs to complete
await emailQueue.add(
  'concurrent-job',
  { data: 'test' },
  {
    // This job will be processed by 2 concurrent workers
    // All must complete before next job starts
  }
);
```

### Nested Queues (Chain Processing)

```typescript
const emailQueue = new Queue('email');
const reportQueue = new Queue('reports');

// Chain: Email job -> Report job
const emailWorker = new Worker('email', async (job) => {
  const result = await sendEmail(job.data);
  // After email is sent, add report job
  await reportQueue.add('generate-report', {
    email: result.email,
    type: 'sent',
  });
  return result;
});

// Process generated reports
const reportWorker = new Worker('reports', async (job) => {
  console.log('Generating report:', job.data);
  await new Promise((resolve) => setTimeout(resolve, 5000));
  return { generated: true };
});
```

### Recursive Jobs

```typescript
const emailQueue = new Queue('email');

const emailWorker = new Worker('email', async (job) => {
  const result = await sendEmail(job.data);
  
  // If email failed, retry
  if (!result.success) {
    if (job.attemptsMade < job.opts.attempts) {
      throw new Error('Email failed - will retry');
    }
    // Maximum retries reached
    console.log('Max retries reached');
    return { status: 'max_retries' };
  }
  
  // If successful and needs follow-up
  if (result.needsFollowUp) {
    await emailQueue.add(
      'followup-email',
      {
        to: job.data.to,
        subject: 'Follow up',
        template: 'followup',
      },
      {
        delay: 86400000, // 24 hours later
      }
    );
  }
  
  return result;
});
```

## Connection Management

### Redis Connection with Resilience

```typescript
import Redis from 'ioredis';

const createRedisConnection = () => {
  const options = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    enableReadyCheck: true,
    enableOfflineQueue: true,
    lazyConnect: false,
  };

  return options;
};

const redisConnection = createRedisConnection();

const emailQueue = new Queue('email', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

// Handle connection errors
emailQueue.on('error', (error) => {
  console.error('Queue error:', error);
  // Restart queue or notify team
});

// Handle connection reconnection
emailQueue.on('closed', () => {
  console.log('Queue connection closed');
  // Notify monitoring
});

emailQueue.on('error', (error) => {
  console.error('Queue error:', error);
  // Retry connection
});

// Health check
const healthCheck = async () => {
  try {
    await emailQueue.isReady();
    console.log('Queue is healthy');
  } catch (error) {
    console.error('Queue is unhealthy:', error);
    // Trigger alert
  }
};
```

### Multiple Redis Connections

```typescript
const createRedisConnection = (name: string) => ({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  db: name === 'default' ? 0 : parseInt(process.env.REDIS_DB || '1'),
});

const defaultQueue = new Queue('default', {
  connection: createRedisConnection('default'),
});

const highPriorityQueue = new Queue('high-priority', {
  connection: createRedisConnection('high-priority'),
});

const emailQueue = new Queue('email', {
  connection: createRedisConnection('email'),
});

const reportQueue = new Queue('reports', {
  connection: createRedisConnection('reports'),
});
```

## Production Best Practices

### 1. Connection Resilience

```typescript
// Use reliable Redis connection
const redisConnection = {
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: 5,
  retryStrategy(times) {
    const delay = Math.min(times * 1000, 10000);
    return delay;
  },
  enableReadyCheck: true,
  lazyConnect: false,
};

// Monitor connection health
setInterval(async () => {
  try {
    await redisConnection.redis?.ping();
    console.log('Redis connection healthy');
  } catch (error) {
    console.error('Redis connection failed:', error);
    // Alert monitoring system
  }
}, 30000); // Every 30 seconds
```

### 2. Job Cleanup

```typescript
// Configure automatic job cleanup
const emailQueue = new Queue('email', {
  connection: redisConnection,
  defaultJobOptions: {
    // Remove completed jobs after 1 hour
    removeOnComplete: {
      count: 1000,
      age: 3600,
    },
    // Remove failed jobs after 24 hours
    removeOnFail: {
      count: 10000,
      age: 86400,
    },
  },
});

// Scheduled cleanup for abandoned jobs
const cleanupInterval = setInterval(async () => {
  // Clean up stalled jobs
  const stalledJobs = await emailQueue.getStalled();
  for (const job of stalledJobs) {
    console.log(`Removing stalled job ${job.id}`);
    await job.remove();
  }
  
  // Clean up jobs that exceeded timeout
  const allJobs = await emailQueue.getJobCounts();
  // Implement custom cleanup logic
}, 3600000); // Every hour
```

### 3. Monitoring and Logging

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'bullmq.log' }),
  ],
});

const emailQueueEvents = new QueueEvents('email', {
  connection: redisConnection,
});

emailQueueEvents.on('completed', ({ jobId, returnvalue }) => {
  logger.info(`Job ${jobId} completed`, { returnvalue });
});

emailQueueEvents.on('failed', ({ jobId, failedReason }) => {
  logger.error(`Job ${jobId} failed`, { error: failedReason });
});

// Expose metrics for monitoring
const getMetrics = async () => {
  const stats = await emailQueue.getJobCounts();
  const waiting = await emailQueue.getWaiting();
  const active = await emailQueue.getActive();
  
  return {
    waiting: waiting.length,
    active: active.length,
    completed: stats.completed,
    failed: stats.failed,
    delayed: stats.delayed,
  };
};

// Health check endpoint
app.get('/health/queue', async (req, res) => {
  try {
    await emailQueue.isReady();
    const metrics = await getMetrics();
    res.json({ 
      status: 'healthy', 
      metrics,
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'unhealthy', 
      error: error.message,
    });
  }
});
```

### 4. Error Handling

```typescript
const emailWorker = new Worker(
  'email',
  async (job) => {
    try {
      const result = await sendEmail(job.data);
      return result;
    } catch (error) {
      // Log error with context
      logger.error(`Failed to send email:`, {
        jobId: job.id,
        email: job.data.to,
        error: error.message,
        stack: error.stack,
      });
      
      // Don't throw for recoverable errors
      if (error.message.includes('network')) {
        throw error; // Will retry
      }
      
      // For fatal errors, don't retry
      throw new Error(`Fatal error: ${error.message}`);
    }
  },
  {
    connection: redisConnection,
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  }
);

// Global error handler
emailWorker.on('error', (error) => {
  logger.error('Worker error:', error);
  // Send alert to monitoring service
});

// Integrate with error tracking
import * as Sentry from '@sentry/node';

emailWorker.on('failed', (job, error) => {
  if (job) {
    Sentry.captureException(error, {
      tags: {
        jobId: job.id,
        queue: 'email',
      },
      extra: {
        attemptsMade: job.attemptsMade,
        jobData: job.data,
      },
    });
  }
});
```

### 5. Graceful Shutdown

```typescript
import { Queue, Worker } from 'bullmq';

const emailQueue = new Queue('email', { connection: redisConnection });
const emailWorker = new Worker('email', handler, { connection: redisConnection });

const shutdown = async (signal: string) => {
  console.log(`${signal} received. Shutting down gracefully...`);
  
  // Stop accepting new jobs
  await emailQueue.pause();
  console.log('Queue paused. No new jobs will be added.');
  
  // Give time for existing jobs to complete
  const shutdownTimeout = setTimeout(() => {
    console.warn('Shutdown timeout - forcefully closing');
    process.exit(1);
  }, 30000); // 30 seconds
  
  // Wait for all jobs to complete
  await new Promise((resolve) => {
    emailWorker.on('completed', (job) => {
      if (job.returnvalue?.status === 'all_jobs_completed') {
        resolve(true);
      }
    });
  });
  
  clearTimeout(shutdownTimeout);
  
  // Close workers and queues
  await emailWorker.close();
  await emailQueue.close();
  
  console.log('Shutdown complete');
  process.exit(0);
};

// Handle shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  // Notify team, but don't crash
});
```

## Integration with NestJS

### NestJS Module and Service

```typescript
// queues/queue.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailProcessor } from './email.processor';
import { ReportProcessor } from './report.processor';

@Module({
  imports: [
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
      },
    }),
    BullModule.registerQueue({
      name: 'email',
    }),
    BullModule.registerQueue({
      name: 'reports',
    }),
  ],
  providers: [EmailProcessor, ReportProcessor],
  exports: [BullModule],
})
export class QueueModule {}
```

```typescript
// queues/email.service.ts
import { Injectable, InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';

@Injectable()
export class EmailService {
  constructor(
    @InjectQueue('email')
    private readonly emailQueue: Queue,
  ) {}

  async sendWelcomeEmail(email: string, name: string) {
    await this.emailQueue.add(
      'send-welcome-email',
      {
        to: email,
        subject: `Welcome, ${name}!`,
        body: `Welcome to our platform!`,
      },
      {
        priority: 1, // High priority
      }
    );
  }

  async sendBulkEmail(users: Array<{ email: string; name: string }>) {
    const jobs = users.map((user) => ({
      name: 'send-welcome-email',
      data: {
        to: user.email,
        subject: `Welcome, ${user.name}!`,
        body: `Welcome to our platform!`,
      },
      options: {
        priority: 10,
      },
    }));

    await this.emailQueue.addBulk(jobs);
  }

  async scheduleReport(reportType: string, date: Date) {
    await this.emailQueue.add(
      'generate-report',
      {
        reportType,
        date: date.toISOString(),
      },
      {
        delay: date.getTime() - Date.now(),
        jobId: `report-${reportType}-${date.toISOString()}`,
      }
    );
  }
}
```

```typescript
// queues/email.processor.ts
import { Processor, Process } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

@Processor('email')
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);

  @Process('send-welcome-email')
  async handleWelcomeEmail(job: Job) {
    this.logger.log(`Processing welcome email: ${job.id}`);
    
    const { to, subject, body } = job.data;
    
    try {
      await sendEmail(to, subject, body);
      this.logger.log(`Welcome email sent to ${to}`);
      return { status: 'sent' };
    } catch (error) {
      this.logger.error(`Failed to send welcome email: ${error.message}`);
      throw error; // Will retry based on backoff
    }
  }

  @Process('generate-report')
  async handleReportGeneration(job: Job) {
    this.logger.log(`Processing report generation: ${job.id}`);
    
    const { reportType, date } = job.data;
    
    // Simulate report generation
    await new Promise((resolve) => setTimeout(resolve, 5000));
    
    // Send report via email
    await sendEmail(
      'admin@example.com',
      'Report Generated',
      `Report ${reportType} for ${date} has been generated.`,
    );
    
    return { status: 'completed' };
  }
}
```

## Best Practices Summary

### ✅ DO

1. **Always handle errors**: Implement try-catch blocks and retry logic
2. **Use descriptive job names**: Clear job names for monitoring and debugging
3. **Configure cleanup**: Remove completed/failed jobs to prevent Redis bloat
4. **Monitor jobs**: Implement logging and monitoring for all job types
5. **Use priorities strategically**: Don't overuse; maintain fairness
6. **Test failure scenarios**: Ensure retry logic works correctly
7. **Graceful shutdown**: Handle process termination properly
8. **Use type safety**: TypeScript interfaces for job data
9. **Rate limit appropriately**: Prevent overloading your system
10. **Document job purposes**: Add comments explaining job logic

### ❌ DON'T

1. **Never put large data in jobs**: Keep job data small (strings, numbers, simple objects)
2. **Don't ignore errors**: Always log and handle errors appropriately
3. **Avoid infinite retries**: Set reasonable attempt limits
4. **Don't process sensitive data**: Use secure encryption for job data
5. **Don't forget cleanup**: Failed jobs accumulate and consume memory
6. **Don't block workers**: Use async operations and don't await blocking calls
7. **Avoid global state**: Process each job independently
8. **Don't assume order**: Jobs may execute in any order
9. **Don't use complex dependencies in jobs**: Keep jobs self-contained
10. **Don't forget to close connections**: Clean up on shutdown

## Resources

- **Official Documentation**: https://docs.bullmq.io/
- **TypeScript Support**: BullMQ is fully typed with TypeScript
- **Monitoring Tools**: Redis Insight, Bull Board, Prometheus integration
- **Community**: GitHub Issues and Discussions

## Common Patterns

1. **Email sending**: Background job processing for transactional emails
2. **File processing**: Thumbnail generation, image compression, video encoding
3. **Data synchronization**: Periodic sync between services
4. **Report generation**: Scheduled report creation and distribution
5. **Payment processing**: Async payment verification and webhook handling
6. **Notification**: User notifications via various channels
7. **Scheduled tasks**: Cron jobs and time-based tasks
8. **Workflow orchestration**: Multi-step job chains and dependencies
