import { MAX_REALTIME_MESSAGE_BYTES, REALTIME_PATH } from '@aperture/shared/realtime';
import fastifyWebsocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import { ApiHttpError } from '../http/errors.js';
import type { RealtimeHub } from './realtimeHub.js';

/**
 * Pages allowed to open the realtime connection: the app's dev server and the packaged app, which loads
 * from a file. A request without an Origin header comes from a non-browser client and is allowed too.
 */
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'file://',
]);

/**
 * The realtime WebSocket at `REALTIME_PATH`. Browsers let any web page open a WebSocket to localhost, so
 * connections from other pages are refused before the upgrade, keeping market data and alerts private to
 * the app. Messages larger than `MAX_REALTIME_MESSAGE_BYTES` close the connection.
 */
export function registerRealtimeRoutes(app: FastifyInstance, hub: RealtimeHub): void {
  void app.register(fastifyWebsocket, { options: { maxPayload: MAX_REALTIME_MESSAGE_BYTES } });
  // ** The route needs the plugin loaded first; registering it as a plugin of its own queues it after.
  void app.register((instance, _options, done) => {
    instance.get(
      REALTIME_PATH,
      {
        websocket: true,
        preValidation: (request, _reply, next) => {
          const { origin } = request.headers;
          if (origin !== undefined && !ALLOWED_ORIGINS.has(origin)) {
            next(new ApiHttpError('FORBIDDEN', 'This page may not open the realtime connection.'));
            return;
          }
          next();
        },
      },
      (socket) => {
        hub.attach(socket);
      },
    );
    done();
  });
}
