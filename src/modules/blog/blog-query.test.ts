import { describe, expect, it } from 'vitest';

import { prepareBlogLookupFilter } from './blog-query.js';

describe('prepareBlogLookupFilter', () => {
    it('supports legacy blogs whose public id resolves from Mongo _id', () => {
        expect(prepareBlogLookupFilter({ id: '69e7a0cbd90fd37fd2658c33' })).toEqual({
            $or: [
                { id: '69e7a0cbd90fd37fd2658c33' },
                { _id: '69e7a0cbd90fd37fd2658c33' },
            ],
        });
    });

    it('keeps UUID filters unchanged', () => {
        const filter = { id: '809bffde-c632-4061-873e-91f23d0c0eae', isActive: true };

        expect(prepareBlogLookupFilter(filter)).toEqual(filter);
    });

    it('preserves other conditions when adding the legacy id fallback', () => {
        expect(prepareBlogLookupFilter({
            id: '69e7a0cbd90fd37fd2658c33',
            isDel: false,
        })).toEqual({
            $and: [
                { isDel: false },
                {
                    $or: [
                        { id: '69e7a0cbd90fd37fd2658c33' },
                        { _id: '69e7a0cbd90fd37fd2658c33' },
                    ],
                },
            ],
        });
    });
});
