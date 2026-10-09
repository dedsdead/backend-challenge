import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { WalletResponseDto } from './dto/wallet-response.dto';
import { LedgerQueryDto } from './dto/ledger-query.dto';
import { LedgerPageResponseDto } from './dto/ledger-page-response.dto';
import { ReconciliationResponseDto } from './dto/reconciliation-response.dto';
import { ReconciliationService } from './reconciliation.service';
import { decodeLedgerCursor } from './ledger-cursor.codec';
import { Roles } from '../../auth/roles.decorator';

@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly wallets: WalletsService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  @Post()
  @Roles('transact:write')
  async create(@Body() dto: CreateWalletDto): Promise<WalletResponseDto> {
    const wallet = await this.wallets.create({
      playerId: dto.playerId,
      initialBalance: {
        amount: dto.initialBalance.amount,
        currency: dto.initialBalance.currency,
      },
    });
    return WalletResponseDto.from(wallet);
  }

  @Get(':walletId')
  @Roles('transact:read')
  async get(
    @Param('walletId', ParseUUIDPipe) walletId: string,
  ): Promise<WalletResponseDto> {
    return WalletResponseDto.from(await this.wallets.get(walletId));
  }

  @Get(':walletId/ledger')
  @Roles('transact:read')
  async ledger(
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @Query() query: LedgerQueryDto,
  ): Promise<LedgerPageResponseDto> {
    // Validation precedes resource resolution: an undecodable cursor is a
    // 400 even when the wallet does not exist.
    const cursor = query.cursor ? decodeLedgerCursor(query.cursor) : undefined;
    const page = await this.wallets.listLedger(walletId, cursor, query.limit);
    return LedgerPageResponseDto.from(page);
  }

  @Post(':walletId/reconciliation')
  @Roles('transact:write')
  @HttpCode(HttpStatus.OK)
  async reconcile(
    @Param('walletId', ParseUUIDPipe) walletId: string,
  ): Promise<ReconciliationResponseDto> {
    return this.reconciliation.reconcile(walletId);
  }
}
