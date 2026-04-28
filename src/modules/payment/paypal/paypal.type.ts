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

export enum E_PayPalLandingPage {
    LOGIN = 'LOGIN',
    BILLING = 'BILLING',
    NO_PREFERENCE = 'NO_PREFERENCE',
}

export enum E_PayPalUserAction {
    PAY_NOW = 'PAY_NOW',
    CONTINUE = 'CONTINUE',
    SUBSCRIBE_NOW = 'SUBSCRIBE_NOW',
}

export enum E_PayPalShippingPreference {
    NO_SHIPPING = 'NO_SHIPPING',
    GET_FROM_FILE = 'GET_FROM_FILE',
    SET_PROVIDED_ADDRESS = 'SET_PROVIDED_ADDRESS',
}

export interface I_PayPalApplicationContext {
    return_url?: string;
    cancel_url?: string;
    brand_name?: string;
    landing_page?: E_PayPalLandingPage;
    user_action?: E_PayPalUserAction;
    shipping_preference?: E_PayPalShippingPreference;
}

export enum E_PayPalIntent {
    CAPTURE = 'CAPTURE',
    AUTHOR = 'AUTHORIZE',
}

export interface I_PayPalCreateOrderPayload {
    intent: E_PayPalIntent;
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

export enum E_PayPalProductType {
    PHYSICAL = 'PHYSICAL',
    DIGITAL = 'DIGITAL',
    SERVICE = 'SERVICE',
}

export enum E_PayPalProductCategory {
    SOFTWARE = 'SOFTWARE',
    SUBSCRIPTION = 'SUBSCRIPTION',
    CONSULTING = 'CONSULTING',
    SELLER_SUBSCRIPTION = 'SELLER_SUBSCRIPTION',
    OTHER = 'OTHER',
    ADULT = 'ADULT',
}

export interface I_PayPalProductPayload {
    name: string;
    description?: string;
    type?: E_PayPalProductType;
    category?: E_PayPalProductCategory;
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

export enum E_PayPalIntervalUnit {
    DAY = 'DAY',
    WEEK = 'WEEK',
    MONTH = 'MONTH',
    YEAR = 'YEAR',
}

export interface I_PayPalFrequency {
    interval_unit: E_PayPalIntervalUnit;
    interval_count: number;
}

export interface I_PayPalFixedPrice {
    value: string;
    currency_code: string;
}

export enum E_PayPalTenureType {
    REGULAR = 'REGULAR',
    TRIAL = 'TRIAL',
    TRIAL_PERIOD = 'TRIAL_PERIOD',
    FINAL = 'FINAL',
}

export interface I_PayPalBillingCycle {
    frequency: I_PayPalFrequency;
    tenure_type: E_PayPalTenureType;
    sequence: number;
    total_cycles: number;
    pricing_scheme: {
        fixed_price: I_PayPalFixedPrice;
    };
}

export enum E_PayPalPaymentFailureAction {
    CONTINUE = 'CONTINUE',
    CANCEL = 'CANCEL',
}

export interface I_PayPalPaymentPreferences {
    auto_bill_outstanding?: boolean;
    setup_fee?: I_PayPalFixedPrice;
    setup_fee_failure_action?: E_PayPalPaymentFailureAction;
    payment_failure_threshold?: number;
}

export enum E_PayPalProductStatus {
    ACTIVE = 'ACTIVE',
    INACTIVE = 'INACTIVE',
}

export interface I_PayPalPlanPayload {
    product_id: string;
    name: string;
    description?: string;
    status?: E_PayPalProductStatus;
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
    subscriber?: Record<string, unknown>;
}

export interface I_PayPalSubscriptionResponse {
    id: string;
    status?: string;
    subscriber?: Record<string, unknown>;
    billing_info?: Record<string, unknown>;
    links?: I_PayPalOrderLink[];
}

export interface I_PayPalListProductsResponse {
    products?: I_PayPalProductResponse[];
    total_items?: number;
    total_pages?: number;
    links?: I_PayPalOrderLink[];
}

export interface I_PayPalListPlansResponse {
    plans?: I_PayPalPlanResponse[];
    total_items?: number;
    total_pages?: number;
    links?: I_PayPalOrderLink[];
}

export interface I_PayPalClientTokenResponse {
    client_token: string;
    expires_in: number;
}
