import {
  IsBoolean,
  IsInt,
  IsMongoId,
  IsOptional,
  Max,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

@ValidatorConstraint({ name: 'beforeAfter', async: false })
class BeforeAfterConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as QueryMessagesDto;
    return !(dto.before && dto.after);
  }

  defaultMessage(): string {
    return 'before and after cannot be provided together';
  }
}

export class QueryMessagesDto {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  before?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  after?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeDeleted: boolean = true;

  @Validate(BeforeAfterConstraint)
  private readonly beforeAfter?: string;
}
