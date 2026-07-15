import { Address, BigDecimal, BigInt, ethereum } from "@graphprotocol/graph-ts";
import {
  TotalTvl,
  TotalTvlCount,
  TotalTvlHistory,
  TotalTvlHistoryV2,
  Tvl, TvlCount,
  TvlSequnceId,
  Vault,
} from '../../generated/schema';
import { fetchContractDecimal, fetchContractTotalSupply } from "../utils/ERC20Utils";
import { getPriceByVault, getPriceForCoin } from "../utils/PriceUtils";
import {
  BD_18,
  BD_ZERO,
  BI_18, canCalculateTotalTvl, CONST_ID,
  EXCLUSIVE_REWARD_POOL,
  getFarmToken, I_FARM_TOKEN,
  isPsAddress, TOTAL_TVL_FROM, TVL_WARN, UNI_V3_WBTC_WETH,
} from '../utils/Constant';
import { fetchPricePerFullShare } from "../utils/VaultUtils";
import { pow } from "../utils/MathUtils";
import { canCalculateTotalTvlV2, totalTvlUp } from './TotalTvlUtils';

export function createTvl(address: Address, block: ethereum.Block, transaction: ethereum.Transaction): Tvl | null {
  const vaultAddress = address;
  const vault = Vault.load(vaultAddress.toHex())
  if (vault != null) {
    canCalculateTotalTvlV2(block);
    const id = `${transaction.hash.toHex()}-${vaultAddress.toHex()}`
    let tvl = Tvl.load(id)
    if (tvl == null) {
      tvl = new Tvl(id);

      tvl.vault = vault.id
      tvl.timestamp = block.timestamp
      tvl.createAtBlock = block.number
      let totalSupply = BigInt.zero()
      let price = BigDecimal.zero()
      let priceForVault = BigDecimal.zero()
      let sharePrice = BI_18
      tvl.sequenceId = tvlSequenceId(vault.id).lastSequenceId
      tvl.tvlSequenceId = vault.tvlSequenceId

      if (vault.id == I_FARM_TOKEN.toHexString()) {
        const tempSP = fetchPricePerFullShare(vaultAddress).divDecimal(BD_18);
        totalSupply = fetchContractTotalSupply(I_FARM_TOKEN)
        priceForVault = getPriceForCoin(getFarmToken(), block.number.toI32()).divDecimal(BD_18)
        price = priceForVault.times(tempSP);
      } else if (isPsAddress(vault.id)) {
        totalSupply = fetchContractTotalSupply(EXCLUSIVE_REWARD_POOL)
        price = getPriceForCoin(getFarmToken(), block.number.toI32()).divDecimal(BD_18)
        priceForVault = price;
      } else {
        totalSupply = fetchContractTotalSupply(vaultAddress)
        sharePrice = fetchPricePerFullShare(vaultAddress)
        price = getPriceByVault(vault, block)
        priceForVault = price;
      }

      tvl.totalSupply = totalSupply
      const decimal = BigDecimal.fromString((10 ** vault.decimal.toI64()).toString())
      const sharePriceDivDecimal = sharePrice.divDecimal(decimal)

      tvl.sharePrice = sharePrice
      tvl.priceUnderlying = price
      if (price.gt(BigDecimal.zero())) {
        tvl.value = tvl.totalSupply.toBigDecimal()
          .div(decimal)
          .times(price)
          .times(sharePriceDivDecimal)
      } else {
        tvl.value = BD_ZERO;
      }
      if (tvl.value.ge(TVL_WARN)) {
        return null;
      }
      totalTvlCount(vault.id);
      tvl.save()

      if (canCalculateTotalTvl(vault.id)) {
        // createTotalTvl(vault.tvl, tvl.value, id, block, vault.id)
      }
      vault.tvlSequenceId = vault.tvlSequenceId + 1;
      vault.tvl = tvl.value
      vault.priceUnderlying = priceForVault
      vault.lastTotalSupply = tvl.totalSupply
      vault.save()
    }
    return tvl;
  }
  return null;
}

