/* eslint-disable node/prefer-global/process */
import 'dotenv/config';
import mongoose from 'mongoose';

import { getEnv } from '#shared/env/env.util.js';

import { translateBlog, translateDestination } from '../modules/translation/translation.queue.js';

const [type, id] = process.argv.slice(2);

if (!type || !id || !['blog', 'destination'].includes(type)) {
    console.error('Usage: npx tsx scripts/retranslate.ts <blog|destination> <id>');
    process.exit(1);
}

const translationId = id!;

async function main() {
    const env = getEnv();
    const uri = env['MONGO_URI'] || 'mongodb://localhost:27017/ssl-be';
    console.log(`Connecting to ${uri} ...`);
    await mongoose.connect(uri);

    console.log(`Translating ${type} ${id} ...`);
    if (type === 'blog') {
        await translateBlog(translationId);
    }
    else {
        await translateDestination(translationId);
    }
    console.log('Done.');

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
