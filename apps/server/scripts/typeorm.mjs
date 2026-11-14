// Runs a TypeORM CLI command against the compiled data source, with the repository .env loaded.
// Usage: node scripts/typeorm.mjs migration:run | migration:revert | migration:generate src/db/migrations/<Name>
import { existsSync } from 'node:fs';

const envFile = new URL('../../../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const [command, ...rest] = process.argv.slice(2);
process.argv = [process.argv[0], 'typeorm', command, '--dataSource', 'dist/db/cliDataSource.js', ...rest];
await import('typeorm/cli.js');
