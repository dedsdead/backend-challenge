import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Response } from 'express';
import { SubmitTransactionUseCase } from './submit-transaction.use-case';
import { WageringService } from './wagering.service';
import { SubmitTransactionDto } from './dto/submit-transaction.dto';
import { TransactionResponseDto } from './dto/transaction-response.dto';
import { WagerTransactionKind, WagerTransactionStatus } from '../../domain/enums';

const KEY_SHAPE_RE = /^\S(?:.*\S)?$/;

/** AC-19/G12: the header is part of the contract — missing, blank, over-long,
 * or comma-bearing keys are a 400 before anything is written. Commas are
 * rejected because Express folds repeated headers with ", ": a folded key
 * could alias two distinct keys into one stored idempotency identity. */
function assertIdempotencyKey(key: string | undefined): asserts key is string {
  if (
    typeof key !== 'string' ||
    key.length === 0 ||
    key.length > 255 ||
    key.includes(',') ||
    !KEY_SHAPE_RE.test(key)
  ) {
    throw new BadRequestException({
      statusCode: 400,
      message: 'Validation failed',
      errors: [
        {
          property: 'idempotency-key',
          constraints: {
            idempotencyKey:
              'Idempotency-Key must be a non-blank comma-free string of at most 255 characters',
          },
        },
      ],
    });
  }
}

@Controller()
export class WageringController {
  constructor(
    private readonly submitUseCase: SubmitTransactionUseCase,
    private readonly wagering: WageringService,
  ) {}

  @Post('wagering/transactions')
  async submit(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: SubmitTransactionDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Record<string, unknown>> {
    assertIdempotencyKey(idempotencyKey);

    const result = await this.submitUseCase.execute({
      providerId: dto.providerId,
      externalTransactionId: dto.externalTransactionId,
      walletId: dto.walletId,
      playerId: dto.playerId,
      roundId: dto.roundId,
      gameId: dto.gameId,
      kind: dto.kind as WagerTransactionKind,
      amount: dto.money.amount,
      currency: dto.money.currency,
      referenceExternalTransactionId: dto.referenceExternalTransactionId,
      idempotencyKey,
      ingress: { kind: 'http' },
    });

    if (result.status === WagerTransactionStatus.Rejected) {
      // G14: the 422 carries no balance — a rejection never moves money.
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: `Transaction rejected: ${result.failureCode ?? 'unknown'}`,
        status: WagerTransactionStatus.Rejected,
        transactionId: result.transactionId,
        failureCode: result.failureCode,
        idempotentReplay: result.idempotentReplay,
      });
    }

    if (result.status === WagerTransactionStatus.PendingReference) {
      // G5: the 202 body is exactly {transactionId, status, idempotentReplay}.
      res.status(202);
      return {
        transactionId: result.transactionId,
        status: result.status,
        idempotentReplay: result.idempotentReplay,
      };
    }

    res.status(200);
    return {
      transactionId: result.transactionId,
      status: result.status,
      balance: result.balance,
      idempotentReplay: result.idempotentReplay,
    };
  }

  @Get('wagering/transactions/:transactionId')
  async getByTransactionId(
    @Param('transactionId', ParseUUIDPipe) transactionId: string,
  ): Promise<TransactionResponseDto> {
    return TransactionResponseDto.from(await this.wagering.getById(transactionId));
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  async getByProviderExternal(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ): Promise<TransactionResponseDto> {
    return TransactionResponseDto.from(
      await this.wagering.getByProviderExternal(providerId, externalTransactionId),
    );
  }
}
