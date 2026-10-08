import { describe, it, expect } from 'bun:test';
import { Wallet } from '../../../../../src/domain/wallet/wallet';
import { Money } from '../../../../../src/domain/money/money';
import { WalletResponseDto } from '../../../../../src/modules/wallets/dto/wallet-response.dto';

describe('WalletResponseDto', () => {
  it('maps id, playerId, balance, version', () => {
    const wallet = Wallet.open({
      id: '0192f291-27dd-7d3f-8071-5f8685deef37',
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      initialBalance: Money.from({ amount: '1000.00', currency: 'BRL' }),
    });
    const response = WalletResponseDto.from(wallet);
    expect(response).toEqual({
      id: '0192f291-27dd-7d3f-8071-5f8685deef37',
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      balance: { amount: '1000.00', currency: 'BRL' },
      version: 1,
    });
  });

  it('exposes exactly the four documented fields', () => {
    const wallet = Wallet.open({
      id: '0192f291-27dd-7d3f-8071-5f8685deef37',
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      initialBalance: Money.from({ amount: '0.00', currency: 'BRL' }),
    });
    expect(Object.keys(WalletResponseDto.from(wallet)).sort()).toEqual([
      'balance',
      'id',
      'playerId',
      'version',
    ]);
  });
});
