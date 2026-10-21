import { CampaignBrief, CONTENT_CASE_LABELS } from "@/lib/api";

const KIND_LABELS = {
  IMAGE: "image",
  VIDEO: "vidéo",
  AUDIO: "audio",
  PDF: "PDF",
} as const;

// The brief as creators read it: content, message, files and links.
export function BriefView({ brief }: { brief: CampaignBrief }) {
  const assets = brief.files.filter((f) => f.purpose === "ASSET");
  const spoken = brief.files.filter((f) => f.purpose === "BRIEF");
  const rows: [string, string | null][] = [
    ["Message clé", brief.keyMessage],
    ["Appel à l’action", brief.callToAction],
    ["Légende", brief.caption],
    ["Son", brief.sound],
    ["Produit", brief.productDetails],
  ];
  return (
    <div className="brief">
      <p>
        <strong>{CONTENT_CASE_LABELS[brief.contentCase].title}</strong>
        {brief.contentCase === "NONE" &&
          (brief.noAssetsChoice === "STUDIO"
            ? " · créé par le Studio Viewzo"
            : " · créé par les créateurs")}
      </p>
      {rows
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <p key={label}>
            {label} : {value}
          </p>
        ))}
      {spoken.map((f) => (
        <div key={f.id}>
          Brief {f.kind === "AUDIO" ? "vocal" : "vidéo"} :
          {f.kind === "AUDIO" ? (
            <audio controls preload="none" src={f.url} />
          ) : (
            <video controls preload="none" src={f.url} width={240} />
          )}
        </div>
      ))}
      {(assets.length > 0 || brief.assetUrls.length > 0) && (
        <ul className="files">
          {assets.map((f) => (
            <li key={f.id}>
              <a href={f.url} target="_blank" rel="noreferrer">
                {f.name}
              </a>{" "}
              <small>{KIND_LABELS[f.kind]}</small>
            </li>
          ))}
          {brief.assetUrls.map((url, i) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noreferrer">
                Lien {i + 1}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
