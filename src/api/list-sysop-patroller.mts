import { inspect } from 'node:util';

import express from 'express';
import winston from 'winston';

import { getWithCacheAsync } from '@app/cache/index.mjs';
import { doReplicaQuery, isReplicaQueryEnable } from '@app/replica.mjs';
import { methodNoAllow } from '@app/utils.mjs';

export async function onRequest( request: express.Request, response: express.Response ) {
	if ( request.method.toUpperCase() !== 'GET' ) {
		return methodNoAllow( request, response );
	}
	if ( !isReplicaQueryEnable ) {
		response.status( 422 );
		response.json( {
			status: 422,
		} );
		response.end();
		return;
	}

	function sendBroken() {
		response.status( 500 );
		response.json( {
			status: 500,
		} );
		response.end();
	}

	const data = await getWithCacheAsync<string[]>(
		'api/list-sysop-patroller/data',
		5 * 60 * 1000,
		async () => {
			try {
				const queryResults = (
					await doReplicaQuery( '\
WITH g AS ( \
	SELECT DISTINCT `ug_user` FROM `user_groups` WHERE `ug_group` IN ("sysop", "patroller") \
	EXCEPT \
	SELECT `ug_user` FROM `user_groups` WHERE `ug_group` = "bot" \
) \
SELECT `user_name`, `user_id` FROM g \
INNER JOIN `user` ON `user_id` = `ug_user` \
WHERE `user_name` <> "滥用过滤器"; \
				' )
				// eslint-disable-next-line unicorn/no-await-expression-member
				).result;
				if ( request.isTimeOut ) {
					return;
				}
				if ( !Array.isArray( queryResults ) ) {
					winston.error( `[api/list-sysop-patroller] Unknown response: ${ inspect( queryResults ) }.` );
					sendBroken();
					return;
				}
				try {
					const resultData = [];
					for ( const line of queryResults ) {
						resultData.push( ( line as { user_name: Buffer; } ).user_name.toString( 'utf8' ) );
					}
					return resultData.sort( ( a, b ) => a.localeCompare( b ) );
				} catch ( parseDataError ) {
					winston.error( `[api/list-sysop-patroller] Unknown error when parse data: ${ inspect( parseDataError ) }.` );
					sendBroken();
					return;
				}
			} catch ( queryError ) {
				winston.error( `[api/list-sysop-patroller] Unknown error when query data: ${ inspect( queryError ) }.` );
				sendBroken();
				return;
			}
		}
	);

	if ( !request.isTimeOut ) {
		if ( data ) {
			response.status( 200 );
			response.json( {
				status: 200,
				data: data,
			} );

			response.setHeader( 'Cache-Control', 'max-age=86400, must-revalidate' );
			response.end();
		}

		if ( !response.writableEnded ) {
			response.status( 502 );
			response.json( {
				status: 502,
			} );

			response.end();
		}
	}
}
