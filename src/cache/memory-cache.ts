import { Cache as MemoryCache } from 'memory-cache';

const cache = new MemoryCache<string, unknown>();

export async function getWithCacheAsync<T>(
	key: string,
	expiredTime: number,
	getCallback: () => Promise<T|null>
): Promise<T|null> {
	const cachedValue = cache.get( key ) as T;
	if ( cachedValue ) {
		return cachedValue;
	}
	const value = await getCallback();
	if ( value !== null ) {
		cache.put( key, value, expiredTime );
	}
	return value;
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function removeCachedItem( key: string ): Promise<boolean> {
	return cache.del( key );
}
