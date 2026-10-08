import { IsDefined, IsObject, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { MoneyDto } from '../../../common/dto/money.dto';

export class CreateWalletDto {
  @IsUUID()
  playerId!: string;

  // IsDefined: without it a missing object passes ValidateNested (which skips
  // undefined) and the controller crashes with a 500 instead of a 400.
  // IsObject: reject arrays (ValidateNested accepts arrays)
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => MoneyDto)
  initialBalance!: MoneyDto;
}
