import * as Cloudflare from "@alchemy.run/cloudflare";

export const Database = Cloudflare.D1.Database("StatusDatabase", {
  migrations: "./migrations",
});
