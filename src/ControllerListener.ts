import { Vault, VaultHistory } from '../generated/schema';
import { loadOrCreateVault } from "./types/Vault";
import { pow } from "./utils/MathUtils";
import { BD_TEN, TWO_WEEKS_IN_SECONDS } from './utils/Constant';
import { calculateAndSaveApyAutoCompound } from "./types/Apy";
import { Address, BigInt } from '@graphprotocol/graph-ts';
import { loadOrCreateStrategy } from "./types/Strategy";
import { loadOrCreateSharePrice } from "./types/SharePrice";
import { AddVaultAndStrategyCall, SharePriceChangeLog } from '../generated/Storage/ControllerContract';
import { createUserBalance } from './types/UserBalance';
import { handlerLogic } from './debug/HandlerCalculator';
import { createTvl } from './types/Tvl';


export function handleSharePriceChangeLog(event: SharePriceChangeLog): void {
  // handlerLogic(event.address.toHexString(), 'SharePriceChangeLog', event.transaction, event.block);

  const vaultAddress = event.params.vault.toHex();
  const strategyAddress = event.params.strategy.toHex();
  const block = event.block.number;
  const timestamp = event.block.timestamp;

  const sharePrice = loadOrCreateSharePrice(
    `${event.transaction.hash.toHex()}-${vaultAddress}`,
    event.params.oldSharePrice,
    event.params.newSharePrice,
    vaultAddress,
    strategyAddress,
    timestamp,
    block
  )

  const vault = Vault.load(vaultAddress)
  if (vault != null) {
    const lastShareTimestamp = vault.lastShareTimestamp
    const lastSharePrice = vault.lastSharePrice;
    if (!lastShareTimestamp.isZero()) {
      const diffSharePrice = sharePrice.newSharePrice.minus(lastSharePrice).divDecimal(pow(BD_TEN, vault.decimal.toI32()))
      const diffTimestamp = timestamp.minus(lastShareTimestamp)
      vault.lastDiffSharePrice = diffSharePrice
      vault.lastDiffTimestamp = diffTimestamp.toBigDecimal()
      const apy = calculateAndSaveApyAutoCompound(`${event.transaction.hash.toHex()}-${vaultAddress}`, diffSharePrice, diffTimestamp, vault, event.block)
    }
    vault.lastShareTimestamp = sharePrice.timestamp
    vault.lastSharePrice = sharePrice.newSharePrice
    vault.save()

    const vaultHistoryId = `${event.transaction.hash.toHexString()}-${vaultAddress}`
    let vaultHistory = VaultHistory.load(vaultHistoryId)
    if (!vaultHistory) {
      vaultHistory = new VaultHistory(vaultHistoryId);
      vaultHistory.vault = vault.id;
      vaultHistory.sharePrice = vault.lastSharePrice;
      vaultHistory.sharePriceDec = vault.lastSharePrice.divDecimal(pow(BD_TEN, vault.decimal.toI32()))
      vaultHistory.priceUnderlying = vault.priceUnderlying;
      vaultHistory.timestamp = event.block.timestamp;
      vaultHistory.save();
    }
    createTvl(event.params.vault, event.block, event.transaction)
  }
}

export function handleAddVaultAndStrategy(call: AddVaultAndStrategyCall): void {
  const vaultAddress = call.inputs._vault;
  const strategyAddress = call.inputs._strategy;
  const block = call.block;

  loadOrCreateStrategy(strategyAddress, block)
  loadOrCreateVault(vaultAddress, block, strategyAddress.toHex())
}

