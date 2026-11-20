import type React from "react";
import { Img, staticFile } from "remotion";

// Iris et Ilo : les mêmes images que dans le SaaS (rendu chrome liquide de jumeaux.js, capturé en haute définition)
export const Jumeaux: React.FC<{ readonly size: number; readonly gap?: number; readonly look?: number }> = ({ size, gap = 6 }) => (
  <div style={{ display: "flex", gap }}>
    {["iris", "ilo"].map((n) => (
      <Img key={n} src={staticFile(`twiin/${n}.png`)} style={{ width: size, height: size, filter: `drop-shadow(0 ${size * 0.12}px ${size * 0.18}px rgba(30,34,60,.35))` }} />
    ))}
  </div>
);
