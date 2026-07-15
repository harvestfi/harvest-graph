import { SetControllerCall } from "../generated/Storage/StorageContract";
import { loadOrCreateController } from "./types/Controller";
import { Address, BigDecimal, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { getVaultUtils, loadOrCreateVault } from './types/Vault';
import { getPriceByVault } from './utils/PriceUtils';
import { ApyAutoCompound, GeneralApy, PriceHistory, Tvl, VaultHistory } from '../generated/schema';
import { BD_TEN, BI_EVERY_24_HOURS } from "./utils/Constant";
import { pow } from "./utils/MathUtils";
import { tvlSequenceId } from "./types/Tvl";

export function handleSetController(call: SetControllerCall): void {
  const controller = loadOrCreateController(call.inputs._controller, call.block)
}

export function handleBlock(block: ethereum.Block): void {
  const vaultUtils = getVaultUtils();
  for (let i = 0; i < vaultUtils.vaults.length; i++) {
    const vault = loadOrCreateVault(Address.fromString(vaultUtils.vaults[i]), block);
    const price = getPriceByVault(vault, block);

    const priceHistoryId = `${vault.id}-${block.number.toString()}`
    let priceHistory = PriceHistory.load(priceHistoryId)
    if (!priceHistory) {
      priceHistory = new PriceHistory(priceHistoryId);
      priceHistory.vault = vault.id
      priceHistory.price = price;
      priceHistory.createAtBlock = block.number
      priceHistory.timestamp = block.timestamp
      priceHistory.save();
    }

    if (vault.lastVaultSnapshotTs && (vault.lastVaultSnapshotTs!.equals(BigInt.zero()) || vault.lastVaultSnapshotTs!.plus(BI_EVERY_24_HOURS).lt(block.timestamp))) {
      const vaultHistoryId = `${block.number.toHex()}-${vault.id}`
      let tvl = Tvl.load(vaultHistoryId)
      if (tvl == null) {
        tvl = new Tvl(vaultHistoryId)
        tvl.vault = vault.id
        tvl.totalSupply = (vault.lastTotalSupply ? vault.lastTotalSupply! : BigInt.zero())
        tvl.value = vault.tvl
        tvl.priceUnderlying = vault.priceUnderlying
        tvl.sharePrice = vault.lastSharePrice
        tvl.tvlSequenceId = vault.tvlSequenceId
        tvl.sequenceId = tvlSequenceId(vault.id).lastSequenceId
        tvl.timestamp = block.timestamp
        tvl.createAtBlock = block.number
        tvl.save()

        vault.tvlSequenceId = vault.tvlSequenceId + 1
      }

      let vaultHistory = VaultHistory.load(vaultHistoryId)
      if (vaultHistory == null) {
        vaultHistory = new VaultHistory(vaultHistoryId)
        vaultHistory.vault = vault.id
        vaultHistory.sharePrice = vault.lastSharePrice
        vaultHistory.sharePriceDec = vault.lastSharePrice.divDecimal(pow(BD_TEN, vault.decimal.toI32()))
        vaultHistory.priceUnderlying = vault.priceUnderlying
        vaultHistory.timestamp = block.timestamp
        vaultHistory.save()
      }

      let apyAutoCompound = ApyAutoCompound.load(vaultHistoryId)
      if (apyAutoCompound == null) {
        apyAutoCompound = new ApyAutoCompound(vaultHistoryId)
        apyAutoCompound.vault = vault.id
        apyAutoCompound.apy = vault.apyAutoCompound
        apyAutoCompound.apr = (vault.lastApr ? vault.lastApr! : BigDecimal.zero()) as BigDecimal
        apyAutoCompound.diffSharePrice = (vault.lastDiffSharePrice ? vault.lastDiffSharePrice! : BigDecimal.zero()) as BigDecimal
        apyAutoCompound.timestamp = block.timestamp
        apyAutoCompound.createAtBlock = block.number
        apyAutoCompound.save()
      }

      let generalApy = GeneralApy.load(vaultHistoryId)
      if (generalApy == null) {
        generalApy = new GeneralApy(vaultHistoryId)
        generalApy.vault = vault.id
        generalApy.apy = vault.apy
        generalApy.apyAutoCompound = vault.apyAutoCompound
        generalApy.apyReward = vault.apyReward
        generalApy.timestamp = block.timestamp
        generalApy.createAtBlock = block.number
        generalApy.save()
      }
      vault.lastVaultSnapshotTs = block.timestamp
    }

    vault.priceUnderlying = price
    vault.save();
  }
}