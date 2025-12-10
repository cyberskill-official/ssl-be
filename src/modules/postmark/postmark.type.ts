export interface I_Input_SendEmail {
    to: string;
    subject: string;
    body: string;
}

export interface I_Input_SendBulkEmail {
    to: string[];
    subject: string;
    html: string;
    text?: string;
}

export interface ISendBulkTemplatedEmailParams {
    Source: string;
    Template: string;
    DefaultTemplateData: string;
    Destinations: Array<{
        Destination: { ToAddresses: string[] };
        ReplacementTemplateData: string;
    }>;
}

export interface I_Input_CreateEmailTemplate {
    templateName: string;
    subject: string;
    html: string;
    text?: string;
}
