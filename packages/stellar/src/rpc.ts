import { NoirAgentClient, parseContractError, toCall } from "@noirx402/agent-sdk";
import type { NoirOperation } from "@noirx402/agent-sdk";
import { BASE_FEE, Contract, TransactionBuilder } from "@stellar/stellar-sdk";

/** SDK 0.3.0's reads and encoder work on Stellar 17; its envelope helpers use v16 names. */
export class PreparedNoirClient extends NoirAgentClient {
  override async prepare(source: string, op: NoirOperation): Promise<string> {
    const { contract, method, args } = toCall(source, op);
    const account = await this.server.getAccount(source);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: this.config.networkPassphrase })
      .addOperation(new Contract(this.contracts[contract]).call(method, ...args))
      .setTimeout(300).build();
    try {
      return (await this.server.prepareTransaction(tx)).toXdr();
    } catch (error) {
      throw parseContractError(contract, method, error instanceof Error ? error.message : String(error)) ?? error;
    }
  }
}
