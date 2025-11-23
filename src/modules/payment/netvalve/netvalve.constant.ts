import { E_NetvalvePaymentType } from './netvalve.type.js';

export const NETVALVE_DEFAULT_TIMEOUT_MS = 15000;
export const NETVALVE_HEADER_API_KEY = 'api-key';
export const NETVALVE_HEADER_CLIENT_ID = 'netvalve-client-id';
export const NETVALVE_HEADER_AUTHORIZATION = 'Authorization';
export const NETVALVE_PAYMENT_TYPES = [
    E_NetvalvePaymentType.CARD,
    E_NetvalvePaymentType.TOKEN,
    E_NetvalvePaymentType.WALLET,
] as const;
export const NETVALVE_3DS_AUTHENTICATION_ENDPOINT = '/3ds/authentication';
export const NETVALVE_3DS_INITIALIZATION_ENDPOINT = '/3ds/initialization';
export const NETVALVE_3DS_RESULT_ENDPOINT = '/3ds/result';
export const NETVALVE_SALE_ENDPOINT = '/sale';
export const NETVALVE_REFUND_ENDPOINT = '/refund';
export const NETVALVE_REBILL_ENDPOINT = '/rebill';
export const NETVALVE_TOKEN_CREATE_ENDPOINT = '/token/create';
export const NETVALVE_CAPTURE_ENDPOINT = '/capture';
export const NETVALVE_CANCEL_ENDPOINT = '/cancel';
export const NETVALVE_AUTHORIZE_ENDPOINT = '/authorize';
export const NETVALVE_GET_TRANSACTION_ENDPOINT = '/transaction';
export const NETVALVE_GET_ORDERS_ENDPOINT = '/orders';
export const NETVALVE_GET_ORDER_ENDPOINT = '/order';
export const NETVALVE_QUERY_TRANSACTION_STATUS_ENDPOINT = '/transaction/status';
export const NETVALVE_GET_TRANSACTIONS_ENDPOINT = '/transactions';
export const NETVALVE_HPP_ORDER_ENDPOINT = '/hpp/order';

export function isNetvalvePaymentType(value: string): value is E_NetvalvePaymentType {
    return NETVALVE_PAYMENT_TYPES.includes(value as E_NetvalvePaymentType);
}
