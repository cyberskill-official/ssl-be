import { describe, expect, it } from 'vitest';

import { prepareTagListQuery } from './tag-list-query.js';

describe('prepareTagListQuery', () => {
    it('adds escaped name search and a usage ceiling without changing scope filters', () => {
        const scopeFilter = {
            isDel: false,
            $or: [
                { createdById: null, isCustom: { $ne: true } },
                { createdById: 'user-1' },
            ],
        };

        const result = prepareTagListQuery(scopeFilter, {
            page: 3,
            limit: 25,
            search: 'Friends (benefits)+',
            usageCountLte: 5,
        });

        expect(result.options).toEqual({ page: 3, limit: 25 });
        expect(result.filter['$or']).toEqual(scopeFilter.$or);
        expect(result.filter['usageCount']).toEqual({ $lte: 5 });
        expect(result.filter['name']).toBeInstanceOf(RegExp);
        expect((result.filter['name'] as RegExp).source).toBe('Friends \\(benefits\\)\\+');
    });

    it('ignores invalid custom options and always strips them from paginate options', () => {
        const result = prepareTagListQuery({}, {
            search: '   ',
            usageCountLte: -1,
            sort: { usageCount: -1 },
        });

        expect(result.filter).toEqual({});
        expect(result.options).toEqual({ sort: { usageCount: -1 } });
    });
});
