export interface I_NetvalveCredentials {
    baseUrl: string;
    hppBaseUrl?: string;
    paymentApiBaseUrl?: string; // For GET /order and /orders endpoints (UAT uses payment-api subdomain)
    clientId: string; // Used as userName for Basic Auth
    apiKey: string; // Used as password for Basic Auth, or as apiKey for API Key method
    siteId?: string;
    midByCurrency: Partial<Record<string, string>>;
}

export enum E_NetvalvePaymentType {
    CARD = 'CARD',
    TOKEN = 'TOKEN',
    WALLET = 'WALLET',
}

export interface I_NetvalveRoutingPayload {
    currency?: string;
    siteId?: string;
    netvalveMidId?: string;
}

export interface I_NetvalveHppOrderCustomerDetails extends Record<string, unknown> {
    customerAddress?: string;
    customerCity?: string;
    customerCountryCode?: string;
    customerEmail?: string;
    customerIp?: string;
    customerName?: string;
    customerLastName?: string;
    customerPhone?: string;
    customerState?: string;
    customerZipCode?: string;
}

export interface I_NetvalveHppOrderPayload extends Record<string, unknown> {
    amount: number;
    currency: string;
    midId?: string | number;
    netvalveMidId?: string;
    clientOrderId: string;
    orderDesc?: string;
    successUrl: string;
    cancelUrl: string;
    failedUrl: string;
    pendingUrl?: string;
    customerDetails?: I_NetvalveHppOrderCustomerDetails;
}

export interface I_NetvalveHppOrderResponse extends Record<string, unknown> {
    traceID?: string;
    responseTimestamp?: string;
    orderId?: number | string;
    transactionID?: string;
    responseCode?: string; // "GTW_1000" for success
    responseMessage?: string;
    orderState?: string; // "CREATED" for success
    redirectUrl?: string;
    midId?: string;
    netvalveMidId?: string;
}

export interface I_NetvalveSalePayload extends I_NetvalveRoutingPayload, Record<string, unknown> {
    token: string;
    amount: number;
    currency: string;
    paymentType: E_NetvalvePaymentType;
}

export interface I_NetvalveSaleResponse extends Record<string, unknown> {
    transactionId?: string;
    status?: string;
}

export interface I_NetvalveRefundPayload extends I_NetvalveRoutingPayload, Record<string, unknown> {
    transactionID: string;
    amount?: number;
}

export interface I_NetvalveRefundResponse extends Record<string, unknown> {
    transactionId?: string;
    status?: string;
}

export interface I_NetvalveRebillPayload extends I_NetvalveRoutingPayload, Record<string, unknown> {
    transactionID: string;
    amount: number;
    clientOrderId?: string;
}

export interface I_NetvalveRebillResponse extends Record<string, unknown> {
    traceID?: string;
    responseTimestamp?: string;
    transactionID?: string; // NetValve returns transactionID (uppercase) when successful, similar to HPP_ORDER
    transactionId?: string; // Fallback camelCase variant
    responseCode?: string; // "GTW_1000" for success
    responseMessage?: string;
    responseCodeType?: string; // "SOFT DECLINE", "HARD DECLINE", etc.
    status?: string;
}

export interface I_NetvalveCapturePayload extends I_NetvalveRoutingPayload, Record<string, unknown> {
    transactionID: string;
    amount?: number;
}

export interface I_NetvalveCaptureResponse extends Record<string, unknown> {
    transactionId?: string;
    status?: string;
}

export interface I_NetvalveCancelPayload extends I_NetvalveRoutingPayload, Record<string, unknown> {
    transactionID: string;
}

export interface I_NetvalveCancelResponse extends Record<string, unknown> {
    transactionId?: string;
    status?: string;
}

export interface I_NetvalveAuthorizePayload extends I_NetvalveRoutingPayload, Record<string, unknown> {
    amount: number;
    currency: string;
    paymentType: E_NetvalvePaymentType;
}

export interface I_NetvalveAuthorizeResponse extends Record<string, unknown> {
    transactionId?: string;
    status?: string;
}

