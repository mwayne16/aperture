// The data source the TypeORM CLI uses for migration commands (scripts/typeorm.mjs).
import 'reflect-metadata';
import { loadConfig } from '../config/loadConfig.js';
import { createDataSource } from './dataSource.js';

export default createDataSource(loadConfig(process.env).databaseUrl);
