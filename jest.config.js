module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/apps'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: ['node_modules', '.claude/worktrees'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        target: 'ES2020',
        module: 'commonjs',
        lib: ['ES2020'],
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        moduleResolution: 'node',
        allowSyntheticDefaultImports: true,
        baseUrl: '<rootDir>',
        paths: {
          '@/*': ['apps/api/*'],
          '@api/*': ['apps/api/*'],
          '@core/*': ['core/*'],
          '@agents/*': ['agents/*'],
          '@tools/*': ['tools/*']
        }
      }
    }]
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/apps/api/$1',
    '^@api/(.*)$': '<rootDir>/apps/api/$1',
    '^@core/(.*)$': '<rootDir>/core/$1',
    '^@agents/(.*)$': '<rootDir>/agents/$1',
    '^@tools/(.*)$': '<rootDir>/tools/$1'
  },
  collectCoverageFrom: [
    'apps/api/**/*.ts',
    '!apps/api/**/*.test.ts',
    '!apps/api/**/__tests__/**'
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node']
};
