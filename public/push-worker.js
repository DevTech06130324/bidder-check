self.addEventListener("push", (event) => {
  if (!event.data) return;
  let message;
  try {
    message = event.data.json();
  } catch {
    message = { title: "Bidder Check", body: event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(message.title || "Bidder Check", {
      body: message.body || "You have a new message.",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: message.notificationId || "bidder-check-message",
      data: { url: message.url || "/notifications" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/notifications", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
      return existing ? existing.navigate(target).then(() => existing.focus()) : self.clients.openWindow(target);
    }),
  );
});
