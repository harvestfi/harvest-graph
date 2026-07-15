import { createIFarmUserBalance, createUserBalance } from "./types/UserBalance";
import { Transfer } from '../generated/Storage/ERC20';
import { handlerLogic } from './debug/HandlerCalculator';

export function handleTransfer(event: Transfer): void {
  // handlerLogic(event.address.toHexString(), 'Transfer', event.transaction, event.block);
  createIFarmUserBalance(event.address, event.params.from, event.transaction, event.block, false, event.params.value, event.transaction.from.toHexString())
  createIFarmUserBalance(event.address, event.params.to, event.transaction, event.block, true, event.params.value, event.transaction.from.toHexString())
}