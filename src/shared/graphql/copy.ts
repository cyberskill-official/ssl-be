import { copySync } from '@cyberskill/shared/node/fs';
import { log } from '@cyberskill/shared/node/log';

const src = 'src';
const dest = 'build';
const extensions = ['.graphql'];

copySync(src, dest, { extensions });

log.success('GraphQL files copied successfully!');
