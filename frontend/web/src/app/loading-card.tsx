// Shimmering placeholder lines shown while a page fetches its data.
export function LoadingCard() {
  return (
    <div className="card" aria-busy="true" aria-label="Chargement">
      <div className="skeleton" style={{ width: "60%" }} />
      <div className="skeleton" />
      <div className="skeleton" style={{ width: "40%" }} />
    </div>
  );
}
