import { Address, BigDecimal, BigInt, log } from "@graphprotocol/graph-ts";
import { OracleContract } from "../../generated/templates/VaultListener/OracleContract";
import {
  BALANCER_CONTRACT_NAME,
  BD_18,
  BD_ONE, BD_TEN, CURVE_CONTRACT_NAME,
  BI_18,
  DEFAULT_PRICE, F_UNI_V3_CONTRACT_NAME, FARM_TOKEN, LP_UNI_PAIR_CONTRACT_NAME, NULL_ADDRESS,
  ORACLE_ADDRESS_FIRST,
  ORACLE_ADDRESS_SECOND, PS_ADDRESSES,
  STABLE_COIN_ARRAY, UNISWAP_V3_VALUE, DEFAULT_DECIMAL,
} from "./Constant";
import { Token, UniswapV3Price, Vault } from "../../generated/schema";
import { UniswapV2PairContract } from "../../generated/ExclusiveRewardPoolListener/UniswapV2PairContract";
import { WeightedPool2TokensContract } from "../../generated/templates/VaultListener/WeightedPool2TokensContract";
import { BalancerVaultContract } from "../../generated/templates/VaultListener/BalancerVaultContract";
import { ERC20 } from "../../generated/Controller/ERC20";
import { CurveVaultContract } from "../../generated/templates/VaultListener/CurveVaultContract";
import { CurveMinterContract } from "../../generated/templates/VaultListener/CurveMinterContract";
import { getUniswapPoolV3ByVault } from "./UniswapV3Pool";
import { UniswapV3PoolContract } from "../../generated/ExclusiveRewardPoolListener/UniswapV3PoolContract";
import { fetchContractDecimal } from "./ERC20";
import { pow } from "./Math";


export function getPriceForCoin(address: Address, block: number): BigInt {
  if (STABLE_COIN_ARRAY.join(' ').includes(address.toHex())) {
    return BI_18
  }
  if (block >= 12015724) {
    let oracle = OracleContract.bind(ORACLE_ADDRESS_FIRST)
    if (block > 12820106) {
      oracle = OracleContract.bind(ORACLE_ADDRESS_SECOND)
    }

    let tryGetPrice = oracle.try_getPrice(address)
    if (tryGetPrice.reverted) {
      log.log(log.Level.WARNING, `Can not get price on block ${block} for address ${address.toHex()}`)
      return DEFAULT_PRICE
    }
    return tryGetPrice.value;
  }
  return DEFAULT_PRICE
}

export function getPriceByVault(vault: Vault, block: number): BigDecimal {

  if (isPsAddress(vault.id)) {
    return getPriceForCoin(FARM_TOKEN, block).divDecimal(BD_18)
  }
  const underlyingAddress = vault.underlying

  let price = getPriceForCoin(Address.fromString(underlyingAddress), block)
  if (!price.isZero()) {
    return price.divDecimal(BD_18)
  }

  // is from uniSwapV3 pools
  if (isUniswapV3(vault.name)) {
    return getPriceForUniswapV3(vault, block)
  }

  const underlying = Token.load(underlyingAddress)
  if (underlying != null) {
    if (isLpUniPair(underlying.name)) {
      const tempPrice = getPriceForCoin(Address.fromString(underlyingAddress), block)
      if (tempPrice.gt(DEFAULT_PRICE)) {
        return tempPrice.divDecimal(BD_18)
      }
      return getPriceLpUniPair(underlying.id, block)
    }

    if (isBalancer(underlying.name)) {
      return getPriceForBalancer(underlying.id, block)
    }

    if (isCurve(underlying.name)) {
      const tempPrice = getPriceForCoin(Address.fromString(underlying.id), block)
      if (!tempPrice.isZero()) {
        return tempPrice.divDecimal(BD_18)
      }

      return getPriceForCurve(underlyingAddress, block)
    }
  }

  return BigDecimal.zero()

}

export function getPriceForUniswapV3(vault: Vault, block: number): BigDecimal {
  const poolAddress = getUniswapPoolV3ByVault(vault)
  if (!poolAddress.equals(NULL_ADDRESS)) {
    const pool =  UniswapV3PoolContract.bind(poolAddress)
    const sqrtPriceX96 = pool.slot0().getSqrtPriceX96()
    const sqrt = pow(sqrtPriceX96.toBigDecimal(), 2)
    const tokenA = pool.token0()
    const tokenB = pool.token1()
    const decimalA = fetchContractDecimal(tokenA)
    const decimalB = fetchContractDecimal(tokenB)
    const decimal = pow(BD_TEN, decimalA.toI32()).div(pow(BD_TEN, decimalB.toI32()))
    const value = sqrt.times(decimal.div(UNISWAP_V3_VALUE))
    const tokenBPrice = getPriceForCoin(tokenB, block).divDecimal(BD_18)
    const price = value.times(tokenBPrice)

    let uniswapPrice = UniswapV3Price.load(`${poolAddress.toHex()}-${block}`)
    if (uniswapPrice == null) {
      uniswapPrice = new UniswapV3Price(`${poolAddress.toHex()}-${block}`)
      uniswapPrice.sqrtPriceX96 = sqrtPriceX96
      uniswapPrice.sqrt = sqrt
      uniswapPrice.tokenA = tokenA.toHex()
      uniswapPrice.tokenB = tokenB.toHex()
      uniswapPrice.decimalA = decimalA
      uniswapPrice.decimalB = decimalB
      uniswapPrice.decimal = decimal
      uniswapPrice.value = value
      uniswapPrice.tokenBPrice = tokenBPrice
      uniswapPrice.price = price
      uniswapPrice.createAtBlock = BigInt.fromI64(block as i64)
      uniswapPrice.save()
    }
    return price
  }

  return BigDecimal.zero()
}

