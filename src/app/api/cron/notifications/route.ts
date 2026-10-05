import { timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { adminClient } from "@/lib/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.NOTIFICATION_WORKER_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  return !!secret && actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let phase = "admin-client";
  try {
    const admin = adminClient(true);
    phase = "scheduled-messages";
    const { data: schedule, error: scheduleError } = await admin.rpc("process_due_messages", {
      p_now: new Date().toISOString(),
      p_limit: 100,
    });
    if (scheduleError) throw new Error(scheduleError.message);

    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
    const vapidSubject = process.env.VAPID_SUBJECT;
    if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject)
      return Response.json({ schedule, pushConfigured: false, accepted: 0, retried: 0 }, { headers: { "Cache-Control": "no-store" } });

    phase = "push-queue";
    const { error: queueError } = await admin.rpc("queue_notification_pushes");
    if (queueError) throw new Error(queueError.message);
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    phase = "push-attempts";
    const { data: rawAttempts, error: claimError } = await admin.rpc("claim_push_attempts", { p_limit: 100 });
    if (claimError) throw new Error(claimError.message);
    const attempts = rawAttempts as unknown as Array<{ attempt_id: string; lease_id: string; notification_id: string; endpoint: string; p256dh: string; auth_secret: string; title: string; body: string }>;
    let accepted = 0;
    let retried = 0;
    await Promise.all((attempts ?? []).map(async (attempt) => {
      try {
        await webpush.sendNotification(
          { endpoint: attempt.endpoint, keys: { p256dh: attempt.p256dh, auth: attempt.auth_secret } },
          JSON.stringify({ title: attempt.title, body: attempt.body, url: `/notifications?notification=${encodeURIComponent(attempt.notification_id)}`, notificationId: attempt.notification_id }),
          { TTL: 300, urgency: "normal" },
        );
        const { error } = await admin.rpc("finish_push_attempt", {
          p_attempt: attempt.attempt_id,
          p_lease: attempt.lease_id,
          p_error: null,
          p_expired: false,
        });
        if (error) throw new Error(error.message);
        accepted++;
      } catch (error) {
        const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : 0;
        const { error: finishError } = await admin.rpc("finish_push_attempt", {
          p_attempt: attempt.attempt_id,
          p_lease: attempt.lease_id,
          p_error: error instanceof Error ? error.message : "Push delivery failed",
          p_expired: statusCode === 404 || statusCode === 410,
        });
        if (finishError) throw new Error(finishError.message);
        retried++;
      }
    }));
    return Response.json({ schedule, pushConfigured: true, claimed: attempts?.length ?? 0, accepted, retried }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[notifications] worker failed", { phase, error: error instanceof Error ? error.message : "Unknown failure" });
    return Response.json({ error: "Notification delivery is queued for retry" }, { status: 503 });
  }
}
