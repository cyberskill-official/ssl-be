export interface I_PayPalCredentials {
    baseUrl: string;
    clientId: string;
    clientSecret: string;
}

export interface I_PayPalAccessTokenResponse {
    access_token: string;
    token_type?: string;
    expires_in?: number;
    app_id?: string;
    nonce?: string;
}

export interface I_PayPalOrderLink {
    href: string;
    rel: string;
    method?: string;
}

export interface I_PayPalPurchaseUnitAmount {
    currency_code: string;
    value: string;
}

export interface I_PayPalPurchaseUnit {
    amount: I_PayPalPurchaseUnitAmount;
    description?: string;
}

export interface I_PayPalApplicationContext {
    return_url?: string;
    cancel_url?: string;
    brand_name?: string;
    landing_page?: 'LOGIN' | 'BILLING' | 'NO_PREFERENCE';
    user_action?: 'PAY_NOW' | 'CONTINUE';
    shipping_preference?: 'NO_SHIPPING' | 'GET_FROM_FILE' | 'SET_PROVIDED_ADDRESS';
}

export interface I_PayPalCreateOrderPayload {
    intent: 'CAPTURE' | 'AUTHORIZE';
    purchase_units: I_PayPalPurchaseUnit[];
    application_context?: I_PayPalApplicationContext;
}

export interface I_PayPalCreateOrderResponse {
    id: string;
    status?: string;
    links?: I_PayPalOrderLink[];
}

export interface I_PayPalCapture {
    id?: string;
    status?: string;
    amount?: I_PayPalPurchaseUnitAmount;
}

export interface I_PayPalCaptureOrderResponse {
    id?: string;
    status?: string;
    purchase_units?: Array<{
        payments?: {
            captures?: I_PayPalCapture[];
        };
    }>;
}

export interface I_PayPalErrorDetail {
    issue?: string;
    description?: string;
    field?: string;
    value?: string;
}

export interface I_PayPalErrorResponse {
    name?: string;
    message?: string;
    details?: I_PayPalErrorDetail[];
}

export interface I_PayPalProductPayload {
    name: string;
    description?: string;
    type?: 'PHYSICAL' | 'DIGITAL' | 'SERVICE';
    category?: 'SOFTWARE' | 'SUBSCRIPTION' | 'CONSULTING' | 'SELLER_SUBSCRIPTION' | 'OTHER';
    image_url?: string;
    home_url?: string;
}

export interface I_PayPalProductResponse {
    id: string;
    name?: string;
    description?: string;
    type?: string;
    category?: string;
    status?: string;
    links?: I_PayPalOrderLink[];
}

export interface I_PayPalFrequency {
    interval_unit: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
    interval_count: number;
}

export interface I_PayPalFixedPrice {
    value: string;
    currency_code: string;
}

export interface I_PayPalBillingCycle {
    frequency: I_PayPalFrequency;
    tenure_type: 'REGULAR' | 'TRIAL' | 'TRIAL_PERIOD' | 'FINAL';
    sequence: number;
    total_cycles: number;
    pricing_scheme: {
        fixed_price: I_PayPalFixedPrice;
    };
}

export interface I_PayPalPaymentPreferences {
    auto_bill_outstanding?: boolean;
    setup_fee?: I_PayPalFixedPrice;
    setup_fee_failure_action?: 'CONTINUE' | 'CANCEL';
    payment_failure_threshold?: number;
}

export interface I_PayPalPlanPayload {
    product_id: string;
    name: string;
    description?: string;
    status?: 'ACTIVE' | 'INACTIVE';
    billing_cycles: I_PayPalBillingCycle[];
    payment_preferences?: I_PayPalPaymentPreferences;
    taxes?: {
        percentage: string;
        inclusive: boolean;
    };
}

export interface I_PayPalPlanResponse {
    id: string;
    status?: string;
    billing_cycles?: I_PayPalBillingCycle[];
    payment_preferences?: I_PayPalPaymentPreferences;
    links?: I_PayPalOrderLink[];
}

export interface I_PayPalSubscriptionPayload {
    plan_id: string;
    start_time?: string;
    quantity?: string;
    shipping_amount?: I_PayPalFixedPrice;
    custom_id?: string;
    application_context?: I_PayPalApplicationContext;
}

export interface I_PayPalSubscriptionResponse {
    id: string;
    status?: string;
    subscriber?: Record<string, unknown>;
    billing_info?: Record<string, unknown>;
    links?: I_PayPalOrderLink[];
}
