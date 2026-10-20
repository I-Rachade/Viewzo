"use client";

import { FormEvent, useState } from "react";
import {
  contactOf,
  MemberRights,
  STAFF_ROLE_LABELS,
  staffApi,
  StaffMember,
  StaffRole,
} from "@/lib/api";
import { CountryMultiSelect, flagOf } from "../../country-select";
import { confirmed } from "./confirm";
import { DATE, useQueue } from "./use-queue";

const ROLES = Object.keys(STAFF_ROLE_LABELS) as StaffRole[];

function RightsFields({
  role,
  countries,
  onRole,
  onCountries,
}: {
  role: StaffRole;
  countries: string[];
  onRole: (role: StaffRole) => void;
  onCountries: (codes: string[]) => void;
}) {
  return (
    <>
      <label>
        Rôle
        <select value={role} onChange={(e) => onRole(e.target.value as StaffRole)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {STAFF_ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      {role !== "SUPER_ADMIN" && (
        <label>
          Pays
          <CountryMultiSelect
            value={countries}
            onChange={onCountries}
            emptyLabel={role === "COUNTRY_MANAGER" ? "Choisir" : "Tous les pays"}
            required={role === "COUNTRY_MANAGER"}
          />
        </label>
      )}
    </>
  );
}

// Empty countries means every country.
function rights(role: StaffRole, countries: string[]): MemberRights {
  return { staffRole: role, countries: role === "SUPER_ADMIN" ? [] : countries };
}

export function TeamSection({ selfId }: { selfId: string }) {
  const queue = useQueue(staffApi.members, () => {});
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<StaffRole>("MODERATOR");
  const [countries, setCountries] = useState<string[]>([]);

  function add(e: FormEvent) {
    e.preventDefault();
    queue.act(async () => {
      await staffApi.addMember(phone, rights(role, countries));
      setPhone("");
      setCountries([]);
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
        <RightsFields
          role={role}
          countries={countries}
          onRole={setRole}
          onCountries={setCountries}
        />
        <button disabled={queue.busy}>Ajouter</button>
      </form>
      <p className="hint">
        La personne doit s’être connectée une fois. Chacun ne voit que ses pays
        et ne décide jamais sur ses propres comptes ou retraits.
      </p>
      {queue.error && <p className="error">{queue.error}</p>}
      {queue.items?.map((m) => (
        <MemberLine
          key={m.id}
          member={m}
          self={m.id === selfId}
          busy={queue.busy}
          onSave={(r) => queue.act(() => staffApi.updateMember(m.id, r))}
          onRemove={() => {
            if (!confirmed(`Retirer ${contactOf(m)} de l’équipe ? Ses sessions se ferment aussitôt.`)) {
              return;
            }
            queue.act(() => staffApi.removeMember(m.id));
          }}
        />
      ))}
    </>
  );
}

function MemberLine({
  member: m,
  self,
  busy,
  onSave,
  onRemove,
}: {
  member: StaffMember;
  self: boolean;
  busy: boolean;
  onSave: (rights: MemberRights) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState(m.staffRole);
  const [countries, setCountries] = useState(m.staffCountries);
  const scope = m.staffCountries.length
    ? m.staffCountries.map(flagOf).join(" ")
    : "tous les pays";

  if (editing) {
    return (
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(rights(role, countries));
          setEditing(false);
        }}
      >
        <span>{contactOf(m)}</span>
        <RightsFields
          role={role}
          countries={countries}
          onRole={setRole}
          onCountries={setCountries}
        />
        <button disabled={busy}>Enregistrer</button>
        <button type="button" className="secondary" onClick={() => setEditing(false)}>
          Annuler
        </button>
      </form>
    );
  }

  return (
    <div className="line">
      <span>
        {contactOf(m)}
        <br />
        <small>
          {STAFF_ROLE_LABELS[m.staffRole]} · {scope} · inscrit le{" "}
          {DATE.format(new Date(m.createdAt))}
        </small>
      </span>
      {self ? (
        <small>Toi</small>
      ) : (
        <span className="actions">
          <button className="secondary" disabled={busy} onClick={() => setEditing(true)}>
            Modifier
          </button>
          <button className="secondary" disabled={busy} onClick={onRemove}>
            Retirer
          </button>
        </span>
      )}
    </div>
  );
}
