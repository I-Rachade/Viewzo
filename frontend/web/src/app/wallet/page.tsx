"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import {
  formatFcfa,
  getToken,
  PAYMENT_STATUS_LABELS,
  PaymentView,
  TRANSACTION_LABELS,
  walletApi,
  WalletSummary,
  WalletTransaction,
} from "@/lib/api";

const DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });

function fetchAll() {
  return Promise.all([
    walletApi.summary(),
    walletApi.transactions(),
    walletApi.withdrawals(),
  ]);
}

export default function WalletPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [history, setHistory] = useState<WalletTransaction[]>([]);
  const [withdrawals, setWithdrawals] = useState<PaymentView[]>([]);
  const [depositAmount, setDepositAmount] = useState(10000);
  const [amount, setAmount] = useState(0);
  const [name, setName] = useState("");
  const [operator, setOperator] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function show([s, h, w]: Awaited<ReturnType<typeof fetchAll>>) {
    setSummary(s);
    setHistory(h);
    setWithdrawals(w);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    fetchAll()
      .then(([s, h, w]) => {
        setSummary(s);
        setHistory(h);
        setWithdrawals(w);
      })
      .catch((e) => setError((e as Error).message));
  }, [router]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function deposit(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      const payment = await walletApi.deposit(depositAmount);
      if (payment.checkoutUrl) window.location.assign(payment.checkoutUrl);
    });
  }

  function withdraw(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      await walletApi.withdraw({
        amount,
        beneficiaryName: name,
        ...(operator ? { operator } : {}),
      });
      setMessage("Demande envoyée. L’équipe Viewzo la valide avant l’envoi.");
      setAmount(0);
      show(await fetchAll());
    });
  }

  if (!summary) {
    return error ? <p className="error">{error}</p> : <p>Chargement…</p>;
  }

  return (
    <div className="card wide">
      <h1>Mon portefeuille</h1>

      <div className="stats">
        <div>
          <small>Disponible</small>
          <strong>{formatFcfa(summary.available)}</strong>
        </div>
        <div>
          <small>Gains en attente</small>
          <strong>{formatFcfa(summary.held)}</strong>
        </div>
        <div>
          <small>En séquestre</small>
          <strong>{formatFcfa(summary.escrow)}</strong>
        </div>
        <div>
          <small>Retraits en cours</small>
          <strong>{formatFcfa(summary.pendingWithdrawals)}</strong>
        </div>
      </div>
      <p className="hint">
        Les gains du mois deviennent disponibles le 1er du mois suivant.
      </p>

      <h2>Recharger par Mobile Money</h2>
      <form className="row" onSubmit={deposit}>
        <label>
          Montant (FCFA)
          <input
            type="number"
            min={500}
            value={depositAmount || ""}
            onChange={(e) => setDepositAmount(Number(e.target.value))}
            required
          />
        </label>
        <button disabled={busy}>Recharger</button>
      </form>

      <h2>Retirer</h2>
      {summary.withdrawalsOpen ? (
        <form className="card" onSubmit={withdraw}>
          <div className="row">
            <label>
              Montant (FCFA)
              <input
                type="number"
                min={summary.minWithdrawal}
                max={summary.available}
                value={amount || ""}
                onChange={(e) => setAmount(Number(e.target.value))}
                required
              />
            </label>
            <label>
              Nom du compte Mobile Money
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Comme sur ta pièce d’identité"
                minLength={3}
                required
              />
            </label>
          </div>
          {summary.operators.length > 0 && (
            <label>
              Opérateur
              <select
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
                required
              >
                <option value="">Choisir</option>
                {summary.operators.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="hint">
            Envoyé sur ton numéro Viewzo. Minimum{" "}
            {formatFcfa(summary.minWithdrawal)}.
          </p>
          <button disabled={busy || summary.available < summary.minWithdrawal}>
            Demander le retrait
          </button>
        </form>
      ) : (
        <p>
          Les retraits s’ouvrent au niveau 2, après la vérification de ton
          identité.
        </p>
      )}
      {message && <p>{message}</p>}
      {error && <p className="error">{error}</p>}

      {withdrawals.length > 0 && (
        <>
          <h2>Mes retraits</h2>
          {withdrawals.map((w) => (
            <p key={w.id}>
              {DATE.format(new Date(w.createdAt))} · {formatFcfa(w.amount)} ·{" "}
              {PAYMENT_STATUS_LABELS[w.status]}
              {w.failureReason && ` (${w.failureReason})`}
            </p>
          ))}
        </>
      )}

      <h2>Historique</h2>
      {history.length === 0 && <p>Aucune opération pour l’instant.</p>}
      {history.map((t) => (
        <div key={t.id} className="line">
          <span>
            {TRANSACTION_LABELS[t.type]}
            {t.note && <small> · {t.note}</small>}
            <br />
            <small>
              {DATE.format(new Date(t.createdAt))}
              {t.status === "PENDING" && " · en attente"}
              {t.status === "CANCELLED" && " · annulé"}
              {t.type === "EARNING" &&
                new Date(t.availableAt) > new Date() &&
                ` · disponible le ${DATE.format(new Date(t.availableAt))}`}
            </small>
          </span>
          <strong className={t.amount < 0 ? "debit" : "credit"}>
            {t.amount > 0 ? "+" : ""}
            {formatFcfa(t.amount)}
          </strong>
        </div>
      ))}

      <Link className="button secondary" href="/dashboard">
        Tableau de bord
      </Link>
    </div>
  );
}
