const MONGO_OBJECT_ID_REGEX = /^[\da-f]{24}$/iu;

export function prepareBlogLookupFilter(filter: Record<string, unknown>) {
    const id = filter['id'];
    if (typeof id !== 'string' || !MONGO_OBJECT_ID_REGEX.test(id)) {
        return filter;
    }

    const remainingFilter = { ...filter };
    delete remainingFilter['id'];

    const idFilter = {
        $or: [
            { id },
            { _id: id },
        ],
    };

    if (Object.keys(remainingFilter).length === 0) {
        return idFilter;
    }

    return {
        $and: [remainingFilter, idFilter],
    };
}
