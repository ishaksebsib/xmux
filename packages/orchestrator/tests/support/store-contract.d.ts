import { type Store } from "../../src";
export interface StoreContractSuiteInput {
    readonly name: string;
    readonly withStore: <A>(use: (store: Store) => Promise<A>) => Promise<A>;
}
export declare function registerStoreContractTests(input: StoreContractSuiteInput): void;
//# sourceMappingURL=store-contract.d.ts.map