import { inspectLaunch } from "../src/index.mjs";
import { hash, fixtureClient } from "./fixture.mjs";

// Fully synthetic. No wallet, RPC endpoint or blockchain transaction is contacted.
console.log(JSON.stringify(await inspectLaunch(hash, fixtureClient()), null, 2));
