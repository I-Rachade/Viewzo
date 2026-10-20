import { ReactNode } from "react";
import { Logo } from "../logo";

// Sign-in screens: the dark Viewzo header, the form on a sheet below it.
export function AuthScreen({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="auth">
      <header className="auth-head">
        <Logo size={64} tile={false} />
        <strong>Viewzo</strong>
        <p>Tes vues, payées. Partout dans le monde.</p>
      </header>
      <div className="auth-sheet">
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}
