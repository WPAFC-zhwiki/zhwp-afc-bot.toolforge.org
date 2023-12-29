import util = require( 'node:util' );

import { RedisClientOptions, createClient } from 'redis';
import winston = require( 'winston' );

const clientConfig: RedisClientOptions = {};
if ( process.env.REDIS_URL ) {
	clientConfig.url = process.env.REDIS_URL;
}

const client = createClient( clientConfig );

client.on( 'error', ( error ) => winston.error( `[cache/redis] Redis Client Error: ${ util.inspect( error ) }` ) );

const redisKeyPrefix = process.env.REDIS_KEY_PREFIX || '';

export async function getWithCacheAsync<T>(
	key: string,
	expiredTime: number,
	getCallback: () => Promise<T|null>
): Promise<T|null> {
	const cachedValue = await client.get( redisKeyPrefix + key );
	if ( cachedValue ) {
		return JSON.parse( cachedValue ) as T;
	}
	const value = await getCallback();
	if ( value !== null ) {
		client.set(
			redisKeyPrefix + key,
			JSON.stringify( value ),
			{
				PX: expiredTime
			}
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
