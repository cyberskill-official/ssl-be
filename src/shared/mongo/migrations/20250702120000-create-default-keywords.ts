import type { C_Db } from '@cyberskill/shared/node/mongo';

import { MongoController } from '@cyberskill/shared/node/mongo';

import type { I_Keyword } from '#modules/keyword/index.js';

import { E_KeywordCategory } from '#modules/keyword/index.js';

const predefinedKeywords = [
    // INAPPROPRIATE - 25 words
    { word: 'nude', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 45, isActive: true },
    { word: 'naked', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 32, isActive: true },
    { word: 'sex', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 78, isActive: true },
    { word: 'porn', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 23, isActive: true },
    { word: 'adult', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 56, isActive: true },
    { word: 'explicit', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 19, isActive: true },
    { word: 'intimate', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 28, isActive: true },
    { word: 'provocative', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 15, isActive: true },
    { word: 'suggestive', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 22, isActive: true },
    { word: 'seductive', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 18, isActive: true },
    { word: 'erotic', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 12, isActive: true },
    { word: 'sensual', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 25, isActive: true },
    { word: 'intimate', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 31, isActive: true },
    { word: 'private', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 42, isActive: true },
    { word: 'personal', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 38, isActive: true },
    { word: 'revealing', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 16, isActive: true },
    { word: 'exposed', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 14, isActive: true },
    { word: 'unclothed', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 8, isActive: true },
    { word: 'undressed', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 11, isActive: true },
    { word: 'bare', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 29, isActive: true },
    { word: 'topless', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 7, isActive: true },
    { word: 'bottomless', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 5, isActive: true },
    { word: 'lingerie', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 33, isActive: true },
    { word: 'underwear', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 27, isActive: true },
    { word: 'bikini', category: E_KeywordCategory.INAPPROPRIATE, occurrences: 41, isActive: true },

    // SPAM - 25 words
    { word: 'buy', category: E_KeywordCategory.SPAM, occurrences: 67, isActive: true },
    { word: 'sell', category: E_KeywordCategory.SPAM, occurrences: 54, isActive: true },
    { word: 'discount', category: E_KeywordCategory.SPAM, occurrences: 89, isActive: true },
    { word: 'offer', category: E_KeywordCategory.SPAM, occurrences: 76, isActive: true },
    { word: 'deal', category: E_KeywordCategory.SPAM, occurrences: 92, isActive: true },
    { word: 'promotion', category: E_KeywordCategory.SPAM, occurrences: 45, isActive: true },
    { word: 'limited', category: E_KeywordCategory.SPAM, occurrences: 38, isActive: true },
    { word: 'time', category: E_KeywordCategory.SPAM, occurrences: 123, isActive: true },
    { word: 'urgent', category: E_KeywordCategory.SPAM, occurrences: 29, isActive: true },
    { word: 'click', category: E_KeywordCategory.SPAM, occurrences: 156, isActive: true },
    { word: 'here', category: E_KeywordCategory.SPAM, occurrences: 234, isActive: true },
    { word: 'link', category: E_KeywordCategory.SPAM, occurrences: 187, isActive: true },
    { word: 'website', category: E_KeywordCategory.SPAM, occurrences: 98, isActive: true },
    { word: 'money', category: E_KeywordCategory.SPAM, occurrences: 145, isActive: true },
    { word: 'cash', category: E_KeywordCategory.SPAM, occurrences: 67, isActive: true },
    { word: 'earn', category: E_KeywordCategory.SPAM, occurrences: 78, isActive: true },
    { word: 'income', category: E_KeywordCategory.SPAM, occurrences: 56, isActive: true },
    { word: 'profit', category: E_KeywordCategory.SPAM, occurrences: 43, isActive: true },
    { word: 'investment', category: E_KeywordCategory.SPAM, occurrences: 34, isActive: true },
    { word: 'opportunity', category: E_KeywordCategory.SPAM, occurrences: 67, isActive: true },
    { word: 'business', category: E_KeywordCategory.SPAM, occurrences: 89, isActive: true },
    { word: 'marketing', category: E_KeywordCategory.SPAM, occurrences: 45, isActive: true },
    { word: 'advertising', category: E_KeywordCategory.SPAM, occurrences: 38, isActive: true },
    { word: 'subscribe', category: E_KeywordCategory.SPAM, occurrences: 123, isActive: true },
    { word: 'newsletter', category: E_KeywordCategory.SPAM, occurrences: 67, isActive: true },
    { word: 'free', category: E_KeywordCategory.SPAM, occurrences: 234, isActive: true },
    { word: 'bonus', category: E_KeywordCategory.SPAM, occurrences: 56, isActive: true },

    // OFFENSIVE - 25 words
    { word: 'hate', category: E_KeywordCategory.OFFENSIVE, occurrences: 45, isActive: true },
    { word: 'kill', category: E_KeywordCategory.OFFENSIVE, occurrences: 23, isActive: true },
    { word: 'die', category: E_KeywordCategory.OFFENSIVE, occurrences: 34, isActive: true },
    { word: 'stupid', category: E_KeywordCategory.OFFENSIVE, occurrences: 67, isActive: true },
    { word: 'idiot', category: E_KeywordCategory.OFFENSIVE, occurrences: 89, isActive: true },
    { word: 'moron', category: E_KeywordCategory.OFFENSIVE, occurrences: 45, isActive: true },
    { word: 'dumb', category: E_KeywordCategory.OFFENSIVE, occurrences: 78, isActive: true },
    { word: 'fool', category: E_KeywordCategory.OFFENSIVE, occurrences: 56, isActive: true },
    { word: 'asshole', category: E_KeywordCategory.OFFENSIVE, occurrences: 123, isActive: true },
    { word: 'bitch', category: E_KeywordCategory.OFFENSIVE, occurrences: 156, isActive: true },
    { word: 'whore', category: E_KeywordCategory.OFFENSIVE, occurrences: 34, isActive: true },
    { word: 'slut', category: E_KeywordCategory.OFFENSIVE, occurrences: 67, isActive: true },
    { word: 'bastard', category: E_KeywordCategory.OFFENSIVE, occurrences: 45, isActive: true },
    { word: 'motherfucker', category: E_KeywordCategory.OFFENSIVE, occurrences: 23, isActive: true },
    { word: 'fuck', category: E_KeywordCategory.OFFENSIVE, occurrences: 234, isActive: true },
    { word: 'shit', category: E_KeywordCategory.OFFENSIVE, occurrences: 187, isActive: true },
    { word: 'damn', category: E_KeywordCategory.OFFENSIVE, occurrences: 145, isActive: true },
    { word: 'hell', category: E_KeywordCategory.OFFENSIVE, occurrences: 98, isActive: true },
    { word: 'suck', category: E_KeywordCategory.OFFENSIVE, occurrences: 76, isActive: true },
    { word: 'screw', category: E_KeywordCategory.OFFENSIVE, occurrences: 54, isActive: true },
    { word: 'piss', category: E_KeywordCategory.OFFENSIVE, occurrences: 43, isActive: true },
    { word: 'crap', category: E_KeywordCategory.OFFENSIVE, occurrences: 67, isActive: true },
    { word: 'jerk', category: E_KeywordCategory.OFFENSIVE, occurrences: 89, isActive: true },
    { word: 'douche', category: E_KeywordCategory.OFFENSIVE, occurrences: 38, isActive: true },
    { word: 'dick', category: E_KeywordCategory.OFFENSIVE, occurrences: 156, isActive: true },
    { word: 'cock', category: E_KeywordCategory.OFFENSIVE, occurrences: 98, isActive: true },

    // CUSTOM - 25 words
    { word: 'test', category: E_KeywordCategory.CUSTOM, occurrences: 12, isActive: false },
    { word: 'sample', category: E_KeywordCategory.CUSTOM, occurrences: 8, isActive: false },
    { word: 'demo', category: E_KeywordCategory.CUSTOM, occurrences: 15, isActive: false },
    { word: 'trial', category: E_KeywordCategory.CUSTOM, occurrences: 23, isActive: false },
    { word: 'beta', category: E_KeywordCategory.CUSTOM, occurrences: 7, isActive: false },
    { word: 'alpha', category: E_KeywordCategory.CUSTOM, occurrences: 5, isActive: false },
    { word: 'preview', category: E_KeywordCategory.CUSTOM, occurrences: 19, isActive: false },
    { word: 'prototype', category: E_KeywordCategory.CUSTOM, occurrences: 4, isActive: false },
    { word: 'mock', category: E_KeywordCategory.CUSTOM, occurrences: 11, isActive: false },
    { word: 'fake', category: E_KeywordCategory.CUSTOM, occurrences: 34, isActive: false },
    { word: 'dummy', category: E_KeywordCategory.CUSTOM, occurrences: 9, isActive: false },
    { word: 'placeholder', category: E_KeywordCategory.CUSTOM, occurrences: 6, isActive: false },
    { word: 'example', category: E_KeywordCategory.CUSTOM, occurrences: 28, isActive: false },
    { word: 'template', category: E_KeywordCategory.CUSTOM, occurrences: 16, isActive: false },
    { word: 'draft', category: E_KeywordCategory.CUSTOM, occurrences: 22, isActive: false },
    { word: 'sketch', category: E_KeywordCategory.CUSTOM, occurrences: 13, isActive: false },
    { word: 'outline', category: E_KeywordCategory.CUSTOM, occurrences: 8, isActive: false },
    { word: 'rough', category: E_KeywordCategory.CUSTOM, occurrences: 17, isActive: false },
    { word: 'final', category: E_KeywordCategory.CUSTOM, occurrences: 25, isActive: false },
    { word: 'complete', category: E_KeywordCategory.CUSTOM, occurrences: 31, isActive: false },
    { word: 'finished', category: E_KeywordCategory.CUSTOM, occurrences: 19, isActive: false },
    { word: 'ready', category: E_KeywordCategory.CUSTOM, occurrences: 42, isActive: false },
    { word: 'done', category: E_KeywordCategory.CUSTOM, occurrences: 67, isActive: false },
    { word: 'complete', category: E_KeywordCategory.CUSTOM, occurrences: 38, isActive: false },
    { word: 'success', category: E_KeywordCategory.CUSTOM, occurrences: 45, isActive: false },
    { word: 'error', category: E_KeywordCategory.CUSTOM, occurrences: 89, isActive: false },
    { word: 'bug', category: E_KeywordCategory.CUSTOM, occurrences: 56, isActive: false },
    { word: 'fix', category: E_KeywordCategory.CUSTOM, occurrences: 78, isActive: false },
    { word: 'update', category: E_KeywordCategory.CUSTOM, occurrences: 123, isActive: false },
    { word: 'version', category: E_KeywordCategory.CUSTOM, occurrences: 34, isActive: false },
];

export async function up(db: C_Db) {
    const keywordCtr = new MongoController<I_Keyword>(db, 'keywords');

    await keywordCtr.createMany(predefinedKeywords);
}

export async function down(db: C_Db) {
    const keywordCtr = new MongoController<I_Keyword>(db, 'keywords');

    const words = predefinedKeywords.map(k => k.word);
    await keywordCtr.deleteMany({ word: { $in: words } });
}
