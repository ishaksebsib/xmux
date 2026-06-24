import { createInMemoryStore } from "../src";
import { registerStoreContractTests } from "./support/store-contract";

registerStoreContractTests({
  name: "createInMemoryStore",
  withStore: (use) => use(createInMemoryStore()),
});
