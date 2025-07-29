export interface I_VerifyAgeDocumentResult {
    idNumber: string;
    birthDate: string;
    birthYear: number;
    age: number;
    detectedTexts: string[];
}

export interface I_CompareFacesResult {
    similar: boolean;
    similarity: number;
    isAgeVerified: boolean;
    documentAge: number;
    selfieAgeRange: {
        low: number;
        high: number;
    };
}
