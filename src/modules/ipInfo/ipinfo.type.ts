import type { Details } from 'express-useragent';

export interface I_Response_Ip {
    success: boolean;
    message: string;
    result?: Details;
}

export interface I_MyIp {
    ip: string;
    asn: string;
    as_name: string;
    as_domain: string;
    country_code: string;
    country: string;
    continent_code: string;
}

export interface I_Response_MyIp {
    success: boolean;
    message: string;
    result?: I_MyIp;
}

export interface I_IpInfo {
    network: string;
    country: string;
    country_code: string;
    continent: string;
    continent_code: string;
    asn: string;
    as_name: string;
    as_domain: string;
}

export interface I_Response_IpInfo {
    success: boolean;
    message: string;
    result?: I_IpInfo;
}
