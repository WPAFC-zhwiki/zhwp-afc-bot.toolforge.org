import util = require( 'node:util' );

import winston = require( 'winston' );

let cacheBackend: typeof import( '@app/cache/memory-cache' ) | typeof import( '@app/cache/redis' );

export async function init() {
	if ( cacheBackend ) {
		return;
	}

	if ( process.env.ENABLE_REDIS ) {
		const redisCacheBackend = await import( '@app/cache/redis' );
		try {
			await redisCacheBackend.init();
			winston.info( '[cache] Redis loaded.' );
			cacheBackend = redisCacheBackend;
		} catch ( error ) {
			winston.error( `[cache] Redis load fail, use memory instead: ${ util.inspect( error ) }` );
		}
	}

	if ( !cacheBackend ) {
		cacheBackend = await import( '@app/cache/memory-cache' );
		winston.info( '[cache] Memory cache loaded.' );
	}
}

export async function getWithCacheAsync<T>(
	key: string,
	expiredTime: number,
	getCallback: () => Promise<T|null>
): Promise<T|null> {
	return cacheBackend.getWithCacheAsync<T>(
		key,
		expiredTime,
		getCallback
	);
}

export async function removeCachedItem( key: string ): Promise<boolean> {
	return cacheBackend.removeCachedItem( key );
}
