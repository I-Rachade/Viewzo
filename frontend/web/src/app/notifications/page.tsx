"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { notificationsApi, NotificationView } from "@/lib/api";
import { LoadingCard } from "../loading-card";
import { useRequireUser, useSession } from "../_shell/session";

const DATE = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

// Notification links name app screens; these are their web pages.
const WEB_LINKS: Record<string, string> = {
  "/taches": "/resultats",
  "/resultats": "/resultats",
  "/wallet": "/wallet",
  "/comptes": "/comptes",
  "/identite": "/identite",
  "/campaigns": "/campaigns",
};

function webLink(link: string | null) {
  if (!link) return null;
  if (link.startsWith("/campaigns/")) return link;
  return WEB_LINKS[link] ?? null;
}

export default function NotificationsPage() {
  const user = useRequireUser();
  const { refreshUnread } = useSession();
  const [items, setItems] = useState<NotificationView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        const list = await notificationsApi.list();
        setItems(list.items);
        // Opening the page reads them all; the dots stay until the next visit.
        if (list.unread) {
          await notificationsApi.read();
          refreshUnread();
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [user, refreshUnread]);

  if (!items) return error ? <p className="error">{error}</p> : <LoadingCard />;

  return (
    <div className="card wide">
      <h1>Notifications</h1>
      {items.length === 0 && <p>Rien de nouveau pour l’instant.</p>}
      {items.map((n) => {
        const href = webLink(n.link);
        const body = (
          <>
            <strong>{n.title}</strong>
            <span>{n.body}</span>
            <small>{DATE.format(new Date(n.createdAt))}</small>
          </>
        );
        const className = `notification${n.readAt ? "" : " unread"}`;
        return href ? (
          <Link key={n.id} href={href} className={className}>
            {body}
          </Link>
        ) : (
          <div key={n.id} className={className}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
