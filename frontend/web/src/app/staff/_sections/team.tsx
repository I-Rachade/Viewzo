"use client";

import { FormEvent, useState } from "react";
import { staffApi } from "@/lib/api";
import { DATE, useQueue } from "./use-queue";

export function TeamSection({ selfId }: { selfId: string }) {
  const queue = useQueue(staffApi.members, () => {});
  const [phone, setPhone] = useState("");

  function add(e: FormEvent) {
    e.preventDefault();
    queue.act(async () => {
      await staffApi.addMember(phone);
      setPhone("");
    });
  }

  return (
    <>
      <form className="row" onSubmit={add}>
        <label>
          Numéro du nouveau membre
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+228 90 00 00 00"
            required
          />
        </label>
        <button disabled={queue.busy}>Ajouter</button>
      </form>
      <p className="hint">La personne doit s’être connectée une fois.</p>
      {queue.error && <p className="error">{queue.error}</p>}
      {queue.items?.map((m) => (
        <div key={m.id} className="line">
          <span>
            {m.phone}
            <br />
            <small>
              {m.country} · inscrit le {DATE.format(new Date(m.createdAt))}
            </small>
          </span>
          {m.id === selfId ? (
            <small>Toi</small>
          ) : (
            <button
              className="secondary"
              disabled={queue.busy}
              onClick={() => queue.act(() => staffApi.removeMember(m.id))}
            >
              Retirer
            </button>
          )}
        </div>
      ))}
    </>
  );
}
