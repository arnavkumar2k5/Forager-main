import crypto from "node:crypto";
import { ScoutNotification, NotificationUrgency } from "@repo/types";
import { env } from "@repo/config-env";
import { saveNotificationSafe } from "../persistence/notifications";
import { server } from "../server";

export interface SendNotificationParams {
  scoutId: string;
  executionId?: string;
  title: string;
  message: string;
  urgency?: NotificationUrgency;
  recipientEmail?: string;
}

export async function sendNotification(params: SendNotificationParams): Promise<ScoutNotification> {
  const notification: ScoutNotification = {
    id: crypto.randomUUID(),
    scoutId: params.scoutId,
    executionId: params.executionId || null,
    title: params.title,
    message: params.message,
    urgency: params.urgency || "medium",
    read: false,
    createdAt: new Date().toISOString(),
  };

  const result = await saveNotificationSafe(notification);
  if (!result.success && result.warning) {
    server.log.warn({ warning: result.warning, notificationId: notification.id }, "Notification recorded with storage fallback");
  } else {
    server.log.info({ notificationId: notification.id, scoutId: params.scoutId, title: params.title }, "Autonomous scout notification dispatched");
  }

  const targetEmail = params.recipientEmail || env.NOTIFICATION_RECIPIENT_EMAIL;
  if (targetEmail && env.RESEND_API_KEY) {
    try {
      const fromEmail = env.NOTIFICATION_FROM_EMAIL || "onboarding@resend.dev";
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [targetEmail],
          subject: params.title,
          html: `<div style="font-family:sans-serif;padding:16px;">
            <h2 style="color:#0969da;margin-bottom:8px;">${params.title}</h2>
            <p style="color:#24292f;font-size:14px;line-height:1.5;">${params.message}</p>
            <hr style="border:none;border-top:1px solid #d0d7de;margin:16px 0;" />
            <p style="color:#57606a;font-size:12px;">Forager Autonomous Research Agent · Scout ${params.scoutId}</p>
          </div>`,
        }),
      });

      if (!resendRes.ok) {
        server.log.warn({ status: resendRes.status, recipientEmail: targetEmail }, "Resend email dispatch returned non-ok response");
      } else {
        server.log.info({ recipientEmail: targetEmail, scoutId: params.scoutId }, "Email digest successfully dispatched to recipient");
      }
    } catch (emailErr) {
      server.log.warn({ err: emailErr, recipientEmail: targetEmail }, "Failed to send external email dispatch via Resend");
    }
  } else if (targetEmail) {
    server.log.info(
      { notificationId: notification.id, scoutId: params.scoutId, title: params.title, recipientEmail: targetEmail },
      "Scout notification logged for recipient dispatch (configure RESEND_API_KEY for live SMTP delivery)"
    );
  }

  return notification;
}
