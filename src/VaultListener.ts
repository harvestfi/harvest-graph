import { createTvl } from "./types/Tvl";
import { createUserBalance } from './types/UserBalance';
import { Transfer } from '../generated/Storage/ERC20';
import { Invest } from '../generated/Storage/VaultContract';
import { handlerLogic } from './debug/HandlerCalculator';
import { Vault } from '../generated/schema';
import { isFarmContract, isIFarm } from './utils/PlatformUtils';

export function handleTransfer(event: Transfer): void {
  createTvl(event.address, event.block, event.transaction)

  const vault = Vault.load(event.address.toHex());
  if (vault) {
    if (!isFarmContract(vault.id)) {
      createUserBalance(event.address, event.params.value, event.params.from, event.transaction, event.block, false, event.transaction.from.toHexString())
      createUserBalance(event.address, event.params.value, event.params.to, event.transaction, event.block, true, event.transaction.from.toHexString())
    }
  }
}