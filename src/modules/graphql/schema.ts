import type { IResolvers, TypeSource } from '@graphql-tools/utils';
import type { GraphQLScalarType } from 'graphql';

import { path, resolve } from '@cyberskill/shared/node/path';
import { loadFilesSync } from '@graphql-tools/load-files';
import { mergeResolvers, mergeTypeDefs } from '@graphql-tools/merge';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { GraphQLDateTime, GraphQLJSON } from 'graphql-scalars';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type T_ResolverObject = Record<string, Record<string, GraphQLScalarType>>;

const currentDir = resolve(__dirname, '../../');

const typesArray: TypeSource = loadFilesSync<string>(path.join(currentDir, '/**/*.graphql'), {
    recursive: true,
});

const resolversArray: IResolvers[] = loadFilesSync<T_ResolverObject>(path.join(currentDir, '/**/*.resolver.{js,ts}'), {
    recursive: true,
});

const allTypes = mergeTypeDefs(typesArray);
const allResolvers: IResolvers = mergeResolvers(resolversArray);

export const schema = makeExecutableSchema({
    typeDefs: allTypes,
    resolvers: {
        JSON: GraphQLJSON,
        DateTime: GraphQLDateTime,
        ...allResolvers,
    },
});
