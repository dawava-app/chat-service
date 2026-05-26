import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryConversationsDto } from './query-conversations.dto';

describe('QueryConversationsDto', () => {
  it('defaults limit to 20', async () => {
    const dto = plainToInstance(QueryConversationsDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(20);
  });

  it('rejects limit greater than 50', async () => {
    const dto = plainToInstance(QueryConversationsDto, { limit: 100 });

    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid type', async () => {
    const dto = plainToInstance(QueryConversationsDto, { type: 'invalid' });

    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-string cursor', async () => {
    const dto = plainToInstance(QueryConversationsDto, { cursor: 123 });

    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
  });

  it('parses participant filters from arrays and comma-separated values', async () => {
    const dto = plainToInstance(QueryConversationsDto, {
      with: ['user-2', 'user-3'],
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.with).toEqual(['user-2', 'user-3']);
  });
});
