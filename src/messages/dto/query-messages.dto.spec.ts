import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryMessagesDto } from './query-messages.dto';

describe('QueryMessagesDto', () => {
  it('defaults limit and includeDeleted', async () => {
    const dto = plainToInstance(QueryMessagesDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(50);
    expect(dto.includeDeleted).toBe(true);
  });

  it('rejects invalid before and after', async () => {
    const dto = plainToInstance(QueryMessagesDto, {
      before: 'not-a-mongo-id',
    });

    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects when both before and after are provided', async () => {
    const dto = plainToInstance(QueryMessagesDto, {
      before: '507f1f77bcf86cd799439011',
      after: '507f1f77bcf86cd799439012',
    });

    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
  });
});
