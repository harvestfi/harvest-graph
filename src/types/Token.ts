import { Address } from "@graphprotocol/graph-ts";
import { Token } from "../../generated/schema";
import { DEFAULT_DECIMAL, UNKNOWN } from "../utils/Constant";
import { ERC20 } from '../../generated/Storage/ERC20';

export function loadOrCreateERC20Token(tokenAddress: Address): Token{
  let tokenContract = ERC20.bind(tokenAddress)
  let token = Token.load(tokenAddress.toHex())
  if (token == null) {
    token = new Token(tokenAddress.toHex())
    token.name = tokenContract.try_name().reverted ? UNKNOWN : tokenContract.name();
    token.symbol = tokenContract.try_symbol().reverted ? UNKNOWN : tokenContract.symbol()
    // token.decimals = tokenContract.try_decimals().reverted ? DEFAULT_DECIMAL : tokenContract.decimals()
    token.decimals = DEFAULT_DECIMAL;
    token.save()
  }
  return token as Token
}