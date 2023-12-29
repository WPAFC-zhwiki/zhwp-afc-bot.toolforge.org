import util = require( 'node:util' );

import express = require( 'express' );
import winston = require( 'winston' );

import { methodNoAllow } from '@app/utils';
import { doReplicaQuery, isReplicaQueryEnable } from '@app/database';
import { getWithCacheAsync } from '@app/cache';

export async function onRequest( req: express.Request, res: express.Response ) {
	if ( req.method.toUpperCase() !== 'GET' ) {
		return methodNoAllow( req, res );
	}
	if ( !isReplicaQueryEnable ) {
		res.status( 422 );
		res.json( {
			status: 422
		} );
		res.end();
		return;
	}

	function sendBroken() {
		res.status( 500 );
		res.json( {
			status: 500
		} );
		res.end();
	}

	const data = await getWithCacheAsync<string[]>(
		'api/list-sysop-patroller/data',
		5 * 60 * 1000,
		async () => {
			try {
				const queryResults = ( await doReplicaQuery( '\
SELECT `user_name` \
FROM `user` \
LEFT JOIN `user_groups` on `user_id` = `ug_user` \
WHERE `ug_group` = "sysop" OR `ug_group` = "patroller" \
ORDER BY `user_name` ASC; \
				' ) ).result;
				if ( req.isTimeOut ) {
					return null;
				}
				if ( !Array.isArray( queryResults ) ) {
					winston.error( `[api/list-sysop-patroller] Unknown response: ${ util.inspect( queryResults ) }.` );
					sendBroken();
					return null;
				}
				try {
					const resultData = [];
					for ( const line of queryResults ) {
						resultData.push( ( line as { user_name: Buffer; } ).user_name.toString( 'utf-8' ) );
					}
					return resultData;
				} catch ( parseDataError ) {
					winston.error( `[api/list-sysop-patroller] Unknown error when parse data: ${ util.inspect( parseDataError ) }.` );
					sendBroken();
					return null;
				}
			} catch ( queryError ) {
				winston.error( `[api/list-sysop-patroller] Unknown error when query data: ${ util.inspect( queryError ) }.` );
				sendBroken();
				return null;
			}
		}
	);

	if ( !req.isTimeOut ) {
		if ( data ) {
			res.status( 200 );
			res.json( {
				status: 200,
				data: data
			} );

			res.setHeader( 'Cache-Control', 'max-age=86400, must-revalidate' );
			res.end();
		}

		if ( !res.writableEnded ) {
			res.status( 502 );
			res.json( {
				status: 502
			} );

			res.end();
		}
	}
}
