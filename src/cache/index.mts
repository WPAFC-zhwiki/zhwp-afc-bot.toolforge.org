import { inspect } from 'node:util';

import winston from 'winston';

let cacheBackend: typeof import( '@app/cache/memory-cache.mjs' ) | typeof import( '@app/cache/redis.mjs' );

export async function init() {
	if ( cacheBackend ) {
		return;
	}

	if ( process.env.ENABLE_REDIS ) {
		const redisCacheBackend = await import( '@app/cache/redis.mjs' );
		try {
			await redisCacheBackend.init();
			winston.info( '[cache] Redis loaded.' );
			cacheBackend = redisCacheBackend;
		} catch ( error ) {
			winston.error( `[cache] Redis load fail, use memory instead: ${ inspect( error ) }` );
		}
	}

	if ( !cacheBackend ) {
		cacheBackend = await import( '@app/cache/memory-cache.mjs' );
		winston.info( '[cache] Memory cache loaded.' );
	}
}

export async function getWithCacheAsync<T>(
	key: string,
	expiredTime: number,
	getCallback: () => Promise<T | undefined>
): Promise<T | undefined> {
	return cacheBackend.getWithCacheAsync<T>(
		key,
		expiredTime,
		getCallback
	);
}

export async function removeCachedItem( key: string ): Promise<boolean> {
	return cacheBackend.removeCachedItem( key );
}
