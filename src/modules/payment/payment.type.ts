// Types specific to the payment module public API
export interface I_Input_MakePayment {
    amount?: number | string;
    currency?: string;
    clientOrderId?: string;
    successUrl?: string;
    cancelUrl?: string;
    failedUrl?: string;
    pendingUrl?: string;
    orderDesc?: string;
    midId?: string;
    customerDetails?: Record<string, unknown>;
    taxStateId?: string;
    taxCountryId?: string;
}
