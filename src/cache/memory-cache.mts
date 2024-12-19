import { Cache as MemoryCache } from 'memory-cache';

const cache = new MemoryCache<string, unknown>();

export async function getWithCacheAsync<T>(
	key: string,
	expiredTime: number,
	getCallback: () => Promise<T | undefined>
): Promise<T | undefined> {
	const cachedValue = cache.get( key ) as T;
	if ( cachedValue ) {
		return cachedValue;
	}
	const value = await getCallback();
	if ( value !== undefined ) {
		cache.put( key, value, expiredTime );
	}
	return value;
}

export async function removeCachedItem( key: string ): Promise<boolean> {
	return cache.del( key );
}
