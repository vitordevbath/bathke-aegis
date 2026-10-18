import { describe, expect, it } from 'vitest';
import { AuthenticationError, ConflictError, DomainError, ForbiddenError, NotFoundError, ValidationError } from '../src/index.js';

describe('DomainError hierarchy', () => {
  it.each([
    [new ValidationError('x'), 'VALIDATION_ERROR', 'ValidationError'],
    [new AuthenticationError(), 'AUTHENTICATION_ERROR', 'AuthenticationError'],
    [new ConflictError('x', 'email'), 'CONFLICT', 'ConflictError'],
    [new ForbiddenError(), 'FORBIDDEN', 'ForbiddenError'],
    [new NotFoundError(), 'NOT_FOUND', 'NotFoundError'],
  ])('%o carries a stable code and class name', (error, code, name) => {
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(code);
    expect(error.name).toBe(name);
  });

  it('keeps field issues on validation errors', () => {
    expect(ValidationError.forField('cpf', 'Inválido').issues).toEqual([{ field: 'cpf', message: 'Inválido' }]);
  });

  it('keeps the conflicting field', () => {
    expect(new ConflictError('Email já cadastrado.', 'email').field).toBe('email');
  });
});
