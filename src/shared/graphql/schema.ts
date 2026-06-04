import type { IResolvers, TypeSource } from '@graphql-tools/utils';

import { path, resolve } from '@cyberskill/shared/node/path';
import { loadFiles } from '@graphql-tools/load-files';
import { mergeResolvers, mergeTypeDefs } from '@graphql-tools/merge';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { GraphQLDateTime, GraphQLJSON } from 'graphql-scalars';
import { omit } from 'lodash-es';
import { glob } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

    // loadFiles() passes raw Windows absolute paths to import() which fails on
    // Node.js v24+ on Windows ("Received protocol 'e:'").
    // Fix: use node:fs/promises glob to find resolver files, then convert each
    // path to a file:// URL with pathToFileURL before importing.
    const resolverPaths = await Array.fromAsync(
        glob('**/*.resolver.{js,ts}', {
            cwd: currentDir,
            exclude: (f: string) => f.includes('node_modules'),
        }),
    );
    const resolversArray = await Promise.all(
        resolverPaths.map(async (f) => {
            const mod = await import(pathToFileURL(path.join(currentDir, f)).href);
            // Use default export if present (mirrors loadFiles behaviour), else merge all named exports
            return (mod.default ?? mod) as IResolvers;
        }),
    ) as IResolvers[];

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
