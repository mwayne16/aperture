import { DEFAULT_ALERT_EVENTS_LIMIT, type AlertEventList, type AlertList } from '@aperture/shared/alerts';
import type { FastifyInstance } from 'fastify';
import { validateRequest } from '../http/validateRequest.js';
import { AlertEventsQuery, AlertIdParams, CreateAlertBody, UpdateAlertBody } from './alertDtos.js';
import type { AlertService } from './alertService.js';

export function registerAlertRoutes(app: FastifyInstance, alerts: AlertService): void {
  app.get('/alerts', async (): Promise<AlertList> => ({ alerts: await alerts.list() }));

  app.get<{ Querystring: AlertEventsQuery }>(
    '/alerts/events',
    { preHandler: validateRequest({ query: AlertEventsQuery }) },
    async (request): Promise<AlertEventList> => ({
      events: await alerts.listEvents(request.query.limit ?? DEFAULT_ALERT_EVENTS_LIMIT),
    }),
  );

  app.post<{ Body: CreateAlertBody }>(
    '/alerts',
    { preHandler: validateRequest({ body: CreateAlertBody }) },
    async (request, reply) => reply.code(201).send(await alerts.create(request.body)),
  );

  app.patch<{ Params: AlertIdParams; Body: UpdateAlertBody }>(
    '/alerts/:id',
    { preHandler: validateRequest({ params: AlertIdParams, body: UpdateAlertBody }) },
    (request) => alerts.update(request.params.id, request.body),
  );

  app.delete<{ Params: AlertIdParams }>(
    '/alerts/:id',
    { preHandler: validateRequest({ params: AlertIdParams }) },
    async (request, reply) => {
      await alerts.delete(request.params.id);
      return reply.code(204).send();
    },
  );
}
