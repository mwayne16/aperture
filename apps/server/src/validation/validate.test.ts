import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { describe, expect, it } from 'vitest';
import { transformAndValidate } from './validate.js';

enum Side {
  Buy = 'buy',
  Sell = 'sell',
}

class LegDto {
  @IsString()
  symbol!: string;

  @IsNumber()
  @Min(0)
  price!: number;
}

class OrderLikeDto {
  @IsString()
  @Length(1, 40)
  name!: string;

  @IsEnum(Side)
  side!: Side;

  @IsOptional()
  @IsInt()
  quantity?: number;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  tags!: string[];

  @ValidateNested({ each: true })
  @Type(() => LegDto)
  legs!: LegDto[];
}

const valid = { name: 'Test', side: 'buy', tags: ['a', 'b'], legs: [{ symbol: 'AAPL', price: 1 }] };

describe('transformAndValidate', () => {
  it('returns a typed instance with nested DTO instances', () => {
    const result = transformAndValidate(OrderLikeDto, valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeInstanceOf(OrderLikeDto);
    expect(result.value.legs[0]).toBeInstanceOf(LegDto);
    expect(result.value.quantity).toBeUndefined();
  });

  it('rejects properties the DTO does not declare, at any depth', () => {
    const result = transformAndValidate(OrderLikeDto, {
      ...valid,
      id: 'injected',
      legs: [{ symbol: 'AAPL', price: 1, ownerId: 7 }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details).toEqual(
      expect.arrayContaining([
        { field: 'id', message: 'property id should not exist' },
        { field: 'legs.0.ownerId', message: 'property ownerId should not exist' },
      ]),
    );
  });

  it('reports every problem by its dotted path', () => {
    const result = transformAndValidate(OrderLikeDto, {
      name: '',
      side: 'hold',
      quantity: 1.5,
      tags: ['a', 'a'],
      legs: [{ symbol: 'AAPL', price: -1 }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details.map((d) => d.field)).toEqual(
      expect.arrayContaining(['name', 'side', 'quantity', 'tags', 'legs.0.price']),
    );
  });

  it('does not echo submitted values in its messages', () => {
    const result = transformAndValidate(OrderLikeDto, { ...valid, name: 'x'.repeat(41) + 'SECRET' });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('rejects input that is not a JSON object', () => {
    for (const input of [null, 'text', 3, ['a']]) {
      expect(transformAndValidate(OrderLikeDto, input)).toEqual({
        ok: false,
        details: [{ field: '', message: 'Expected a JSON object.' }],
      });
    }
  });
});

describe('decorator metadata', () => {
  it('is emitted, so decorators that read property types see them', () => {
    // ** Guards the toolchain: if the test transform stops emitting design types, this fails loudly.
    expect(Reflect.getMetadata('design:type', OrderLikeDto.prototype, 'name')).toBe(String);
    expect(Reflect.getMetadata('design:type', LegDto.prototype, 'price')).toBe(Number);
    expect(Reflect.getMetadata('design:type', OrderLikeDto.prototype, 'legs')).toBe(Array);
  });
});
