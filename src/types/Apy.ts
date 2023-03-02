import { ApyAutoCompound, ApyReward, Pool, Vault } from "../../generated/schema";
import { Address, BigDecimal, BigInt, ethereum, log } from "@graphprotocol/graph-ts";
import { getPriceByVault, getPriceForCoin } from "../utils/PriceUtils";
import {
  BD_18,
  BD_ZERO,
  getFarmToken, I_FARM_TOKEN,
  isPsAddress, NULL_ADDRESS,
  skipCalculateApyReward,
} from "../utils/Constant";
import { calculateTvlUsd } from "./Tvl";
import { calculateApr, calculateAprAutoCompound, calculateApy } from "../utils/ApyUtils";
import { fetchRewardRateForToken, fetchRewardToken, fetchRewardTokenLength } from "../utils/PotPoolUtils";



export function saveApyReward(
  poolAddress: Address,
  rewardToken: Address,
  rewardRate: BigInt,
  periodFinish: BigInt,
  rewardAmount: BigInt,
  tx: ethereum.Transaction,
  block: ethereum.Block
): void {
  let pool = Pool.load(poolAddress.toHex())
  if (pool != null) {
    let vault = Vault.load(pool.vault)
    if (vault != null) {

      if (skipCalculateApyReward(vault.id)) {
        return;
      }

      if (vault.skipFirstApyReward == true) {
        vault.skipFirstApyReward = false
        vault.save()
        return
      }

      let price = BigDecimal.zero()
      const apy = new ApyReward(`${tx.hash.toHex()}-${vault.id}`)

      if (isPsAddress(pool.vault)) {
        price = getPriceForCoin(getFarmToken(), block.number.toI32()).divDecimal(BD_18)
        apy.rewardRate = rewardRate
      }
      else if (vault.isUniswapV3) {
        const tokenLength = fetchRewardTokenLength(poolAddress)
        const index = tokenLength.minus(BigInt.fromI32(1))
        const rewardToken = fetchRewardToken(poolAddress, index)
        if (rewardToken == NULL_ADDRESS) {
          log.log(log.Level.ERROR, `Can not create apy reward for uniswapV3 pool: ${poolAddress.toHex()}, because rewardToken is null. We tried get by index = ${index}`)
          return;
        }
        const rewardRateForUniswapV3 = fetchRewardRateForToken(poolAddress, rewardToken)
        if (rewardRateForUniswapV3 == BigInt.zero()) {
          log.log(log.Level.ERROR, `Can not create apy reward for uniswapV3 pool: ${poolAddress.toHex()}, because rewardRate is 0. We tried get by tokenAddress = ${rewardToken}`)
          return;
        }
        price = getPriceForCoin(rewardToken, block.number.toI32()).divDecimal(BD_18)
        apy.rewardRate = rewardRateForUniswapV3

      }
      else {
        price = getPriceByVault(vault, block.number.toI32())
        apy.rewardRate = rewardRate
      }

      apy.periodFinish = periodFinish
      apy.rewardAmount = rewardAmount
      apy.rewardForPeriod = BigDecimal.zero()
      apy.apr = BigDecimal.zero()
      apy.apy = BigDecimal.zero()
      apy.tvlUsd = BigDecimal.zero()
      if (price.gt(BigDecimal.zero())) {

        const tokenPrice = getPriceForCoin(Address.fromString(pool.rewardTokens[0]), block.number.toI32())
        const period = (periodFinish.minus(block.timestamp)).toBigDecimal()

        if (!tokenPrice.isZero() && !apy.rewardRate.isZero()) {
          apy.rewardForPeriod = apy.rewardRate.divDecimal(BD_18).times(tokenPrice.divDecimal(BD_18)).times(period)
        }

        let addressForTvl = Address.fromString(vault.id);
        if (isPsAddress(pool.vault)) {
          addressForTvl = I_FARM_TOKEN
        }

        const tvlUsd = calculateTvlUsd(addressForTvl, price, tx, block)
        apy.tvlUsd = tvlUsd
        const apr = calculateApr(period, apy.rewardForPeriod, tvlUsd)
        if (!(BigDecimal.compare(apr, BD_ZERO) == 0)) {
          const apyValue = calculateApy(apr)
          apy.apr = apr
          apy.apy = apyValue
        }
      }

      if (apy.apy.le(BigDecimal.zero())) {
        // don't save 0 APY
        return;
      }
      apy.vault = vault.id
      apy.timestamp = block.timestamp
      apy.createAtBlock = block.number
      apy.priceUnderlying = price
      apy.save()

      if (apy.apy.gt(BigDecimal.zero())) {
        const countApy = vault.apyRewardCount.plus(BigInt.fromI32(1))
        vault.apyReward = apy.apy.plus(vault.apyReward).div(countApy.toBigDecimal())
        vault.apyRewardCount = countApy
        vault.save()
      }
    }
  }
}

export function calculateAndSaveApyAutoCompound(id: string, diffSharePrice: BigDecimal, diffTimestamp: BigInt, vaultAddress: string, block: ethereum.Block): BigDecimal {
  let apyAutoCompound = ApyAutoCompound.load(id)
  if (apyAutoCompound == null) {
    apyAutoCompound = new ApyAutoCompound(id)
    apyAutoCompound.createAtBlock = block.number
    apyAutoCompound.timestamp = block.timestamp
    apyAutoCompound.apr = calculateAprAutoCompound(diffSharePrice, diffTimestamp.toBigDecimal())
    apyAutoCompound.apy = calculateApy(apyAutoCompound.apr)
    apyAutoCompound.vault = vaultAddress
    apyAutoCompound.diffSharePrice = diffSharePrice
    apyAutoCompound.save()
  }
  return apyAutoCompound.apy
}