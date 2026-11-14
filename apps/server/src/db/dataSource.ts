import { DataSource } from 'typeorm';
import { AlertEntity } from '../alerts/alertEntity.js';
import { WatchlistEntity, WatchlistSymbolEntity } from '../watchlist/watchlistEntities.js';
import { CreateWatchlistAndAlerts1794666118964 } from './migrations/1794666118964-CreateWatchlistAndAlerts.js';

/**
 * The PostgreSQL connection. Entities and migrations are listed explicitly rather than found by file
 * pattern, so the compiled server and the tests load exactly the same set.
 */
export function createDataSource(databaseUrl: string): DataSource {
  return new DataSource({
    type: 'postgres',
    url: databaseUrl,
    applicationName: 'aperture-server',
    connectTimeoutMS: 3000,
    entities: [WatchlistEntity, WatchlistSymbolEntity, AlertEntity],
    migrations: [CreateWatchlistAndAlerts1794666118964],
    // ** The schema changes only through migrations, never by syncing it to the entities.
    synchronize: false,
    logging: false,
  });
}