export interface I_NetvalveCreateTokenPayload extends I_NetvalveRoutingPayload, Record<string, unknown> {
    paymentType: E_NetvalvePaymentType;
}

export interface I_NetvalveCreateTokenResponse extends Record<string, unknown> {
    token?: string;
    status?: string;
}

export interface I_NetvalveGetTransactionQuery extends Record<string, unknown> {
    id: string;
    collectBillingInfo?: boolean;
    collectShippingInfo?: boolean;
}

export interface I_NetvalveGetTransactionResponse extends Record<string, unknown> {
    transactionId?: string | number;
    status?: string;
}

export interface I_NetvalveQueryTransactionStatusQuery extends Record<string, unknown> {
    transactionId: string;
}

export interface I_NetvalveQueryTransactionStatusResponse extends Record<string, unknown> {
    transactionId?: string | number;
    status?: string;
}

export interface I_NetvalveGetOrdersQuery extends Record<string, unknown> {
    filters: Record<string, unknown>;
    page: number;
    pageSize: number;
}

export interface I_NetvalveGetOrdersResponse extends Record<string, unknown> {
    orders?: Array<Record<string, unknown>>;
    totalCount?: number;
}

export interface I_NetvalveGetOrderQuery extends Record<string, unknown> {
    id?: string;
    clientOrderId?: string;
    netvalveMidId?: string;
    transactionId?: string;
    collectBillingInfo?: boolean;
    collectShippingInfo?: boolean;
}

export interface I_NetvalveGetOrderResponse extends Record<string, unknown> {
    order?: Record<string, unknown>;
    status?: string;
}

export interface I_NetvalveGetTransactionsQuery extends Record<string, unknown> {
    filters: Record<string, unknown>;
    page: number;
    pageSize: number;
}

export interface I_NetvalveGetTransactionsResponse extends Record<string, unknown> {
    transactions?: Array<Record<string, unknown>>;
    totalCount?: number;
}

export interface I_Netvalve3DSInitializationPayload extends I_NetvalveRoutingPayload, Record<string, unknown> {
    amount: number;
    currency: string;
    cardExpireMonth: string;
    cardExpireYear: string;
    cardHolderName: string;
    cardNumber: string;
    customerEmail?: string;
    customerPhone?: string;
    merchantRedirectUrl: string;
}

export interface I_Netvalve3DSInitializationResponse extends Record<string, unknown> {
    traceID?: string;
    responseCode?: string;
    responseMessage?: string;
    threeDSProviderResponse?: I_Netvalve3DSProviderResponse;
    midId?: string | number;
    netvalveMidId?: string;
}

export interface I_Netvalve3DSAuthenticationPayload extends I_NetvalveRoutingPayload, Record<string, unknown> {
    transID: string;
    amount: number;
    currency: string;
    challengeIndicator?: string;
}

export interface I_Netvalve3DSAuthenticationResponse extends Record<string, unknown> {
    transID?: string;
    status?: string;
}

export interface I_Netvalve3DSProviderResponse extends Record<string, unknown> {
    transID?: string;
    referenceId?: string;
    threeDs2TransactionId?: string;
    challengeRequired?: boolean;
    redirectUrl?: string;
    status?: string;
    threeDsVersion?: string;
    provider?: string;
    eci?: string;
    cavv?: string;
    acsURL?: string;
    acsSignedContent?: string;
    messageVersion?: string;
}

export enum E_Netvalve3DSFlow {
    FRICTIONLESS_SALE = 'FRICTIONLESS_SALE',
    CHALLENGE = 'CHALLENGE',
    DEVICE_DATA_COLLECTION = 'DEVICE_DATA_COLLECTION',
    UNKNOWN = 'UNKNOWN',
}

export interface I_Netvalve3DSResultPayload extends Record<string, unknown> {
    transID: string;
}

export interface I_Netvalve3DSResultResponse extends Record<string, unknown> {
    transID?: string;
    status?: string;
    orderId?: string;
}

export interface I_NetvalveErrorResponse extends Record<string, unknown> {
    code?: string | number;
    message?: string;
    errors?: Array<Record<string, unknown>>;
}
