import Link from "next/link";

export default function Home() {
  return (
    <div className="card">
      <h1>Viewzo</h1>
      <p>
        Les annonceurs achètent des vues, les créateurs publient sur leurs
        réseaux et sont payés. Les premiers inscrits passent devant.
      </p>
      <Link className="button" href="/login">
        Se connecter
      </Link>
    </div>
  );
}
