import { inspect } from 'node:util';

import { RedisOptions, Redis } from 'ioredis';
import winston from 'winston';

const clientConfig: RedisOptions = {
	lazyConnect: true,
	reconnectOnError( error ) {
		if ( String( error ).includes( 'Socket closed unexpectedly' ) ) {
			return 2;
		}

		return false;
	},
};
const client = process.env.REDIS_URL ? new Redis( process.env.REDIS_URL, clientConfig ) : new Redis( clientConfig );

client.on( 'error', ( error ) => winston.error( `[cache/redis] Redis Client Error: ${ inspect( error ) }` ) );

const redisKeyPrefix = process.env.REDIS_KEY_PREFIX || '';

export async function getWithCacheAsync<T>(
	key: string,
	expiredTime: number,
	getCallback: () => Promise<T | undefined>
): Promise<T | undefined> {
	const cachedValue = await client.get( redisKeyPrefix + key );
	if ( cachedValue ) {
		return JSON.parse( cachedValue ) as T;
	}
	const value = await getCallback();
	if ( value !== undefined ) {
		client.set(
			redisKeyPrefix + key,
			JSON.stringify( value ),
			'PX',
			expiredTime
		);
	}
	return value;
}

export async function removeCachedItem( key: string ): Promise<boolean> {
	return !!await client.del( redisKeyPrefix + key );
}

export async function init(): Promise<void> {
	await client.connect();
}
