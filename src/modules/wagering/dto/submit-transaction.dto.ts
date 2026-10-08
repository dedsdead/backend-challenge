import { Type } from 'class-transformer';
import {
  IsDefined,
  IsNotEmpty,
  IsObject,
  IsString,
  IsUUID,
  MaxLength,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { MoneyDto } from '../../../common/dto/money.dto';
import { WagerTransactionKind } from '../../../domain/enums';

const ALLOWED_KINDS: readonly string[] = [
  WagerTransactionKind.Bet,
  WagerTransactionKind.Win,
  WagerTransactionKind.Loss,
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
];

/** AC-18: only wallet creation may mint OPENING — externally submitted kinds
 * are the five playable ones (spec §9). */
@ValidatorConstraint({ name: 'allowedWagerKind', async: false })
class AllowedWagerKindConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && ALLOWED_KINDS.includes(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be one of ${ALLOWED_KINDS.join(', ')} (OPENING is internal-only)`;
  }
}

export class SubmitTransactionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  providerId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  externalTransactionId!: string;

  @IsUUID()
  playerId!: string;

  @IsUUID()
  walletId!: string;

  @IsUUID()
  roundId!: string;

  @IsUUID()
  gameId!: string;

  @Validate(AllowedWagerKindConstraint)
  kind!: string;

  // IsDefined: a missing money object passes ValidateNested (skips undefined)
  // and would crash the controller with a 500 instead of a 400.
  // IsObject: reject arrays (ValidateNested accepts arrays)
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  /** Spec §7.4: only REFUND/ROLLBACK carry a reference; for those kinds the
   * field is mandatory (a missing reference was a 500 from the domain). */
  @ValidateIf(
    (dto: SubmitTransactionDto) =>
      dto.kind === WagerTransactionKind.Refund ||
      dto.kind === WagerTransactionKind.Rollback,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  referenceExternalTransactionId?: string;
}
