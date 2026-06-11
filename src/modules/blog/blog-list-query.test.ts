import { describe, expect, it } from 'vitest';

import { prepareBlogListQuery } from './blog-list-query.js';

describe('prepareBlogListQuery', () => {
    it('escapes regex input and removes search from paginate options', () => {
        const result = prepareBlogListQuery(
            { isDel: { $ne: true }, type: 'BLOG' },
            { page: 2, limit: 10, search: 'Guide (2026)+?' },
        );

        expect(result.options).toEqual({ page: 2, limit: 10, leanWithId: false });
        expect(result.filter).toMatchObject({
            isDel: { $ne: true },
            type: 'BLOG',
        });

        const searchGroup = (result.filter['$and'] as Array<Record<string, unknown>>)[0];
        const conditions = searchGroup?.['$or'] as Array<Record<string, RegExp>>;
        const regexes = conditions.flatMap(condition => Object.values(condition));

        expect(regexes).not.toHaveLength(0);
        expect(regexes.every(regex => regex.source === 'Guide \\(2026\\)\\+\\?')).toBe(true);
        expect(regexes.every(regex => regex.flags.includes('i'))).toBe(true);
        expect(conditions.some(condition => 'title.en' in condition)).toBe(true);
        expect(conditions.some(condition => 'authorName' in condition)).toBe(true);
        expect(conditions.some(condition => 'hostName' in condition)).toBe(true);
    });

    it('preserves existing and/or conditions while adding search', () => {
        const result = prepareBlogListQuery(
            {
                $or: [{ 'title.en': 'Exact' }],
                $and: [{ isActive: true }],
            },
            { search: 'guide' },
        );

        expect(result.filter['$or']).toEqual([{ 'title.en': 'Exact' }]);
        expect(result.filter['$and']).toHaveLength(2);
    });

    it('prevents lean pagination from replacing public blog id with Mongo _id', () => {
        const result = prepareBlogListQuery(
            {},
            { lean: true, leanWithId: true, projection: { id: 1, title: 1 } },
        );

        expect(result.options).toEqual({
            lean: true,
            leanWithId: false,
            projection: { id: 1, title: 1 },
        });
    });
});
