import type { IResolvers, TypeSource } from '@graphql-tools/utils';

import { path, resolve } from '@cyberskill/shared/node/path';
import { loadFilesSync } from '@graphql-tools/load-files';
import { mergeResolvers, mergeTypeDefs } from '@graphql-tools/merge';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { GraphQLDateTime, GraphQLJSON } from 'graphql-scalars';
import { omit } from 'lodash-es';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const currentDir = resolve(__dirname, '../../');

const typesArray: TypeSource = loadFilesSync<TypeSource>(path.join(currentDir, '/**/*.graphql'), {
    recursive: true,
});

const resolversArray: IResolvers[] = loadFilesSync<IResolvers>(path.join(currentDir, '/**/*.resolver.{js,ts}'), {
    recursive: true,
});

const allTypes = mergeTypeDefs(typesArray);

export const allResolvers = omit(mergeResolvers(resolversArray), ['default']);

export const schema = makeExecutableSchema({
    typeDefs: allTypes,
    resolvers: {
        JSON: GraphQLJSON,
        DateTime: GraphQLDateTime,
        ...allResolvers,
    },
});
