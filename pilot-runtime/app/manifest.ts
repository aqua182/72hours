import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nightingale Pilot",
    short_name: "Nightingale",
    description: "Synthetic-data Care Note collaboration Pilot",
    start_url: "/",
    display: "standalone",
    background_color: "#f7faf9",
    theme_color: "#087f72",
  };
}
