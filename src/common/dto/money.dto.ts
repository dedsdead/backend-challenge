import { IsString, Matches } from 'class-validator';

/**
 * Money wire shape (spec §6.1): decimal-string amount with exactly 2 decimals
 * plus an ISO-4217 currency. Any `[A-Z]{3}` code is accepted at the DTO level;
 * BRL is the documented operational scope (brainstorm decision 2026-10-06), and
 * non-BRL must stay creatable so cross-currency validation (wallet currency vs
 * transaction currency) is observable end-to-end.
 */
export class MoneyDto {
  @IsString()
  @Matches(/^\d{1,15}\.\d{2}$/)
  amount!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}
