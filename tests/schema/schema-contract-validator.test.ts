import { SchemaContractValidator } from '../../apps/api/services/schema-contract-validator';

describe('SchemaContractValidator', () => {
  let validator: SchemaContractValidator;
  let mockPool: any;

  beforeEach(() => {
    mockPool = {
      query: jest.fn().mockResolvedValue({ rows: [{}] }),
    };
    validator = new SchemaContractValidator(mockPool);
  });

  test('fails when table is missing', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // First table check fails

    await expect(validator.validate()).rejects.toThrow('Schema contract validation failed');
  });

  test('fails when migration is missing', async () => {
    // All other checks pass by default mockResolvedValue
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes('schema_migrations')) {
        return Promise.resolve({ rows: [{ max_version: 113 }] }); // Old migration
      }
      return Promise.resolve({ rows: [{}] });
    });

    await expect(validator.validate()).rejects.toThrow('Schema contract validation failed');
  });

  test('passes when all contracts are valid', async () => {
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes('schema_migrations')) {
        return Promise.resolve({ rows: [{ max_version: 115 }] });
      }
      return Promise.resolve({ rows: [{}] });
    });

    await expect(validator.validate()).resolves.toBeUndefined();
  });
});
