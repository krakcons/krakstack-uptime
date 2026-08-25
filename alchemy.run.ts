import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import StatusWorker from "./src/worker.ts";
import { Database } from "./src/database.ts";

export default Alchemy.Stack(
  "KrakStatus",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const database = yield* Database;
    const worker = yield* StatusWorker;

    return {
      url: worker.url.as<string>(),
      database: database.databaseName,
    };
  }),
);
