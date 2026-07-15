import { Address, BigDecimal, BigInt, ethereum, log } from "@graphprotocol/graph-ts";
import { Vault, VaultUtil } from '../../generated/schema';
import { fetchContractDecimal, fetchContractName, fetchContractSymbol } from "../utils/ERC20Utils";
import { loadOrCreateERC20Token } from "./Token";
import { IFarmVaultListener, UniswapV3VaultListener, VaultListener } from "../../generated/templates";
import { fetchUnderlyingAddress } from "../utils/VaultUtils";
import { isIFarm, isUniswapV3 } from "../utils/PlatformUtils";
import { pushVault } from './TotalTvlUtils';
import { BI_18, BI_TEN } from '../utils/Constant';
import { powBI } from '../utils/MathUtils';

export function loadOrCreateVault(vaultAddress: Address, block: ethereum.Block, strategy: string = 'unknown'): Vault {
  let vault = Vault.load(vaultAddress.toHex())
  if (vault == null) {
    log.log(log.Level.INFO, `Create new vault: ${vaultAddress}`)
    vault = new Vault(vaultAddress.toHex());
    const decimal = fetchContractDecimal(vaultAddress);
    vault.name = fetchContractName(vaultAddress)
    vault.decimal = decimal;
    vault.symbol = fetchContractSymbol(vaultAddress)
    const underlying = fetchUnderlyingAddress(vaultAddress)
    vault.createAtBlock = block.number;
    vault.strategy = strategy
    vault.timestamp = block.timestamp;
    vault.underlying = loadOrCreateERC20Token(underlying).id
    vault.lastShareTimestamp = BigInt.zero()
    vault.lastSharePrice = powBI(BI_TEN, decimal.toI32());
    vault.apyAutoCompound = BigDecimal.zero()
    vault.apyAutoCompoundCount = BigInt.zero()
    vault.apyReward = BigDecimal.zero()
    vault.apyRewardCount = BigInt.zero()
    vault.tvlSequenceId = 0;
    vault.priceFeedSequenceId = 0;
    vault.priceUnderlying = BigDecimal.zero()
    vault.apy = BigDecimal.zero()
    vault.skipFirstApyReward = true
    if (isUniswapV3(vault.name)) {
      vault.isUniswapV3 = true
      UniswapV3VaultListener.create(vaultAddress)
    } else {
      vault.isUniswapV3 = false
      VaultListener.create(vaultAddress)
    }
    if (isIFarm(vault.name)) {
      vault.isIFarm = true
      IFarmVaultListener.create(vaultAddress)
    } else {
      vault.isIFarm = false
    }
    vault.tvl = BigDecimal.zero()
    vault.users = [];
    vault.lastUsersShareTimestamp = BigInt.zero();
    vault.lastTotalSupply = BigInt.zero();
    vault.lastApr = BigDecimal.zero();
    vault.lastDiffTimestamp = BigDecimal.zero();
    vault.lastDiffSharePrice = BigDecimal.zero();
    vault.lastVaultSnapshotTs = BigInt.zero();
    vault.save();
    pushVault(vault.id, block)
    const vaultUtils= getVaultUtils();
    const vaults = vaultUtils.vaults
    vaults.push(vault.id)
    vaultUtils.vaults = vaults;
    vaultUtils.vaultLength = vaults.length
    vaultUtils.save();
  }
  return vault;
}

export function getVaultUtils(): VaultUtil {
  const id = '1';
  let vaultUtils = VaultUtil.load(id)
  if (!vaultUtils) {
    vaultUtils = new VaultUtil(id);
    vaultUtils.vaults = [];
    vaultUtils.vaultLength = 0;
    vaultUtils.lastBlockPrice = BigInt.zero();
    vaultUtils.save()
  }
  return vaultUtils;
}