function getPriceForCurve(underlyingAddress: string, block: number): BigDecimal {
  const curveContract = CurveVaultContract.bind(Address.fromString(underlyingAddress))
  const tryMinter = curveContract.try_minter()
  if (tryMinter.reverted) {
    return BigDecimal.zero()
  }
  const minter = CurveMinterContract.bind(tryMinter.value)
  let index = 0
  let tryCoins = minter.try_coins(BigInt.fromI32(index))
  while (tryCoins.reverted) {
    index = index + 1
    tryCoins = minter.try_coins(BigInt.fromI32(index))
  }
  const tryDecimals = curveContract.try_decimals()
  let decimal = BigInt.fromI32(DEFAULT_DECIMAL)
  if (!tryDecimals.reverted) {
    decimal = tryDecimals.value
  } else {
    log.log(log.Level.WARNING, `Can not get decimals for ${underlyingAddress}`)
  }
  const size = index + 1
  if (size < 1) {
    return BigDecimal.zero()
  }

  let value = BigDecimal.zero()

  for (let i=0;i<size;i++) {
    const index = BigInt.fromI32(i)
    const token = minter.coins(index)
    const tokenPrice = getPriceForCoin(token, block).divDecimal(BD_18)
    const balance = minter.balances(index)
    const tryDecimalsTemp = ERC20.bind(token).try_decimals()
    let decimalsTemp = DEFAULT_DECIMAL
    if (!tryDecimalsTemp.reverted) {
      decimalsTemp = tryDecimalsTemp.value
    } else {
      log.log(log.Level.WARNING, `Can not get decimals for ${token}`)
    }
    value = value.plus(tokenPrice.times(normalizePrecision(balance, BigInt.fromI32(decimalsTemp)).toBigDecimal().div(BD_18)))
  }

  return value.times(BD_18).div(normalizePrecision(curveContract.totalSupply(), decimal).toBigDecimal())
}

// amount / (10 ^ 18 / 10 ^ decimal)
function normalizePrecision(amount: BigInt, decimal: BigInt): BigInt {
  return amount.div(BI_18.div(BigInt.fromI64(10 ** decimal.toI64())))
}

function getPriceLpUniPair(underlyingAddress: string, block: number): BigDecimal {
  const uniswapV2Pair = UniswapV2PairContract.bind(Address.fromString(underlyingAddress))
  const tryGetReserves = uniswapV2Pair.try_getReserves()
  if (tryGetReserves.reverted) {
    log.log(log.Level.WARNING, `Can not get reserves for underlyingAddress = ${underlyingAddress}, try get price for coin`)

    return getPriceForCoin(Address.fromString(underlyingAddress), block).divDecimal(BD_18)
  }
  const reserves = tryGetReserves.value
  const totalSupply = uniswapV2Pair.totalSupply()
  const positionFraction = BD_ONE.div(totalSupply.toBigDecimal())
  const firstCoin = reserves.get_reserve0().toBigDecimal().times(positionFraction)
  const secondCoin = reserves.get_reserve1().toBigDecimal().times(positionFraction)


  const token0Price = getPriceForCoin(uniswapV2Pair.token0(), block)
  const token1Price = getPriceForCoin(uniswapV2Pair.token1(), block)

  if (token0Price.isZero() || token1Price.isZero()) {
    return BigDecimal.zero()
  }

  return token0Price
    .divDecimal(BD_18)
    .times(firstCoin)
    .plus(
      token1Price
        .divDecimal(BD_18)
        .times(secondCoin)
    )
    .times(BD_18)
}

function getPriceForBalancer(underlying: string, block: number): BigDecimal {
  const balancer = WeightedPool2TokensContract.bind(Address.fromString(underlying))
  const poolId = balancer.getPoolId()
  const totalSupply = balancer.totalSupply()
  const vault = BalancerVaultContract.bind(balancer.getVault())
  const tokenInfo = vault.getPoolTokens(poolId)

  // TODO calc in BD
  let price = BigDecimal.zero()
  for (let i=0;i<tokenInfo.getTokens().length;i++) {
    const tokenPrice = getPriceForCoin(tokenInfo.getTokens()[i], block).divDecimal(BD_18)
    price = price.plus(price.times(tokenPrice))
  }

  if (price.le(BigDecimal.zero())) {
    return price
  }
  return price.div(totalSupply.toBigDecimal())
}

export function isPsAddress(address: string): boolean {
  if (PS_ADDRESSES.join(' ').includes(address)) {
    return true
  }

  return false
}

export function isLpUniPair(name: string): boolean {
  for (let i=0;i<LP_UNI_PAIR_CONTRACT_NAME.length;i++) {
    if (name.toLowerCase().startsWith(LP_UNI_PAIR_CONTRACT_NAME[i])) {
      return true
    }
  }
  return false
}

function isBalancer(name: string): boolean {
  if (name.toLowerCase().startsWith(BALANCER_CONTRACT_NAME)) {
    return true
  }

  return false
}

function isCurve(name: string): boolean {
  if (name.toLowerCase().startsWith(CURVE_CONTRACT_NAME)) {
    return true
  }

  return false
}

export function isUniswapV3(name: string): boolean {
  if (name.toLowerCase().startsWith(F_UNI_V3_CONTRACT_NAME)) {
    return true
  }
  return false
}