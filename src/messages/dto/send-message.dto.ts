import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AttachmentDto {
  @ApiProperty({ example: 'file_123' })
  @IsString()
  @IsNotEmpty()
  externalFileId!: string;

  @ApiPropertyOptional({ example: 'report.pdf', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

@ValidatorConstraint({ name: 'contentOrAttachments', async: false })
class ContentOrAttachmentsConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as SendMessageDto;
    const hasContent = typeof dto.content === 'string' && dto.content.trim().length > 0;
    const hasAttachments = Array.isArray(dto.attachments) && dto.attachments.length > 0;

    return hasContent || hasAttachments;
  }

  defaultMessage(): string {
    return 'content is required unless attachments are provided';
  }
}

export class SendMessageDto {
  @ApiPropertyOptional({ example: 'Hello there', maxLength: 5000 })
  @ValidateIf((o: SendMessageDto) => o.content !== undefined || !o.attachments || o.attachments.length === 0)
  @IsString()
  @MaxLength(5000)
  @Validate(ContentOrAttachmentsConstraint)
  content?: string;

  @ApiPropertyOptional({ type: [AttachmentDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];

  @ApiPropertyOptional({ example: '6566cbd9f1b6c2a9c2a2a123' })
  @IsOptional()
  @IsMongoId()
  replyTo?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
