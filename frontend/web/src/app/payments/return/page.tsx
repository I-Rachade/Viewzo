"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { formatFcfa, PaymentView, walletApi } from "@/lib/api";

// Where the payment provider sends the user back after its checkout.
export default function PaymentReturnPage() {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <PaymentStatus />
    </Suspense>
  );
}

function PaymentStatus() {
  const reference = useSearchParams().get("reference");
  const [payment, setPayment] = useState<PaymentView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!reference) return;
    let timer: ReturnType<typeof setTimeout>;
    let tries = 0;
    const check = () =>
      walletApi
        .payment(reference)
        .then((p) => {
          setPayment(p);
          // The provider can take a moment to confirm.
          if (p.status === "PROCESSING" && ++tries < 40) {
            timer = setTimeout(check, 3000);
          }
        })
        .catch((e) => setError((e as Error).message));
    check();
    return () => clearTimeout(timer);
  }, [reference]);

  const back = payment?.campaignId ? "/campaigns" : "/wallet";

  return (
    <div className="card">
      <h1>Paiement</h1>
      {!reference && <p className="error">Référence de paiement manquante.</p>}
      {error && <p className="error">{error}</p>}
      {reference && !payment && !error && <p>Vérification du paiement…</p>}
      {payment?.status === "PROCESSING" && (
        <p>
          Paiement de {formatFcfa(payment.amount)} en cours de confirmation.
          Valide la demande sur ton téléphone si ce n’est pas encore fait.
        </p>
      )}
      {payment?.status === "SUCCEEDED" && (
        <span className="done" aria-hidden="true">
          ✓
        </span>
      )}
      {payment?.status === "SUCCEEDED" && (
        <p>
          Paiement de {formatFcfa(payment.amount)} reçu
          {payment.campaignId ? ", ta campagne est financée." : "."}
        </p>
      )}
      {payment?.status === "FAILED" && (
        <p className="error">
          Le paiement n’a pas abouti
          {payment.failureReason ? ` (${payment.failureReason})` : ""}.
        </p>
      )}
      <Link className="button" href={back}>
        Continuer
      </Link>
    </div>
  );
}
