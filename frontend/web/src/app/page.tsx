import Link from "next/link";

import { Logo } from "./logo";

export default function Home() {
  return (
    <div className="hero">
      <Logo size={152} tile={false} animated />
      <div>
        <h1 className="rise" style={{ animationDelay: "700ms" }}>
          Viewzo
        </h1>
        <p className="promise rise" style={{ animationDelay: "880ms" }}>
          Tes vues, payées. Partout dans le monde.
        </p>
      </div>
      <p className="rise" style={{ animationDelay: "1000ms" }}>
        Les annonceurs achètent des vues, les créateurs publient sur leurs
        réseaux et sont payés. Les premiers inscrits passent devant.
      </p>
      <Link
        className="button coral rise"
        href="/login"
        style={{ animationDelay: "1150ms" }}
      >
        Commencer à gagner
      </Link>
    </div>
  );
}
