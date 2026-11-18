import { FastifyInstance } from "fastify";
import { CreateNotificationRequestSchema } from "@repo/types";
import { getNotificationsSafe, markNotificationReadSafe } from "../persistence/notifications";
import { sendNotification } from "../services/notifications";

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/v1/scout/:id/notifications", async (request, reply) => {
    const { id: scoutId } = request.params;
    const { notifications, source, warning } = await getNotificationsSafe(scoutId);
    return reply.status(200).send({
      scoutId,
      notifications,
      source,
      warning,
      count: notifications.length,
      unreadCount: notifications.filter((n) => !n.read).length,
    });
  });

  app.post<{ Body: unknown }>("/api/v1/notifications", async (request, reply) => {
    const parsed = CreateNotificationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation error",
        details: parsed.error.issues,
      });
    }

    const notification = await sendNotification(parsed.data);
    return reply.status(201).send(notification);
  });

  app.post<{ Params: { id: string } }>("/api/v1/notifications/:id/read", async (request, reply) => {
    const { id } = request.params;
    const { success, warning } = await markNotificationReadSafe(id);
    return reply.status(200).send({ success, warning, id });
  });
}