export function calculateTvlUsd(vaultAddress: Address, price: BigDecimal, transaction: ethereum.Transaction, block: ethereum.Block): BigDecimal {
  if (price.le(BigDecimal.zero())) {
    return BD_ZERO
  }
  const vault = Vault.load(vaultAddress.toHex())
  if (vault != null) {
    const totalSupply = fetchContractTotalSupply(vaultAddress)
    const decimal = fetchContractDecimal(vaultAddress)
    const tempDecimal = pow(BigDecimal.fromString('10'), decimal.toI32())
    const sharePrice = fetchPricePerFullShare(vaultAddress)
    const sharePriceDivDecimal = sharePrice.divDecimal(tempDecimal)
    const value = totalSupply.divDecimal(tempDecimal).times(price).times(sharePriceDivDecimal)
    const id = `${transaction.hash.toHex()}-${vaultAddress.toHex()}`
    let tvl = Tvl.load(id)
    if (tvl == null) {
      tvl = new Tvl(id)
      tvl.vault = vault.id
      tvl.timestamp = block.timestamp
      tvl.createAtBlock = block.number
      tvl.totalSupply = totalSupply
      tvl.sharePrice = sharePrice
      tvl.priceUnderlying = price
      tvl.value = value
      tvl.sequenceId = tvlSequenceId(vault.id).lastSequenceId
      tvl.tvlSequenceId = vault.tvlSequenceId

      totalTvlCount(vault.id);
      if (tvl.value.ge(TVL_WARN)) {
        return value;
      }

      tvl.save()

      if (canCalculateTotalTvl(vault.id)) {
        // createTotalTvl(vault.tvl, tvl.value, id, block, vault.id)
      }
      vault.tvlSequenceId = vault.tvlSequenceId + 1;
      vault.tvl = tvl.value
      vault.priceUnderlying = price
      vault.save()
    }
    return value
  }
  return BigDecimal.zero()
}

export function totalTvlCount(vault: string): TvlCount {
  let totalCount = TvlCount.load(vault)
  if (!totalCount) {
    totalCount = new TvlCount(vault);
    totalCount.length = BigInt.zero();
  }

  totalCount.length = totalCount.length.plus(BigInt.fromString('1'));
  totalCount.save();
  return totalCount;
}


// deprecated
export function createTotalTvl(oldValue:BigDecimal, newValue: BigDecimal, id: string, block: ethereum.Block, vaultId: string): void {
  const defaultId = '1';
  let totalTvl = TotalTvl.load(defaultId)
  if (totalTvl == null) {
    totalTvl = new TotalTvl(defaultId)
    totalTvl.value = BigDecimal.zero()
    totalTvl.save()
  }

  totalTvl.value = totalTvl.value.minus(oldValue).plus(newValue);
  totalTvl.save()

  let totalTvlHistory = TotalTvlHistory.load(`${id}-${oldValue.toString()}-${newValue.toString()}`)
  if (totalTvlHistory == null) {
    totalTvlHistory = new TotalTvlHistory(`${id}-${oldValue.toString()}-${newValue.toString()}`)

    totalTvlHistory.oldValue = oldValue
    totalTvlHistory.newValue = newValue
    totalTvlHistory.vault = vaultId
    totalTvlHistory.value = totalTvl.value
    totalTvlHistory.timestamp = block.timestamp
    totalTvlHistory.createAtBlock = block.number
    totalTvlHistory.save()
  }
}


export function createTvlV2(totalTvl: BigDecimal, block: ethereum.Block): void {
  let totalTvlHistory = TotalTvlHistoryV2.load(block.number.toString())
  if (totalTvlHistory == null) {
    totalTvlHistory = new TotalTvlHistoryV2(block.number.toString())

    totalTvlHistory.sequenceId = totalTvlUp();
    totalTvlHistory.value = totalTvl
    totalTvlHistory.timestamp = block.timestamp
    totalTvlHistory.createAtBlock = block.number
    totalTvlHistory.save()
  }
}

export function tvlSequenceId(address: string): TvlSequnceId {
  let tvlSequenceId = TvlSequnceId.load(address)
  if (!tvlSequenceId) {
    tvlSequenceId = new TvlSequnceId(address)
    tvlSequenceId.lastSequenceId = BigInt.zero();
  }
  tvlSequenceId.lastSequenceId = tvlSequenceId.lastSequenceId.plus(BigInt.fromString('1'))
  tvlSequenceId.save()
  return tvlSequenceId;
}