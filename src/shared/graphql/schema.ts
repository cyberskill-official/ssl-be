import type { IResolvers, TypeSource } from '@graphql-tools/utils';

import { path, resolve } from '@cyberskill/shared/node/path';
import { loadFiles } from '@graphql-tools/load-files';
import { mergeResolvers, mergeTypeDefs } from '@graphql-tools/merge';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { GraphQLDateTime, GraphQLJSON } from 'graphql-scalars';
import { omit } from 'lodash-es';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const currentDir = resolve(__dirname, '../../');

interface T_GraphqlArtifacts {
    allResolvers: IResolvers;
    schema: ReturnType<typeof makeExecutableSchema>;
}

let graphqlArtifactsPromise: Promise<T_GraphqlArtifacts> | undefined;

async function loadGraphqlArtifacts(): Promise<T_GraphqlArtifacts> {
    const typesArray = await loadFiles(path.join(currentDir, '/**/*.graphql'), {
        recursive: true,
    }) as TypeSource;

    const resolversArray = await loadFiles(path.join(currentDir, '/**/*.resolver.{js,ts}'), {
        recursive: true,
    }) as IResolvers[];

    const allTypes = mergeTypeDefs(typesArray);
    const allResolvers = omit(mergeResolvers(resolversArray), ['default']) as IResolvers;

    return {
        allResolvers,
        schema: makeExecutableSchema({
            typeDefs: allTypes,
            resolvers: {
                JSON: GraphQLJSON,
                DateTime: GraphQLDateTime,
                ...allResolvers,
            },
        }),
    };
}

async function getGraphqlArtifacts(): Promise<T_GraphqlArtifacts> {
    graphqlArtifactsPromise ??= loadGraphqlArtifacts();
    return graphqlArtifactsPromise;
}

export async function getAllResolvers(): Promise<IResolvers> {
    const { allResolvers } = await getGraphqlArtifacts();
    return allResolvers;
}

export async function getSchema(): Promise<ReturnType<typeof makeExecutableSchema>> {
    const { schema } = await getGraphqlArtifacts();
    return schema;
}
