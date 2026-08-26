/**
 * @counter/wallet-contracts
 *
 * API contract types for wallet endpoints. These types define the shape of
 * requests and responses for the wallet service API.
 */

export const PACKAGE_NAME = "@counter/wallet-contracts";

export type {
  CreateWalletRequest,
  CreateWalletResponse,
  InviteToWalletRequest,
  InviteToWalletResponse,
  EnrollWalletRequest,
  EnrollWalletResponse,
  VerifyWalletRequest,
  VerifyWalletResponse,
  WalletStatusRequest,
  WalletStatusResponse,
  SuspendWalletRequest,
  SuspendWalletResponse,
  CloseWalletRequest,
  CloseWalletResponse,
  WalletEndpoint,
  WalletApiError,
  WalletErrorCode,
} from "./contracts.js";

export { WALLET_ENDPOINTS, WALLET_ERROR_CODES, isWalletErrorCode } from "./contracts.js";
