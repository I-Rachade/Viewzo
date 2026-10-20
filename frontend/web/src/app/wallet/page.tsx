"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import {
  formatFcfa,
  hasSession,
  PAYMENT_STATUS_LABELS,
  PaymentView,
  TRANSACTION_LABELS,
  walletApi,
  WalletSummary,
  WalletTransaction,
} from "@/lib/api";
import { CountUp } from "../count-up";
import { LoadingCard } from "../loading-card";
import { Toast } from "../toast";

const PAYMENT_TONES: Record<PaymentView["status"], string> = {
  REQUESTED: "pending",
  PROCESSING: "pending",
  SUCCEEDED: "paid",
  FAILED: "refused",
  REJECTED: "refused",
};

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
    if (!hasSession()) {
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
    return error ? <p className="error">{error}</p> : <LoadingCard />;
  }

  return (
    <div className="card wide">
      <h1>Mon portefeuille</h1>

      <div className="balance">
        <small>Disponible</small>
        <span className="amount">
          <CountUp value={summary.available} format={formatFcfa} />
        </span>
        <div className="pills">
          <span className="pill pending">
            En attente : {formatFcfa(summary.held)}
          </span>
          {summary.escrow > 0 && (
            <span className="pill">
              En séquestre : {formatFcfa(summary.escrow)}
            </span>
          )}
          {summary.pendingWithdrawals > 0 && (
            <span className="pill neutral">
              Retraits en cours : {formatFcfa(summary.pendingWithdrawals)}
            </span>
          )}
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
        <button className="secondary" disabled={busy}>
          Recharger
        </button>
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
          <button
            className="coral"
            disabled={busy || summary.available < summary.minWithdrawal}
          >
            Demander le retrait
          </button>
        </form>
      ) : (
        <div className="card">
          <p>
            Les retraits s’ouvrent au niveau 2, après la vérification de ton
            identité : une pièce d’identité et un selfie, en quelques minutes.
          </p>
          <Link className="button" href="/identite">
            Vérifier mon identité
          </Link>
        </div>
      )}
      {message && <Toast message={message} onDone={() => setMessage(null)} />}
      {error && <p className="error">{error}</p>}

      {withdrawals.length > 0 && (
        <>
          <h2>Mes retraits</h2>
          <div className="stagger">
            {withdrawals.map((w) => (
              <div key={w.id} className="line">
                <span>
                  {formatFcfa(w.amount)}
                  <br />
                  <small>
                    {DATE.format(new Date(w.createdAt))}
                    {w.failureReason && ` · ${w.failureReason}`}
                  </small>
                </span>
                <span className={`pill ${PAYMENT_TONES[w.status]}`}>
                  {PAYMENT_STATUS_LABELS[w.status]}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <h2>Historique</h2>
      {history.length === 0 && <p>Aucune opération pour l’instant.</p>}
      <div className="stagger">
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
      </div>

      <Link className="button secondary" href="/dashboard">
        Tableau de bord
      </Link>
    </div>
  );
}
