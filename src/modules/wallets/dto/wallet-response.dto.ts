import type { Wallet } from '../../../domain/wallet/wallet';

export class WalletResponseDto {
  id!: string;
  playerId!: string;
  balance!: { amount: string; currency: string };
  version!: number;

  static from(wallet: Wallet): WalletResponseDto {
    const dto = new WalletResponseDto();
    dto.id = wallet.id;
    dto.playerId = wallet.playerId;
    dto.balance = wallet.balance.toJSON();
    dto.version = wallet.version;
    return dto;
  }
}
